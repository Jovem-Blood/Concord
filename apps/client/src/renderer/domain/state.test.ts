import { describe, expect, it } from 'vitest'
import { transitionRoom, transitionShare } from './state'

describe('state transitions', () => {
  it('supports the normal room lifecycle', () => {
    expect(transitionRoom('idle', 'joining')).toBe('joining')
    expect(transitionRoom('reconnecting', 'connected')).toBe('connected')
  })

  it('rejects impossible room transitions', () => {
    expect(() => transitionRoom('idle', 'connected')).toThrow('Invalid room transition')
  })

  it('supports capture cancellation and cleanup', () => {
    expect(transitionShare('selecting', 'idle')).toBe('idle')
    expect(transitionShare('sharing', 'stopping')).toBe('stopping')
    expect(transitionShare('stopping', 'idle')).toBe('idle')
  })
})
