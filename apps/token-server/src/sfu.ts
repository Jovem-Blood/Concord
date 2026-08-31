export type SessionDescription = { type: 'offer' | 'answer'; sdp: string }
export type SfuTrack = {
  location?: 'local' | 'remote'
  mid?: string
  sessionId?: string
  trackName?: string
  kind?: 'audio' | 'video'
  errorCode?: string
}
export type SfuResponse = {
  sessionId?: string
  sessionDescription?: SessionDescription
  requiresImmediateRenegotiation?: boolean
  tracks?: SfuTrack[]
}
export type SfuClient = {
  createSession(): Promise<SfuResponse>
  request(sessionId: string, operation: 'tracks/new' | 'tracks/close' | 'renegotiate', body: unknown): Promise<SfuResponse>
}

export function createSfuClient(
  config: { appId: string; appSecret: string },
  fetcher: typeof fetch = fetch,
): SfuClient {
  const base = `https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(config.appId)}`
  async function request(path: string, method: string, body?: unknown): Promise<SfuResponse> {
    const response = await fetcher(`${base}/${path}`, {
      method,
      headers: { authorization: `Bearer ${config.appSecret}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    })
    // Never include upstream bodies (SDP, credentials) in errors or logs.
    if (!response.ok) throw new Error(`Cloudflare SFU request failed (${response.status})`)
    const result = await response.json() as SfuResponse & { errorCode?: string }
    if (!result || typeof result !== 'object' || result.errorCode) throw new Error('Cloudflare SFU operation failed')
    return result
  }
  return {
    createSession: () => request('sessions/new', 'POST'),
    request: (sessionId, operation, body) => request(
      `sessions/${encodeURIComponent(sessionId)}/${operation}`,
      operation === 'tracks/new' ? 'POST' : 'PUT', body,
    ),
  }
}
