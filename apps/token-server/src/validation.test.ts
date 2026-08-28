import { describe, expect, it } from 'vitest'
import { parseJoinInput } from './validation.js'

describe('join validation', () => {
  it('normalizes valid input', () => {
    expect(parseJoinInput({ roomCode: 'abcd-2345', displayName: '  Thiago  ' })).toEqual({
      roomCode: 'ABCD2345',
      displayName: 'Thiago',
    })
  })

  it.each([
    null,
    {},
    { roomCode: 'SHORT', displayName: 'Thiago' },
    { roomCode: 'ABCD10OL', displayName: 'Thiago' },
    { roomCode: 'ABCD2345', displayName: '' },
    { roomCode: 'ABCD2345', displayName: 'x'.repeat(33) },
  ])('rejects invalid input %#', (value) => {
    expect(parseJoinInput(value)).toBeNull()
  })
})
