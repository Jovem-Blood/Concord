import type { CloudflareTurnConfig } from './turn.js'

export type ServerConfig = {
  host: string
  port: number
  livekitUrl: string
  livekitApiKey: string
  livekitApiSecret: string
  allowedOrigins: string[]
  cloudflareTurn?: CloudflareTurnConfig
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const isProduction = environment.NODE_ENV === 'production'
  const livekitUrl = environment.LIVEKIT_URL ?? (isProduction ? '' : 'ws://localhost:7880')
  const livekitApiKey = environment.LIVEKIT_API_KEY ?? (isProduction ? '' : 'devkey')
  const livekitApiSecret = environment.LIVEKIT_API_SECRET ?? (isProduction ? '' : 'secret')

  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
    throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required')
  }
  if (!/^(wss?|https?):\/\//.test(livekitUrl)) throw new Error('LIVEKIT_URL must be a valid LiveKit URL')

  const turnKeyId = environment.CLOUDFLARE_TURN_KEY_ID?.trim() ?? ''
  const turnApiToken = environment.CLOUDFLARE_TURN_API_TOKEN?.trim() ?? ''
  if (Boolean(turnKeyId) !== Boolean(turnApiToken)) {
    throw new Error('CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN must be configured together')
  }

  const turnTtlSeconds = Number.parseInt(environment.CLOUDFLARE_TURN_TTL_SECONDS ?? '7200', 10)
  if (!Number.isInteger(turnTtlSeconds) || turnTtlSeconds < 1 || turnTtlSeconds > 172_800) {
    throw new Error('CLOUDFLARE_TURN_TTL_SECONDS must be between 1 and 172800')
  }

  return {
    host: environment.HOST ?? '0.0.0.0',
    port: Number.parseInt(environment.PORT ?? '3001', 10),
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
    allowedOrigins: (environment.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    ...(turnKeyId && turnApiToken
      ? { cloudflareTurn: { keyId: turnKeyId, apiToken: turnApiToken, ttlSeconds: turnTtlSeconds } }
      : {}),
  }
}
