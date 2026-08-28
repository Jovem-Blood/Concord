import { describe, expect, it } from 'vitest'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from './room-code'

describe('room codes', () => {
  it('generates an eight-character code without ambiguous characters', () => {
    const code = generateRoomCode(8, (bytes) => {
      bytes.set([0, 1, 2, 3, 4, 5, 6, 7])
      return bytes
    })
    expect(code).toBe('ABCDEFGH')
    expect(isValidRoomCode(code)).toBe(true)
  })

  it('normalizes codes copied with spaces or hyphens', () => {
    expect(normalizeRoomCode(' abcd-2345 ')).toBe('ABCD2345')
  })

  it('rejects ambiguous and short codes', () => {
    expect(isValidRoomCode('ABCD10OL')).toBe(false)
    expect(isValidRoomCode('ABC234')).toBe(false)
  })
})
