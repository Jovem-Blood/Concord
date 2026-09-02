import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyRequest } from 'fastify'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { ServerConfig } from './config.js'
import { parseJoinInput } from './validation.js'
import { validMediaSource, type MediaSource } from './media.js'
import { createSfuClient, type SfuClient, type SessionDescription, type SfuTrack } from './sfu.js'

const PRESENCE_TTL = 120_000
const TOKEN_TTL = 2 * 60 * 60 * 1000
type PublishedTrack = { mid: string; trackName: string; kind: 'video' | 'audio'; source: MediaSource }
type Participant = {
  identity: string
  name: string
  roomCode: string
  expiresAt: number
  lastSeen: number
  sessionId?: string
  published: Map<string, PublishedTrack>
  mids: Set<string>
  channels: Map<number, { location: 'local' | 'remote'; sessionId?: string }>
  dataEstablished: boolean
  busy: boolean
}

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
  const members = new Map<string, Participant>()

  await app.register(cors, {
    methods: ['GET', 'POST'],
    origin(origin, callback) {
      const local = Boolean(origin && /^http:\/\/localhost:\d+$/.test(origin))
      const desktop = !origin || origin === 'null' || origin.startsWith('file://')
      callback(null, local || desktop || Boolean(origin && config.allowedOrigins.includes(origin)))
    },
  })
  await app.register(rateLimit, { max: 30, timeWindow: '1 minute' })

  function authenticate(request: FastifyRequest): Participant {
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]
    const member = token ? members.get(tokenHash(token)) : undefined
    if (!member || !active(member)) fail(401, 'Session expired. Join the room again.')
    member.lastSeen = Date.now()
    return member
  }
  function active(member: Participant): boolean {
    return member.expiresAt > Date.now() && member.lastSeen + PRESENCE_TTL > Date.now()
  }
  async function closeSession(member: Participant): Promise<void> {
    const sessionId = member.sessionId
    const tracks = [...member.mids].map((mid) => ({ mid }))
    const dataChannels = [...member.channels.keys()].map((id) => ({ id }))
    member.sessionId = undefined
    member.mids.clear()
    member.published.clear()
    member.channels.clear()
    member.dataEstablished = false
    if (sessionId && dataChannels.length) {
      await sfu.request(sessionId, 'datachannels/close', { dataChannels }).catch(() => {
        app.log.warn({ event: 'sfu.data.cleanup.failed' })
      })
    }
    if (sessionId && tracks.length) {
      await sfu.request(sessionId, 'tracks/close', { tracks, force: true }).catch(() => {
        app.log.warn({ event: 'sfu.cleanup.failed' })
      })
    }
  }
  // One API instance owns presence. Expired clients cannot keep tracks discoverable.
  const reap = setInterval(() => {
    for (const [key, member] of members) {
      if (!active(member) && !member.busy) {
        members.delete(key)
        void closeSession(member)
      }
    }
  }, 15_000)
  reap.unref()
  app.addHook('onClose', async () => {
    clearInterval(reap)
    await Promise.all([...members.values()].map(closeSession))
    members.clear()
  })

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
    try { return await action(member) } finally { member.busy = false }
  }
  function session(member: Participant): string {
    return member.sessionId ?? fail(409, 'Create a media session first.')
  }

  app.get('/health', async () => ({ status: 'ok', mediaProvider: 'cloudflare-sfu' }))
  app.post('/v1/join', async (request, reply) => {
    const input = parseJoinInput(request.body)
    if (!input) return reply.code(400).send({ error: 'INVALID_JOIN_REQUEST', message: 'Invalid room code or display name.' })
    if (members.size >= 2000) fail(503, 'Server capacity reached.')
    if ([...members.values()].filter((p) => active(p) && p.roomCode === input.roomCode).length >= 16) fail(409, 'Room capacity reached.')
    const participantToken = randomBytes(32).toString('base64url')
    const identity = randomUUID()
    const expiresAt = Date.now() + TOKEN_TTL
    members.set(tokenHash(participantToken), {
      identity, name: input.displayName, roomCode: input.roomCode, expiresAt, lastSeen: Date.now(),
      published: new Map(), mids: new Set(), channels: new Map(), dataEstablished: false, busy: false,
    })
    return reply.header('cache-control', 'no-store').send({ participantToken, identity, expiresAt })
  })
  app.get('/v1/room', authenticated, async (request, reply) => {
    const current = authenticate(request)
    const participants = [...members.values()].filter((p) => active(p) && p.roomCode === current.roomCode)
    return reply.header('cache-control', 'no-store').send({
      participants: participants.map((p) => ({ identity: p.identity, name: p.name,
        voice: { available: [...p.published.values()].some((t) => t.source === 'microphone') } })),
      tracks: participants.flatMap((p) => [...p.published.values()].map((track) => ({
        participantIdentity: p.identity, participantName: p.name, sessionId: p.sessionId,
        trackName: track.trackName, kind: track.kind, source: track.source,
      }))),
      channels: participants.filter((p) => [...p.channels.values()].some((c) => c.location === 'local')).map((p) => ({
        participantIdentity: p.identity, participantName: p.name, sessionId: p.sessionId, dataChannelName: 'concord-chat',
      })),
    })
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
  // This API signals channels only. Message bodies never pass through the API.
  app.post('/v1/chat/establish', authenticated, (request) => exclusive(request, async (member) => {
    const body = request.body
    if (member.dataEstablished) fail(409, 'Data transport already established.')
    if (!record(body) || !description(body.sessionDescription) || body.sessionDescription.type !== 'offer' ||
        !body.sessionDescription.sdp.includes('m=application')) fail(400, 'An SCTP offer is required.')
    const result = await sfu.request(session(member), 'datachannels/establish', {
      sessionDescription: body.sessionDescription,
      dataChannel: { location: 'remote', dataChannelName: 'server-events' },
    })
    const id = result.dataChannel?.id
    if (!Number.isInteger(id) || id! < 0 || id! > 65534 || !result.sessionDescription) throw new Error('Invalid data transport response')
    member.channels.set(id!, { location: 'remote' })
    member.dataEstablished = true
    return result
  }))
  app.post('/v1/chat/channels', authenticated, (request) => exclusive(request, async (member) => {
    const body = request.body
    if (!member.dataEstablished) fail(409, 'Establish a data transport first.')
    if (!record(body) || (body.location !== 'local' && body.location !== 'remote')) fail(400, 'Invalid channel.')
    if (member.channels.size >= 17) fail(400, 'Channel capacity reached.')
    const location = body.location
    let publisherSession: string | undefined
    if (location === 'local') {
      if ([...member.channels.values()].some((c) => c.location === 'local')) fail(409, 'Chat already published.')
    } else {
      if (!identifier(body.sessionId)) fail(400, 'Invalid publisher.')
      const publisher = [...members.values()].find((p) => active(p) && p !== member && p.roomCode === member.roomCode &&
        p.sessionId === body.sessionId && [...p.channels.values()].some((c) => c.location === 'local'))
      if (!publisher) fail(403, 'Channel is not published in this room.')
      publisherSession = publisher.sessionId
      if ([...member.channels.values()].some((c) => c.sessionId === publisherSession)) fail(409, 'Already subscribed.')
    }
    const channel = { location, dataChannelName: 'concord-chat', ordered: true,
      ...(publisherSession ? { sessionId: publisherSession, waitForAck: true, canReply: false } : {}) }
    const result = await sfu.request(session(member), 'datachannels/new', { dataChannels: [channel] })
    const returned = result.dataChannels?.[0]
    if (result.dataChannels?.length !== 1 || returned?.errorCode || !Number.isInteger(returned?.id) ||
        returned!.id! < 0 || returned!.id! > 65534 || member.channels.has(returned!.id!)) throw new Error('Invalid channel response')
    member.channels.set(returned!.id!, { location, sessionId: publisherSession })
    return { dataChannels: [{ ...channel, id: returned!.id }] }
  }))
  app.post('/v1/chat/close', authenticated, (request) => exclusive(request, async (member) => {
    const body = request.body
    if (!record(body) || !Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 16 ||
        !body.ids.every((id) => typeof id === 'number' && member.channels.has(id) &&
          (member.channels.get(id)!.location === 'local' || member.channels.get(id)!.sessionId))) fail(400, 'Invalid channel ids.')
    const result = await sfu.request(session(member), 'datachannels/close', { dataChannels: body.ids.map((id) => ({ id })) })
    for (const id of body.ids) {
      if (!result.dataChannels?.some((c) => c.id === id && c.errorCode)) member.channels.delete(id)
    }
    return result
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
  app.post('/v1/leave', authenticated, (request) => exclusive(request, async (member) => {
    members.delete(tokenHash(request.headers.authorization!.slice(7)))
    await closeSession(member)
    return { ok: true }
  }))
  app.setErrorHandler((error, request, reply) => {
    const candidate = Number((error as { statusCode?: number }).statusCode ?? 500)
    const statusCode = candidate >= 400 && candidate < 500 ? candidate : 500
    request.log.error({ event: 'request.failed', statusCode })
    void reply.code(statusCode).send({ error: 'REQUEST_FAILED', message: 'The request could not be completed.' })
  })
  return app
}
