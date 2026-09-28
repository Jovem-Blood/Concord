import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyRequest } from 'fastify'
import { createHash } from 'node:crypto'
import { PROTOCOL_VERSION } from '@concord/protocol'
import { RoomAuthority, type Participant } from './rooms.js'
import { createRealtime } from './realtime.js'
import type { ServerConfig } from './config.js'
import { parseJoinInput } from './validation.js'
import { validMediaSource, type MediaSource } from './media.js'
import { createSfuClient, type SfuClient, type SessionDescription, type SfuTrack } from './sfu.js'

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
  sfu: SfuClient = createSfuClient(config.cloudflareSfu),
) {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.body'] },
    bodyLimit: 256 * 1024,
  })
  const rooms = new RoomAuthority(closeSession)
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
  const realtime = createRealtime(app.server, rooms, allowedOrigin)
  // WebSockets must be closed before Fastify waits for HTTP connections to drain.
  app.addHook('preClose', async () => { await realtime.close() })

  // Anonymous reports also cover failures before a participant can join. Keep the
  // payload deliberately narrow so client secrets and room content cannot be logged.
  app.post('/v1/client-events', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    bodyLimit: 2048,
  }, async (request, reply) => {
    const body = request.body
    if (!record(body) ||
      !['error', 'warn', 'info', 'debug'].includes(String(body.level)) ||
      typeof body.event !== 'string' || !/^[a-z][a-z0-9_.-]{2,63}$/.test(body.event) ||
      typeof body.clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.clientId) ||
      (body.code !== undefined && (typeof body.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(body.code))) ||
      (body.reason !== undefined && (typeof body.reason !== 'string' ||
        !/^(?:[1-5]\d\d|HTTP_ERROR|UnknownError|DOMException|AbortError|NetworkError|NotAllowedError|NotFoundError|NotReadableError|SecurityError|InvalidStateError|OperationError|TimeoutError|TypeError|RangeError|SyntaxError|ReferenceError|Error)$/.test(body.reason))) ||
      (body.attempt !== undefined && (!Number.isInteger(body.attempt) || Number(body.attempt) < 0 || Number(body.attempt) > 1000)) ||
      (body.platform !== 'web' && body.platform !== 'desktop')) {
      return reply.code(400).send({ error: 'INVALID_CLIENT_EVENT' })
    }
    const details = { event: 'client.event', clientEvent: body.event, clientId: body.clientId,
      platform: body.platform, code: body.code, reason: body.reason, attempt: body.attempt }
    switch (body.level) {
      case 'error': request.log.error(details); break
      case 'warn': request.log.warn(details); break
      case 'debug': request.log.debug(details); break
      default: request.log.info(details)
    }
    return reply.code(204).send()
  })

  function authenticate(request: FastifyRequest): Participant {
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]
    return rooms.authenticate(token, true)
  }
  async function closeSession(member: Participant): Promise<void> {
    const sessionId = member.sessionId
    const tracks = [...member.mids].map((mid) => ({ mid }))
    member.sessionId = undefined
    member.mids.clear()
    member.published.clear()
    if (sessionId && tracks.length) {
      await sfu.request(sessionId, 'tracks/close', { tracks, force: true }).catch((error: unknown) => {
        app.log.warn({ event: 'sfu.cleanup.failed', err: error })
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
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(config.cloudflareTurn.keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.cloudflareTurn.apiToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 86_400 }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Cloudflare TURN request failed (${response.status})`)
    const body = await response.json() as { iceServers?: unknown }
    if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) throw new Error('Cloudflare TURN returned no ICE servers')
    return reply.header('cache-control', 'no-store').send({ iceServers: body.iceServers })
  })
  // Replacing a session withdraws its publications, including during network recovery.
  app.post('/v1/session', authenticated, (request) => exclusive(request, async (member) => {
    await closeSession(member)
    const result = await sfu.createSession()
    if (!identifier(result.sessionId)) throw new Error('Invalid SFU session response')
    member.sessionId = result.sessionId
    return { sessionId: result.sessionId }
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
    const result = await sfu.request(session(member), 'tracks/close', {
      tracks: body.mids.map((mid) => ({ mid })), force: true,
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
    const details = { event: 'request.failed', statusCode, method: request.method, path: request.routeOptions.url ?? 'unmatched',
      err: error }
    if (statusCode >= 500) request.log.error(details)
    else if (statusCode === 401 || statusCode === 429) request.log.info(details)
    else request.log.warn(details)
    void reply.code(statusCode).send({ error: 'REQUEST_FAILED', message: 'The request could not be completed.' })
  })
  return app
}
