export type ServerConfig = {
  host: string
  port: number
  cloudflareSfu?: { appId: string; appSecret: string }
  livekit?: { url: string; apiKey: string; apiSecret: string }
  cloudflareTurn?: { keyId: string; apiToken: string }
  allowedOrigins: string[]
  mediaDiagnostics?: { directory: string; maxBytes: number }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ServerConfig {
  const appId = environment.CLOUDFLARE_SFU_APP_ID?.trim()
  const appSecret = environment.CLOUDFLARE_SFU_APP_SECRET?.trim()
  const url = environment.LIVEKIT_URL?.trim()
  const apiKey = environment.LIVEKIT_API_KEY?.trim()
  const apiSecret = environment.LIVEKIT_API_SECRET?.trim()
  const provider = environment.MEDIA_PROVIDER?.trim() || (url || apiKey || apiSecret ? 'livekit' : 'cloudflare')
  if (!['livekit', 'cloudflare'].includes(provider)) throw new Error('MEDIA_PROVIDER must be livekit or cloudflare')
  const useLiveKit = provider === 'livekit'
  if (useLiveKit && (!url || !apiKey || !apiSecret)) throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required together')
  if (useLiveKit && url && !['wss:', 'ws:'].includes(new URL(url).protocol)) throw new Error('LIVEKIT_URL must use ws:// or wss://')
  if (!useLiveKit && (!appId || !appSecret)) {
    throw new Error('CLOUDFLARE_SFU_APP_ID and CLOUDFLARE_SFU_APP_SECRET are required')
  }
  const turnKeyId = environment.CLOUDFLARE_TURN_KEY_ID?.trim()
  const turnApiToken = environment.CLOUDFLARE_TURN_API_TOKEN?.trim()
  if (!useLiveKit && Boolean(turnKeyId) !== Boolean(turnApiToken)) {
    throw new Error('CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN must be provided together')
  }

  const maxBytes = Number(environment.MEDIA_DIAGNOSTICS_MAX_BYTES?.trim() || 16 * 1024 * 1024)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('MEDIA_DIAGNOSTICS_MAX_BYTES must be a non-negative integer')
  return {
    host: environment.HOST ?? '0.0.0.0',
    port: Number.parseInt(environment.PORT ?? '3001', 10),
    ...(maxBytes > 0 ? { mediaDiagnostics: { directory: environment.MEDIA_DIAGNOSTICS_DIR?.trim() || 'media-diagnostics', maxBytes } } : {}),
    ...(!useLiveKit && appId && appSecret ? { cloudflareSfu: { appId, appSecret } } : {}),
    ...(useLiveKit && url && apiKey && apiSecret ? { livekit: { url, apiKey, apiSecret } } : {}),
    ...(!useLiveKit && turnKeyId && turnApiToken ? { cloudflareTurn: { keyId: turnKeyId, apiToken: turnApiToken } } : {}),
    allowedOrigins: (environment.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  }
}
