import { isValidRoomCode, normalizeRoomCode } from './room-code'

export function roomCodeFromRoute(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value
  if (typeof candidate !== 'string') return ''
  const roomCode = normalizeRoomCode(candidate)
  return isValidRoomCode(roomCode) ? roomCode : ''
}

export function createRoomLink(baseUrl: string, roomCode: string): string {
  const normalizedCode = normalizeRoomCode(roomCode)
  if (!isValidRoomCode(normalizedCode)) throw new Error('Invalid room code')
  return new URL(`/${encodeURIComponent(normalizedCode)}`, ensureTrailingSlash(baseUrl)).toString()
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}
