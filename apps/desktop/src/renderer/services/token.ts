import { AppError } from '../../shared/errors'

export type JoinResponse = {
  participantToken: string
  identity: string
  expiresAt: number
  iceServers: RTCIceServer[]
}

export const tokenServerUrl = (import.meta.env.VITE_TOKEN_SERVER_URL ?? 'http://localhost:3001').replace(/\/$/, '')

export async function requestJoinToken(roomCode: string, displayName: string): Promise<JoinResponse> {
  try {
    const response = await fetch(`${tokenServerUrl}/v1/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomCode, displayName }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) throw new Error(`Token server responded with ${response.status}`)

    const result = (await response.json()) as Partial<JoinResponse>
    if (typeof result.participantToken !== 'string' || !result.participantToken ||
      typeof result.identity !== 'string' || !result.identity ||
      typeof result.expiresAt !== 'number' || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) {
      throw new Error('Invalid room response')
    }
    if (!Array.isArray(result.iceServers) || !result.iceServers.length || !result.iceServers.every(isIceServer)) {
      throw new Error('Invalid ICE server response')
    }
    return result as JoinResponse
  } catch (error) {
    throw new AppError(
      'ROOM_TOKEN_FAILED',
      'Não foi possível entrar na sala. Verifique se o servidor está disponível.',
      { cause: error },
    )
  }
}

function isIceServer(value: unknown): value is RTCIceServer {
  if (!value || typeof value !== 'object') return false
  const server = value as Partial<RTCIceServer>
  const urls = typeof server.urls === 'string' ? [server.urls] : server.urls
  if (!Array.isArray(urls) || urls.length === 0 || !urls.every((url) => typeof url === 'string')) return false
  if (server.username !== undefined && typeof server.username !== 'string') return false
  if (server.credential !== undefined && typeof server.credential !== 'string') return false
  return true
}
