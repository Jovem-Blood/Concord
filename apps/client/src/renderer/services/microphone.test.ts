import { afterEach, describe, expect, it, vi } from 'vitest'
import { MicrophoneService } from './microphone'

class Track {
  kind = 'audio'; readyState = 'live'; enabled = true; onended: (() => void) | null = null
  stop = vi.fn(() => { this.readyState = 'ended' })
}
afterEach(() => vi.unstubAllGlobals())
describe('microphone lifecycle', () => {
  it('asks for audio only on activation and mutes without signaling', async () => {
    const track = new Track()
    const getUserMedia = vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const publisher = { publishMicrophone: vi.fn(async () => undefined), unpublishMicrophone: vi.fn(async () => undefined) }
    const states: { muted: boolean }[] = []
    const service = new MicrophoneService(publisher, (state) => states.push(state), vi.fn())
    expect(getUserMedia).not.toHaveBeenCalled()
    await service.toggle()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } }, video: false })
    expect(publisher.publishMicrophone).toHaveBeenCalledOnce()
    await service.toggle()
    expect(track.enabled).toBe(false)
    expect(states[states.length - 1]?.muted).toBe(true)
    expect(publisher.publishMicrophone).toHaveBeenCalledOnce()
  })
  it('stops a late permission result after leave', async () => {
    const track = new Track()
    let resolve!: (stream: unknown) => void
    const getUserMedia = vi.fn(() => new Promise((done) => { resolve = done }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const publisher = { publishMicrophone: vi.fn(async () => undefined), unpublishMicrophone: vi.fn(async () => undefined) }
    const service = new MicrophoneService(publisher, vi.fn(), vi.fn())
    const pending = service.toggle()
    service.reset()
    resolve({ getAudioTracks: () => [track], getTracks: () => [track] })
    await pending
    expect(track.stop).toHaveBeenCalledOnce()
    expect(publisher.publishMicrophone).not.toHaveBeenCalled()
  })
})
