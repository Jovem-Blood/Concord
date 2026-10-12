import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import { PROTOCOL_VERSION, validClientEvent } from '@concord/protocol'
import type { Span } from '@opentelemetry/api'
import type { Telemetry } from './telemetry.js'
import { RoomAuthority, type Participant } from './rooms.js'
import { createRealtime } from './realtime.js'
import type { ServerConfig } from './config.js'
import { parseJoinInput } from './validation.js'
import { validMediaSource, type MediaSource } from './media.js'
import { createSfuClient, UpstreamHttpError, type SfuClient, type SessionDescription, type SfuTrack } from './sfu.js'

function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode })
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}
function description(value: unknown): value is SessionDescription {
  return record(value) && (value.type === 'offer' || value.type === 'answer') &&
    typeof value.sdp === 'string' && value.sdp.length > 0 && value.sdp.length <= 192_000
}
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

export async function buildApp(
  config: ServerConfig,
  sfuClient?: SfuClient,
  telemetry?: Telemetry,
) {
  const sfu = sfuClient ?? createSfuClient(config.cloudflareSfu, fetch, telemetry)
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.body'] },
    bodyLimit: 256 * 1024,
  })
  const rooms = new RoomAuthority(closeSession)
  const requestSpans = new WeakMap<FastifyRequest, Span>()
  app.addHook('onRequest', (request, _reply, done) => {
    const span = telemetry?.requestStarted(request.method, request.routeOptions.url ?? 'unmatched',
      typeof request.headers.traceparent === 'string' ? request.headers.traceparent : undefined)
    if (span) requestSpans.set(request, span)
    if (telemetry) telemetry.withSpan(span, done)
    else done()
  })
  app.addHook('onResponse', async (request, reply) => {
    telemetry?.requestFinished(requestSpans.get(request), request.method, request.routeOptions.url ?? 'unmatched',
      reply.statusCode, reply.elapsedTime)
  })
  const members = rooms.members
  const active = (member: Participant) => rooms.active(member)
  function allowedOrigin(origin?: string): boolean {
    return Boolean(origin && /^http:\/\/localhost:\d+$/.test(origin)) || !origin || origin === 'null' ||
      origin.startsWith('file://') || config.allowedOrigins.includes(origin)
  }

  await app.register(cors, {
    methods: ['GET', 'POST'],
    origin(origin, callback) {
      callback(null, allowedOrigin(origin))
    },
  })
  await app.register(rateLimit, { max: 30, timeWindow: '1 minute' })
  const realtime = createRealtime(app.server, rooms, allowedOrigin, telemetry)
  // WebSockets must be closed before Fastify waits for HTTP connections to drain.
  app.addHook('preClose', async () => { await realtime.close() })

  // Anonymous reports also cover failures before a participant can join. Keep the
  // payload deliberately narrow so client secrets and room content cannot be logged.
  app.post('/v1/client-events', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    bodyLimit: 64 * 1024,
  }, async (request, reply) => {
    const reports = Array.isArray(request.body) ? request.body : [request.body]
    if (!reports.length || reports.length > 20 || !reports.every(validClientEvent)) {
      return reply.code(400).send({ error: 'INVALID_CLIENT_EVENT' })
    }
    for (const body of reports) {
      // Explicit projection: extra client fields never enter logs or OTLP.
      const details = { event: 'client.event', clientEvent: body.event, clientId: body.clientId,
        platform: body.platform, code: body.code, reason: body.reason, attempt: body.attempt,
        version: body.version, stack: body.stack, traceparent: body.span?.traceparent }
      telemetry?.recordClient(body)
      switch (body.level) {
        case 'error': request.log.error(details); break
        case 'warn': request.log.warn(details); break
        case 'debug': request.log.debug(details); break
        default: request.log.info(details)
      }
    }
    return reply.code(204).send()
  })

  function authenticate(request: FastifyRequest): Participant {
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]
    return rooms.authenticate(token, true)
  }
  async function closeSession(member: Participant): Promise<void> {
    const sessionId = member.sessionId
    const channelId = member.transportChannelId
    const tracks = [...member.mids].map((mid) => ({ mid }))
    member.sessionId = undefined
    member.transportChannelId = undefined
    member.mids.clear()
    member.published.clear()
    if (sessionId && tracks.length) {
      await sfu.request(sessionId, 'tracks/close', { tracks, force: true }).catch((error: unknown) => {
        app.log.warn({ event: 'sfu.cleanup.failed', err: error })
      })
    }
    if (sessionId && channelId !== undefined) {
      await sfu.request(sessionId, 'datachannels/close', { dataChannels: [{ id: channelId }] }).catch((error: unknown) => {
        app.log.warn({ event: 'sfu.transport.cleanup.failed', err: error })
      })
    }
  }

  const authenticated = {
    onRequest: async (request: FastifyRequest) => { authenticate(request) },
    config: { rateLimit: {
      max: 240, timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) => tokenHash(request.headers.authorization ?? request.ip),
    } },
  }
  async function exclusive<T>(request: FastifyRequest, action: (member: Participant) => Promise<T>): Promise<T> {
    const member = authenticate(request)
    if (member.busy) fail(409, 'Another session operation is in progress.')
    member.busy = true
    try { return await action(member) } finally {
      member.busy = false
      if (member.expiresAt === 0) await closeSession(member)
      rooms.changed(member.roomCode)
    }
  }
  function session(member: Participant): string {
    return member.sessionId ?? fail(409, 'Create a media session first.')
  }

  app.get('/health', async () => ({ status: 'ok', mediaProvider: 'cloudflare-sfu' }))
  app.get('/v1/telemetry', async (_request, reply) => reply.header('cache-control', 'no-store').send({
    ...(telemetry?.clientConfig ?? { enabled: false, traces: false, sampleRatio: 0 }), serverTime: Date.now(),
  }))
  app.post('/v1/join', async (request, reply) => {
    if (!record(request.body) || request.body.protocol !== PROTOCOL_VERSION) {
      return reply.code(426).send({ error: 'UPDATE_REQUIRED', message: 'Atualize o Concord para entrar nesta sala.' })
    }
    const input = parseJoinInput(request.body)
    if (!input) return reply.code(400).send({ error: 'INVALID_JOIN_REQUEST', message: 'Invalid room code or display name.' })
    return reply.header('cache-control', 'no-store').send(rooms.create(input.roomCode, input.displayName))
  })
  for (const path of ['/v1/room', '/v1/chat/messages', '/v1/chat/establish', '/v1/chat/channels', '/v1/chat/close']) {
    app.route({ method: ['GET', 'POST'], url: path, handler: async (_request, reply) => reply.code(426).send({ error: 'UPDATE_REQUIRED', message: 'Atualize o Concord para usar a conexão em tempo real.' }) })
  }
  app.get('/v1/ice-servers', authenticated, async (_request, reply) => {
    if (!config.cloudflareTurn) {
      return reply.header('cache-control', 'no-store').send({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] })
    }
    const turn = config.cloudflareTurn
    const action = async () => {
      const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turn.keyId)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${turn.apiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: 86_400 }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new UpstreamHttpError(response.status, 'TURN')
      const body = await response.json() as { iceServers?: unknown }
      if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) throw new Error('Cloudflare TURN returned no ICE servers')
      return { iceServers: body.iceServers }
    }
    return reply.header('cache-control', 'no-store').send(await (telemetry ? telemetry.operation('sfu.turn', action) : action()))
  })
  // Replacing a session withdraws its publications, including during network recovery.
  app.post('/v1/session', authenticated, (request) => exclusive(request, async (member) => {
    await closeSession(member)
    const result = await sfu.createSession()
    if (!identifier(result.sessionId)) throw new Error('Invalid SFU session response')
    member.sessionId = result.sessionId
    return { sessionId: result.sessionId }
  }))
  // Establish RTC without requesting microphone or screen capture permission.
  app.post('/v1/media/prepare', authenticated, (request) => exclusive(request, async (member) => {
    if (member.transportChannelId !== undefined) fail(409, 'Media transport already prepared.')
    const result = await sfu.request(session(member), 'datachannels/establish', {
      dataChannel: { location: 'remote', dataChannelName: 'server-events' },
    })
    if (Number.isInteger(result.dataChannel?.id) && !result.dataChannel?.errorCode) {
      member.transportChannelId = result.dataChannel!.id
    }
    return result
  }))
  app.post('/v1/tracks', authenticated, (request) => exclusive(request, async (member) => {
    const body = request.body
    if (!record(body) || !Array.isArray(body.tracks) || body.tracks.length < 1 || body.tracks.length > 32) fail(400, 'Invalid tracks.')
    const tracks = body.tracks
    if (member.mids.size + tracks.length > 64) fail(400, 'Media session capacity reached.')
    if (!tracks.every(record)) fail(400, 'Invalid tracks.')
    const local = tracks.every((t) => t.location === 'local')
    const remote = tracks.every((t) => t.location === 'remote')
    if (!local && !remote) fail(400, 'Track directions must not be mixed.')
    let safeTracks: SfuTrack[]
    if (local) {
      if (!description(body.sessionDescription) || body.sessionDescription.type !== 'offer') fail(400, 'An SDP offer is required.')
      if (tracks.length + member.published.size > 3) fail(400, 'Only one track per media source may be published.')
      if (!tracks.every((t) => identifier(t.mid) && identifier(t.trackName) && validMediaSource(t.source, t.kind))) fail(400, 'Invalid local tracks.')
      if (new Set(tracks.map((t) => t.mid)).size !== tracks.length ||
          new Set([...member.published.values(), ...tracks].map((t) => t.trackName)).size !== member.published.size + tracks.length ||
          new Set([...member.published.values(), ...tracks].map((t) => t.source)).size !== member.published.size + tracks.length ||
          tracks.some((t) => member.mids.has(t.mid as string))) fail(400, 'Duplicate local tracks.')
      safeTracks = tracks.map((t) => ({ location: 'local', mid: t.mid as string, trackName: t.trackName as string, kind: t.kind as 'audio' | 'video' }))
    } else {
      if (body.sessionDescription !== undefined) fail(400, 'Remote tracks use an SFU offer.')
      safeTracks = tracks.map((track) => {
        if (!identifier(track.sessionId) || !identifier(track.trackName)) fail(400, 'Invalid remote track.')
        const publisher = [...members.values()].find((p) => active(p) && p !== member &&
          p.roomCode === member.roomCode && p.sessionId === track.sessionId)
        const published = publisher && [...publisher.published.values()].find((t) => t.trackName === track.trackName)
        if (!published) fail(403, 'Track is not published in this room.')
        return { location: 'remote', sessionId: track.sessionId, trackName: track.trackName, kind: published.kind }
      })
    }
    const result = await sfu.request(session(member), 'tracks/new', {
      tracks: safeTracks, ...(local ? { sessionDescription: body.sessionDescription } : {}),
    })
    for (const track of result.tracks ?? []) {
      if (track.errorCode || !identifier(track.mid)) continue
      member.mids.add(track.mid)
      const source = safeTracks.find((t) => t.trackName === track.trackName && (local || t.sessionId === track.sessionId))
      if (local && source?.kind && source.trackName) {
        const input = tracks.find((t) => t.trackName === source.trackName)!
        member.published.set(track.mid, { mid: track.mid, trackName: source.trackName, kind: source.kind, source: input.source as MediaSource })
      }
    }
    return result
  }))
  app.post('/v1/renegotiate', authenticated, (request) => exclusive(request, async (member) => {
    if (!record(request.body) || !description(request.body.sessionDescription)) fail(400, 'Invalid SDP.')
    return sfu.request(session(member), 'renegotiate', { sessionDescription: request.body.sessionDescription })
  }))
  app.post('/v1/tracks/close', authenticated, (request) => exclusive(request, async (member) => {
    const body = request.body
    if (!record(body) || !Array.isArray(body.mids) || body.mids.length < 1 || body.mids.length > 64 ||
      !body.mids.every((mid) => identifier(mid) && member.mids.has(mid))) fail(400, 'Invalid track mids.')
    if (body.sessionDescription !== undefined && (!description(body.sessionDescription) || body.sessionDescription.type !== 'offer')) {
      fail(400, 'An SDP offer is required for negotiated closure.')
    }
    const result = await sfu.request(session(member), 'tracks/close', {
      tracks: body.mids.map((mid) => ({ mid })),
      ...(body.sessionDescription ? { sessionDescription: body.sessionDescription, force: false } : { force: true }),
    })
    for (const mid of body.mids) {
      if (result.tracks?.some((t) => t.mid === mid && t.errorCode)) continue
      member.published.delete(mid)
      member.mids.delete(mid)
    }
    return result
  }))
  async function leave(token: string) {
    const member = rooms.authenticate(token)
    rooms.remove(member)
    return { ok: true }
  }
  app.post('/v1/leave', (request) => leave(request.headers.authorization?.slice(7) ?? ''))
  app.post('/v1/leave/beacon', { bodyLimit: 128 }, (request) => {
    if (typeof request.body !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(request.body)) fail(401, 'Invalid session token.')
    return leave(request.body)
  })
  app.setErrorHandler((error, request, reply) => {
    const candidate = Number((error as { statusCode?: number }).statusCode ?? 500)
    const statusCode = candidate >= 400 && candidate < 500 ? candidate : 500
    if (statusCode >= 500) {
      telemetry?.failure(requestSpans.get(request), error)
      telemetry?.event('error', 'request.failed', { 'http.route': request.routeOptions.url ?? 'unmatched',
        'http.response.status_code': statusCode }, error)
    }
    const details = { event: 'request.failed', statusCode, method: request.method, path: request.routeOptions.url ?? 'unmatched',
      err: error }
    if (statusCode >= 500) request.log.error(details)
    else if (statusCode === 401 || statusCode === 429) request.log.info(details)
    else request.log.warn(details)
    void reply.code(statusCode).send({ error: 'REQUEST_FAILED', message: 'The request could not be completed.' })
  })
  return app
}
