import { AppError } from '../../shared/errors'

export type JoinResponse = {
  serverUrl: string
  participantToken: string
  iceServers?: RTCIceServer[]
}

const tokenServerUrl = import.meta.env.VITE_TOKEN_SERVER_URL ?? 'http://localhost:3001'

export async function requestJoinToken(roomCode: string, displayName: string): Promise<JoinResponse> {
  try {
    const response = await fetch(`${tokenServerUrl}/v1/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomCode, displayName }),
    })

    if (!response.ok) throw new Error(`Token server responded with ${response.status}`)

    const result = (await response.json()) as Partial<JoinResponse>
    if (!result.serverUrl || !result.participantToken) throw new Error('Invalid token response')
    if (result.iceServers && !result.iceServers.every(isIceServer)) throw new Error('Invalid ICE server response')
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
