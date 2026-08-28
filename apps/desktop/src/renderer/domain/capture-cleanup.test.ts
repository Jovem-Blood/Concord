import { describe, expect, it, vi } from 'vitest'
import { stopMediaStream } from './capture-cleanup'

describe('capture cleanup', () => {
  it('stops every track only once', () => {
    const video = { stop: vi.fn(), onended: vi.fn() }
    const audio = { stop: vi.fn(), onended: vi.fn() }
    const stream = { getTracks: () => [video, audio] } as unknown as MediaStream

    stopMediaStream(stream)
    stopMediaStream(stream)

    expect(video.stop).toHaveBeenCalledTimes(1)
    expect(audio.stop).toHaveBeenCalledTimes(1)
    expect(video.onended).toBeNull()
    expect(audio.onended).toBeNull()
  })
})
