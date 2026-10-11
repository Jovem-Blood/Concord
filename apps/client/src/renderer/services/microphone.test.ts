import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MicrophoneService } from './microphone'
import { AppError } from '../../shared/errors'

class Track {
  kind = 'audio'; readyState = 'live'; enabled = true; onended: (() => void) | null = null
  stop = vi.fn(() => { this.readyState = 'ended' })
}
const contexts: { output: Track; gain: { value: number; setTargetAtTime: ReturnType<typeof vi.fn> }; close: ReturnType<typeof vi.fn> }[] = []
beforeEach(() => {
  contexts.length = 0
  vi.stubGlobal('AudioContext', class {
    currentTime = 0
    output = new Track()
    gain = { value: 1, setTargetAtTime: vi.fn() }
    close = vi.fn(async () => undefined)
    constructor() { contexts.push(this) }
    createMediaStreamSource() { return { connect: (node: unknown) => node } }
    createGain() { return { gain: this.gain, connect: vi.fn() } }
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [this.output] } } }
    async resume() {}
  })
})
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
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ joined: true, muted: false }), contexts[1]!.output, false)
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
    expect(contexts[0]!.output.enabled).toBe(false)
    expect(states[states.length - 1]?.muted).toBe(true)
    expect(publisher.publishMicrophone).toHaveBeenCalledOnce()
  })
  it('applies input volume to the published audio and releases capture and processing on reset', async () => {
    const track = new Track()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] })) } })
    const publisher = { publishMicrophone: vi.fn(async () => undefined), unpublishMicrophone: vi.fn(async () => undefined) }
    const service = new MicrophoneService(publisher, vi.fn(), vi.fn())
    service.setVolume(35)
    await service.toggle()
    const context = contexts[0]!
    expect(context.gain.value).toBe(0.35)
    expect(publisher.publishMicrophone).toHaveBeenCalledWith(context.output)
    service.setVolume(0)
    expect(context.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.01)
    await service.toggle()
    expect(track.enabled).toBe(false)
    expect(context.output.enabled).toBe(false)
    service.setVolume(80)
    expect(track.enabled).toBe(false)
    expect(context.output.enabled).toBe(false)
    await service.toggle()
    expect(track.enabled).toBe(true)
    expect(context.output.enabled).toBe(true)
    service.reset()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(context.output.stop).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
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
  it('selects an input before activation without requesting capture', async () => {
    const track = new Track()
    const getUserMedia = vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const publisher = { publishMicrophone: vi.fn(async () => undefined), unpublishMicrophone: vi.fn(async () => undefined) }
    const service = new MicrophoneService(publisher, vi.fn(), vi.fn())
    await service.setDevice('usb-mic')
    expect(getUserMedia).not.toHaveBeenCalled()
    await service.toggle()
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.objectContaining({ deviceId: { exact: 'usb-mic' } }) }))
    service.reset()
  })
  it('changes an active input while preserving mute, deafen and volume', async () => {
    const tracks = [new Track(), new Track()]
    const getUserMedia = vi.fn().mockResolvedValueOnce({ getAudioTracks: () => [tracks[0]], getTracks: () => [tracks[0]] })
      .mockResolvedValueOnce({ getAudioTracks: () => [tracks[1]], getTracks: () => [tracks[1]] })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const changed = vi.fn()
    const publisher = { publishMicrophone: vi.fn(async (track: MediaStreamTrack) => { expect(track.enabled).toBe(false) }), unpublishMicrophone: vi.fn(async () => undefined) }
    const service = new MicrophoneService(publisher, changed, vi.fn())
    service.setVolume(60)
    await service.toggle()
    await service.toggle()
    service.toggleDeafen()
    await service.setDevice('usb-mic')
    expect(tracks[0]!.readyState).toBe('ended')
    expect(contexts[0]!.close).toHaveBeenCalledOnce()
    expect(tracks[1]!.enabled).toBe(false)
    expect(contexts[1]!.output.enabled).toBe(false)
    expect(contexts[1]!.gain.value).toBe(0.6)
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ joined: true, muted: true, deafened: true }), contexts[1]!.output, false)
    service.reset()
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
