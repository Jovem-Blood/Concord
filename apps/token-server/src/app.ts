import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyRequest } from 'fastify'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { ServerConfig } from './config.js'
import { parseJoinInput } from './validation.js'
import { createCloudflareTurnCredentialsProvider, type TurnCredentialsProvider } from './turn.js'
import { createSfuClient, type SfuClient, type SessionDescription, type SfuTrack } from './sfu.js'

const PRESENCE_TTL = 120_000
const TOKEN_TTL = 2 * 60 * 60 * 1000
type PublishedTrack = { mid: string; trackName: string; kind: 'video' | 'audio' }
type Participant = {
  identity: string
  name: string
  roomCode: string
  expiresAt: number
  lastSeen: number
  sessionId?: string
  published: Map<string, PublishedTrack>
  mids: Set<string>
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
  turnCredentialsProvider?: TurnCredentialsProvider,
) {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.body'] },
    bodyLimit: 256 * 1024,
  })
  const members = new Map<string, Participant>()
  const issueTurn = turnCredentialsProvider ??
    (config.cloudflareTurn ? createCloudflareTurnCredentialsProvider(config.cloudflareTurn) : undefined)

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
    member.sessionId = undefined
    member.mids.clear()
    member.published.clear()
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
    const iceServers = await issueTurn?.() ?? [{ urls: ['stun:stun.cloudflare.com:3478'] }]
    const participantToken = randomBytes(32).toString('base64url')
    const identity = randomUUID()
    const expiresAt = Date.now() + Math.min(TOKEN_TTL, (config.cloudflareTurn?.ttlSeconds ?? 7200) * 1000)
    members.set(tokenHash(participantToken), {
      identity, name: input.displayName, roomCode: input.roomCode, expiresAt, lastSeen: Date.now(),
      published: new Map(), mids: new Set(), busy: false,
    })
    return reply.header('cache-control', 'no-store').send({ participantToken, identity, expiresAt, iceServers })
  })
  app.get('/v1/room', authenticated, async (request, reply) => {
    const current = authenticate(request)
    const participants = [...members.values()].filter((p) => active(p) && p.roomCode === current.roomCode)
    return reply.header('cache-control', 'no-store').send({
      participants: participants.map((p) => ({ identity: p.identity, name: p.name })),
      tracks: participants.flatMap((p) => [...p.published.values()].map((track) => ({
        participantIdentity: p.identity, participantName: p.name, sessionId: p.sessionId,
        trackName: track.trackName, kind: track.kind,
      }))),
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
      if (tracks.length + member.published.size > 2) fail(400, 'Only one screen and its audio may be published.')
      if (!tracks.every((t) => identifier(t.mid) && identifier(t.trackName) && (t.kind === 'audio' || t.kind === 'video'))) fail(400, 'Invalid local tracks.')
      if (new Set(tracks.map((t) => t.mid)).size !== tracks.length ||
          new Set(tracks.map((t) => t.trackName)).size !== tracks.length ||
          new Set([...member.published.values(), ...tracks].map((t) => t.kind)).size !== member.published.size + tracks.length ||
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
        member.published.set(track.mid, { mid: track.mid, trackName: source.trackName, kind: source.kind })
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
