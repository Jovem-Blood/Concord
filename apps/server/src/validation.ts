export const ROOM_CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8,12}$/

export type JoinInput = {
  roomCode: string
  displayName: string
}

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '')
}

export function parseJoinInput(value: unknown): JoinInput | null {
  if (!value || typeof value !== 'object') return null

  const candidate = value as Record<string, unknown>
  if (typeof candidate.roomCode !== 'string' || typeof candidate.displayName !== 'string') return null

  const roomCode = normalizeRoomCode(candidate.roomCode)
  const displayName = candidate.displayName.trim().normalize('NFC')
  if (!ROOM_CODE_PATTERN.test(roomCode) || displayName.length < 1 || displayName.length > 32) return null

  return { roomCode, displayName }
}
