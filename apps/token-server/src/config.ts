import type { CloudflareTurnConfig } from './turn.js'

export type ServerConfig = {
  host: string
  port: number
  cloudflareSfu: { appId: string; appSecret: string }
  allowedOrigins: string[]
  cloudflareTurn?: CloudflareTurnConfig
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const appId = environment.CLOUDFLARE_SFU_APP_ID?.trim()
  const appSecret = environment.CLOUDFLARE_SFU_APP_SECRET?.trim()
  if (!appId || !appSecret) {
    throw new Error('CLOUDFLARE_SFU_APP_ID and CLOUDFLARE_SFU_APP_SECRET are required')
  }

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
    cloudflareSfu: { appId, appSecret },
    allowedOrigins: (environment.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    ...(turnKeyId && turnApiToken
      ? { cloudflareTurn: { keyId: turnKeyId, apiToken: turnApiToken, ttlSeconds: turnTtlSeconds } }
      : {}),
  }
}
