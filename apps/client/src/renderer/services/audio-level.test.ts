import { describe, expect, it } from 'vitest'
import { playbackLevel } from './audio-level'

describe('local playback levels', () => {
  it('combines the headphone volume with the individual volume', () => {
    expect(playbackLevel(40, false, { volume: 50, muted: false })).toEqual({ volume: 0.2, muted: false })
    expect(playbackLevel(40, false)).toEqual({ volume: 0.4, muted: false })
  })
  it('preserves individual mute when the room is unmuted and keeps zero volume silent', () => {
    const participant = { volume: 75, muted: true }
    expect(playbackLevel(100, true, participant).muted).toBe(true)
    expect(playbackLevel(100, false, participant)).toEqual({ volume: 0.75, muted: true })
    expect(playbackLevel(100, true, { volume: 75, muted: false }).muted).toBe(true)
    expect(playbackLevel(0, false, { volume: 100, muted: false }).volume).toBe(0)
  })
})
