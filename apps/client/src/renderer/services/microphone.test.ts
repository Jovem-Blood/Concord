import { afterEach, describe, expect, it, vi } from 'vitest'
import { MicrophoneService } from './microphone'
import { AppError } from '../../shared/errors'

class Track {
  kind = 'audio'; readyState = 'live'; enabled = true; onended: (() => void) | null = null
  stop = vi.fn(() => { this.readyState = 'ended' })
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('microphone lifecycle', () => {
  it('reports publication failures separately from microphone access failures and permits retry', async () => {
    const track = new Track()
    const replacement = new Track()
    const stream = (audio: Track) => ({ getAudioTracks: () => [audio], getTracks: () => [audio] })
    const getUserMedia = vi.fn().mockResolvedValueOnce(stream(track)).mockResolvedValueOnce(stream(replacement))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const failure = new AppError('TRACK_PUBLISH_FAILED', 'Não foi possível transmitir o microfone. Tente novamente.', {
      cause: new Error('SFU could not process tracks: invalid_session_description'),
    })
    const publisher = { publishMicrophone: vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined),
      unpublishMicrophone: vi.fn(async () => undefined) }
    const changed = vi.fn()
    const error = vi.fn()
    const service = new MicrophoneService(publisher, changed, error)
    await service.toggle()
    expect(error).toHaveBeenCalledWith(failure.message)
    expect(track.readyState).toBe('ended')
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ joined: false, muted: true }), null, false)
    await service.toggle()
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ joined: true, muted: false }), replacement, false)
    service.reset()
  })
  it('asks for audio only on activation and mutes without signaling', async () => {
    const track = new Track()
    const getUserMedia = vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const publisher = { publishMicrophone: vi.fn(async () => undefined), unpublishMicrophone: vi.fn(async () => undefined) }
    const states: { muted: boolean }[] = []
    const service = new MicrophoneService(publisher, (state) => states.push(state), vi.fn())
    expect(getUserMedia).not.toHaveBeenCalled()
    await service.toggle()
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: { ideal: 1 } }, video: false })
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
  it('times out pending permission, allows retry and stops the late capture', async () => {
    vi.useFakeTimers()
    const late = new Track()
    const replacement = new Track()
    let resolve!: (stream: unknown) => void
    const stream = (track: Track) => ({ getAudioTracks: () => [track], getTracks: () => [track] })
    const getUserMedia = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done }))
      .mockResolvedValueOnce(stream(replacement))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const publisher = { publishMicrophone: vi.fn(async () => undefined), unpublishMicrophone: vi.fn(async () => undefined) }
    const changed = vi.fn()
    const error = vi.fn()
    const service = new MicrophoneService(publisher, changed, error)
    const pending = service.toggle()
    await vi.advanceTimersByTimeAsync(20_000)
    await pending
    expect(error).toHaveBeenCalledWith(expect.stringContaining('demorou demais'))
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ muted: true }), null, false)
    await service.toggle()
    resolve(stream(late))
    await vi.advanceTimersByTimeAsync(0)
    expect(late.readyState).toBe('ended')
    expect(replacement.enabled).toBe(true)
    expect(publisher.publishMicrophone).toHaveBeenCalledOnce()
    service.reset()
  })
  it('keeps the microphone silent during publication and ignores a late success after timeout', async () => {
    vi.useFakeTimers()
    const track = new Track()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] })) } })
    let publish!: () => void
    const publisher = { publishMicrophone: vi.fn(() => new Promise<void>((resolve) => { publish = resolve })), unpublishMicrophone: vi.fn(async () => undefined) }
    const changed = vi.fn()
    const service = new MicrophoneService(publisher, changed, vi.fn())
    const pending = service.toggle()
    await vi.advanceTimersByTimeAsync(0)
    expect(track.enabled).toBe(false)
    await vi.advanceTimersByTimeAsync(20_000)
    await pending
    publish()
    await vi.advanceTimersByTimeAsync(0)
    expect(track.readyState).toBe('ended')
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ joined: false, muted: true }), null, false)
    expect(publisher.unpublishMicrophone).toHaveBeenCalledOnce()
    service.reset()
  })
})
