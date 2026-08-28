import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import { randomUUID } from 'node:crypto'
import { AccessToken } from 'livekit-server-sdk'
import type { ServerConfig } from './config.js'
import { parseJoinInput, type JoinInput } from './validation.js'
import {
  createCloudflareTurnCredentialsProvider,
  type TurnCredentialsProvider,
} from './turn.js'

type TokenIssuer = (input: JoinInput) => Promise<string>

export async function buildApp(
  config: ServerConfig,
  tokenIssuer?: TokenIssuer,
  turnCredentialsProvider?: TurnCredentialsProvider,
) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.authorization', 'req.body.participantToken'],
    },
    bodyLimit: 16 * 1024,
  })

  await app.register(cors, {
    methods: ['GET', 'POST'],
    origin(origin, callback) {
      const localDevelopment = Boolean(origin && /^http:\/\/localhost:\d+$/.test(origin))
      const desktopApp = !origin || origin === 'null' || origin.startsWith('file://')
      const explicitlyAllowed = Boolean(origin && config.allowedOrigins.includes(origin))
      callback(null, localDevelopment || desktopApp || explicitlyAllowed)
    },
  })

  await app.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
  })

  const issueToken: TokenIssuer = tokenIssuer ?? (async ({ roomCode, displayName }) => {
    const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
      identity: randomUUID(),
      name: displayName,
      ttl: '2h',
    })
    token.addGrant({
      roomJoin: true,
      room: roomCode,
      canPublish: true,
      canSubscribe: true,
    })
    return token.toJwt()
  })
  const issueTurnCredentials =
    turnCredentialsProvider ??
    (config.cloudflareTurn ? createCloudflareTurnCredentialsProvider(config.cloudflareTurn) : undefined)

  app.get('/health', async () => ({ status: 'ok' }))

  app.post('/v1/join', async (request, reply) => {
    const input = parseJoinInput(request.body)
    if (!input) {
      return reply.code(400).send({
        error: 'INVALID_JOIN_REQUEST',
        message: 'Use a room code with 8–12 valid characters and a display name with 1–32 characters.',
      })
    }

    request.log.info({ event: 'room.join.request', roomCode: input.roomCode })
    const [participantToken, iceServers] = await Promise.all([
      issueToken(input),
      issueTurnCredentials?.(),
    ])

    return reply.send({
      serverUrl: config.livekitUrl,
      participantToken,
      ...(iceServers ? { iceServers } : {}),
    })
  })

  app.setErrorHandler((error, request, reply) => {
    const message = error instanceof Error ? error.message : 'Unknown error'
    const candidateStatus =
      error && typeof error === 'object' && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode)
        : 500
    const statusCode = candidateStatus >= 400 && candidateStatus < 500 ? candidateStatus : 500
    request.log.error({ event: 'request.failed', error: message })
    void reply.code(statusCode).send({
      error: 'REQUEST_FAILED',
      message: 'The request could not be completed.',
    })
  })

  return app
}
