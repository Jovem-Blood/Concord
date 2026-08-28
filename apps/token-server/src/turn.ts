export type IceServerConfig = {
  urls: string[]
  username?: string
  credential?: string
}

export type CloudflareTurnConfig = {
  keyId: string
  apiToken: string
  ttlSeconds: number
}

export type TurnCredentialsProvider = () => Promise<IceServerConfig[]>

type Fetcher = typeof fetch

const CLOUDFLARE_TURN_BASE_URL = 'https://rtc.live.cloudflare.com/v1/turn/keys'
const CREDENTIAL_REQUEST_TIMEOUT_MS = 5_000

export function createCloudflareTurnCredentialsProvider(
  config: CloudflareTurnConfig,
  fetcher: Fetcher = fetch,
): TurnCredentialsProvider {
  const endpoint = `${CLOUDFLARE_TURN_BASE_URL}/${encodeURIComponent(config.keyId)}/credentials/generate-ice-servers`

  return async () => {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ttl: config.ttlSeconds }),
      signal: AbortSignal.timeout(CREDENTIAL_REQUEST_TIMEOUT_MS),
    })

    if (!response.ok) {
      throw new Error(`Cloudflare TURN credential request failed with status ${response.status}`)
    }

    return parseIceServers(await response.json())
  }
}

function parseIceServers(payload: unknown): IceServerConfig[] {
  if (!isRecord(payload) || !Array.isArray(payload.iceServers)) {
    throw new Error('Cloudflare TURN returned an invalid response')
  }

  const iceServers = payload.iceServers.map(parseIceServer).filter((server) => server.urls.length > 0)
  const hasTurnCredentials = iceServers.some((server) => server.username && server.credential)
  if (!hasTurnCredentials) throw new Error('Cloudflare TURN response did not include relay credentials')
  return iceServers
}

function parseIceServer(value: unknown): IceServerConfig {
  if (!isRecord(value)) throw new Error('Cloudflare TURN returned an invalid ICE server')

  const candidateUrls = typeof value.urls === 'string' ? [value.urls] : value.urls
  if (!Array.isArray(candidateUrls) || !candidateUrls.every((url) => typeof url === 'string')) {
    throw new Error('Cloudflare TURN returned invalid ICE server URLs')
  }

  const urls = candidateUrls.filter((url) => !/:53(?:\?|$)/.test(url))
  const username = optionalString(value.username)
  const credential = optionalString(value.credential)
  if ((username && !credential) || (!username && credential)) {
    throw new Error('Cloudflare TURN returned incomplete relay credentials')
  }

  return {
    urls,
    ...(username ? { username } : {}),
    ...(credential ? { credential } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Cloudflare TURN returned invalid relay credentials')
  }
  return value
}
