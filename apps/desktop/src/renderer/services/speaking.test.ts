import { describe, expect, it } from 'vitest'
import { SpeechGate } from './speaking'
describe('speaking debounce', () => {
  it('requires consecutive loud samples and keeps a release window', () => {
    const gate = new SpeechGate()
    expect(gate.update(.03, 0)).toBe(false)
    expect(gate.update(.03, 80)).toBe(true)
    expect(gate.update(0, 300)).toBe(true)
    expect(gate.update(0, 431)).toBe(false)
  })
})
