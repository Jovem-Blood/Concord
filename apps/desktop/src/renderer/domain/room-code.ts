const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
type RandomFill = (bytes: Uint8Array) => Uint8Array

export function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '')
}

export function isValidRoomCode(value: string): boolean {
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8,12}$/.test(normalizeRoomCode(value))
}

export function generateRoomCode(
  length = 8,
  random: RandomFill = (bytes) => crypto.getRandomValues(bytes),
): string {
  if (!Number.isInteger(length) || length < 8 || length > 12) {
    throw new RangeError('Room code length must be between 8 and 12')
  }

  const bytes = new Uint8Array(length)
  random(bytes)
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]!).join('')
}
