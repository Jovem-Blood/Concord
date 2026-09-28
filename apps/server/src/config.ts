export type ServerConfig = {
  host: string
  port: number
  cloudflareSfu: { appId: string; appSecret: string }
  cloudflareTurn?: { keyId: string; apiToken: string }
  allowedOrigins: string[]
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const appId = environment.CLOUDFLARE_SFU_APP_ID?.trim()
  const appSecret = environment.CLOUDFLARE_SFU_APP_SECRET?.trim()
  if (!appId || !appSecret) {
    throw new Error('CLOUDFLARE_SFU_APP_ID and CLOUDFLARE_SFU_APP_SECRET are required')
  }
  const turnKeyId = environment.CLOUDFLARE_TURN_KEY_ID?.trim()
  const turnApiToken = environment.CLOUDFLARE_TURN_API_TOKEN?.trim()
  if (Boolean(turnKeyId) !== Boolean(turnApiToken)) {
    throw new Error('CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN must be provided together')
  }

  return {
    host: environment.HOST ?? '0.0.0.0',
    port: Number.parseInt(environment.PORT ?? '3001', 10),
    cloudflareSfu: { appId, appSecret },
    ...(turnKeyId && turnApiToken ? { cloudflareTurn: { keyId: turnKeyId, apiToken: turnApiToken } } : {}),
    allowedOrigins: (environment.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  }
}
