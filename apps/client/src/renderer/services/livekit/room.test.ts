import { afterEach, expect, it, vi } from 'vitest'
import { Room, Track, ScreenSharePresets } from 'livekit-client'
import { LiveKitRoomService } from './room'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
function track(kind: string) { return { kind, enabled: false, contentHint: '', stop: vi.fn() } as unknown as MediaStreamTrack }
function fixture() {
  const localParticipant = {
    trackPublications: new Map(),
    publishTrack: vi.fn(async (mediaStreamTrack: MediaStreamTrack) => ({ track: { mediaStreamTrack } })),
    unpublishTrack: vi.fn(async () => undefined),
  }
  const room = { localParticipant, remoteParticipants: new Map(), state: 'connected',
    on: vi.fn().mockReturnThis(), removeAllListeners: vi.fn(), connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined) }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ url: 'wss://test.livekit.cloud', token: 'scoped-token' }))))
  const service = new LiveKitRoomService(() => room as unknown as Room)
  const connect = () => service.connect({ participantToken: 'concord-token', identity: 'local', expiresAt: Date.now() + 60_000 })
  return { service, room, localParticipant, connect }
}

it('uses server-issued authorization and SDK screen presets without manually selecting layers', async () => {
  const { service, room, localParticipant, connect } = fixture()
  await connect()
  expect(room.connect).toHaveBeenCalledWith('wss://test.livekit.cloud', 'scoped-token')
  const video = track('video'), audio = track('audio')
  await service.publishScreen({ getTracks: () => [video, audio] } as unknown as MediaStream, '720p')
  expect(localParticipant.publishTrack).toHaveBeenCalledWith(video, expect.objectContaining({
    source: Track.Source.ScreenShare, simulcast: false, videoCodec: 'vp8', backupCodec: false, screenShareEncoding: ScreenSharePresets.h720fps30.encoding, degradationPreference: 'maintain-framerate',
  }))
  expect(localParticipant.publishTrack).toHaveBeenCalledWith(audio, expect.objectContaining({ source: Track.Source.ScreenShareAudio }))
  expect(video.contentHint).toBe('motion')
  await service.disconnect()
  expect(video.stop).toHaveBeenCalled()
  expect(audio.stop).toHaveBeenCalled()
  expect(room.disconnect).toHaveBeenCalled()
})

it('withdraws an already-published video if publishing screen audio fails', async () => {
  const { service, localParticipant, connect } = fixture()
  await connect()
  const video = track('video'), audio = track('audio')
  localParticipant.publishTrack.mockResolvedValueOnce({ track: { mediaStreamTrack: video } }).mockRejectedValueOnce(new Error('audio failed'))
  await expect(service.publishScreen({ getTracks: () => [video, audio] } as unknown as MediaStream, '1080p')).rejects.toThrow('audio failed')
  expect(localParticipant.unpublishTrack).toHaveBeenCalledWith({ mediaStreamTrack: video })
  expect(video.stop).toHaveBeenCalled()
  expect(audio.stop).toHaveBeenCalled()
  await service.disconnect()
})

it('keeps publisher and subscriber transport measurements distinct in the export', async () => {
  const { room, localParticipant, service, connect } = fixture()
  await connect()
  const publication = (type: string, rtt: number) => ({
    source: Track.Source.ScreenShare,
    track: { getRTCStatsReport: async () => new Map<string, object>([
      ['video', { type, kind: 'video', mid: '0', framesPerSecond: 25 }],
      ['pair', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: rtt }],
    ]) },
  })
  localParticipant.trackPublications.set('local', publication('outbound-rtp', 0.02))
  room.remoteParticipants.set('remote', { trackPublications: new Map([['screen', publication('inbound-rtp', 0.05)]]) })
  const snapshot = await service.getDiagnostics()
  expect(snapshot.tracks).toEqual(['outbound-rtp', 'inbound-rtp'].map(type => ({
    source: Track.Source.ScreenShare, type, kind: 'video', mid: '0', framesPerSecond: 25,
  })))
  expect(snapshot.transport).toEqual({ publisher: { currentRoundTripTime: 0.02 }, subscriber: { currentRoundTripTime: 0.05 } })
})

it('does not leave a late publication active after leaving the room', async () => {
  const { service, localParticipant, connect } = fixture()
  await connect()
  const video = track('video')
  let finish!: (value: { track: { mediaStreamTrack: MediaStreamTrack } }) => void
  localParticipant.publishTrack.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const publishing = service.publishScreen({ getTracks: () => [video] } as unknown as MediaStream, '720p')
  const rejected = expect(publishing).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(finish).toBeDefined())
  await service.disconnect()
  finish({ track: { mediaStreamTrack: video } })
  await rejected
  expect(localParticipant.unpublishTrack).toHaveBeenCalled()
  expect(video.stop).toHaveBeenCalled()
})

it('disconnects a failed media connection without starting any publications', async () => {
  const { room, connect } = fixture()
  room.connect.mockRejectedValueOnce(new Error('connection failed'))
  await expect(connect()).rejects.toThrow('connection failed')
  expect(room.disconnect).toHaveBeenCalled()
  expect(room.localParticipant.publishTrack).not.toHaveBeenCalled()
})
