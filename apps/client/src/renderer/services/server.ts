import { AppError } from '../../shared/errors'
import { PROTOCOL_VERSION, type Credentials } from '@concord/protocol'

export type JoinResponse = Credentials

export const serverUrl = (import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001').replace(/\/$/, '')

export async function requestJoinToken(roomCode: string, displayName: string): Promise<JoinResponse> {
  try {
    const response = await fetch(`${serverUrl}/v1/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ roomCode, displayName, protocol: PROTOCOL_VERSION }),
      signal: AbortSignal.timeout(15_000),
    })

    if (response.status === 426) throw new AppError('ROOM_TOKEN_FAILED', 'Atualize o Concord para entrar nesta sala.')
    if (!response.ok) throw new Error(`Server responded with ${response.status}`)

    const result = (await response.json()) as Partial<JoinResponse>
    if (typeof result.participantToken !== 'string' || !result.participantToken ||
      typeof result.identity !== 'string' || !result.identity ||
      typeof result.expiresAt !== 'number' || !Number.isFinite(result.expiresAt) || result.expiresAt <= 0) {
      throw new Error('Invalid room response')
    }
    return result as JoinResponse
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(
      'ROOM_TOKEN_FAILED',
      'Não foi possível entrar na sala. Verifique se o servidor está disponível.',
      { cause: error },
    )
  }
}
