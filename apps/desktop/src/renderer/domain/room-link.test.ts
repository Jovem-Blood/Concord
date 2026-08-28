import { describe, expect, it } from 'vitest'
import { createRoomLink, roomCodeFromRoute } from './room-link'

describe('room links', () => {
  it('creates a zero-install web URL for a room', () => {
    expect(createRoomLink('https://share.example.com', 'abcd-2345')).toBe(
      'https://share.example.com/ABCD2345',
    )
  })

  it('accepts valid route params and rejects unrelated paths', () => {
    expect(roomCodeFromRoute('abcd2345')).toBe('ABCD2345')
    expect(roomCodeFromRoute(['WXYZ6789'])).toBe('WXYZ6789')
    expect(roomCodeFromRoute('settings')).toBe('')
  })
})
