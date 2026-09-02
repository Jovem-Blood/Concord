export type ServerConfig = {
  host: string
  port: number
  cloudflareSfu: { appId: string; appSecret: string }
  allowedOrigins: string[]
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const appId = environment.CLOUDFLARE_SFU_APP_ID?.trim()
  const appSecret = environment.CLOUDFLARE_SFU_APP_SECRET?.trim()
  if (!appId || !appSecret) {
    throw new Error('CLOUDFLARE_SFU_APP_ID and CLOUDFLARE_SFU_APP_SECRET are required')
  }

  return {
    host: environment.HOST ?? '0.0.0.0',
    port: Number.parseInt(environment.PORT ?? '3001', 10),
    cloudflareSfu: { appId, appSecret },
    allowedOrigins: (environment.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  }
}
