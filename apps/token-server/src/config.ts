export type ServerConfig = {
  host: string
  port: number
  livekitUrl: string
  livekitApiKey: string
  livekitApiSecret: string
  allowedOrigins: string[]
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
  }
}
