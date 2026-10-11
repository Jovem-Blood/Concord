import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudflareRoomService, SignalingError } from './room'
import type { RoomPresence, RoomSnapshot } from './types'
import { PresenceSoundNotifier } from '../sounds'

class FakeTrack {
  readyState = 'live'
  enabled = true
  muted = false
  onended: (() => void) | null = null
  constructor(readonly kind: string, readonly id: string) {}
  stop = vi.fn(() => { this.readyState = 'ended' })
}
class FakePeer extends EventTarget {
  static instances: FakePeer[] = []
  connectionState = 'new'
  iceGatheringState = 'complete'
  onconnectionstatechange: (() => void) | null = null
  ontrack: ((event: { track: FakeTrack; transceiver: { mid: string } }) => void) | null = null
  localDescription: { toJSON: () => unknown } | null = null
  transceivers: { mid: string; sender: { track: FakeTrack | null; replaceTrack: (t: FakeTrack | null) => Promise<void> }; receiver: { track: FakeTrack }; stop: () => void }[] = []
  constructor() { super(); FakePeer.instances.push(this) }
  addTransceiver(track: FakeTrack) {
    const sender = { track: track as FakeTrack | null, replaceTrack: async (replacement: FakeTrack | null) => { sender.track = replacement } }
    const transceiver = { mid: String(this.transceivers.length), sender, receiver: { track: new FakeTrack(track.kind, 'unused') }, stop: vi.fn() }
    this.transceivers.push(transceiver)
    return transceiver
  }
  getTransceivers() { return this.transceivers }
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' } }
  async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' } }
  async setLocalDescription(description: unknown) { this.localDescription = { toJSON: () => description } }
  async setRemoteDescription(description: { type: string; sdp: string }) {
    if (description.type === 'offer') {
      const incoming = JSON.parse(description.sdp) as { mid: string; kind: string }[]
      for (const item of incoming) {
        const track = new FakeTrack(item.kind, `remote-${item.mid}`)
        const transceiver = { mid: item.mid, sender: { track: null, replaceTrack: async () => undefined }, receiver: { track }, stop: vi.fn() }
        this.transceivers.push(transceiver)
        this.ontrack?.({ track, transceiver })
      }
    }
    this.connectionState = 'connected'
    this.onconnectionstatechange?.()
    this.dispatchEvent(new Event('connectionstatechange'))
  }
  close() { this.connectionState = 'closed' }
}
const services: CloudflareRoomService[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.disconnect()))
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  FakePeer.instances = []
})

function setup() {
  vi.useFakeTimers()
  vi.stubGlobal('RTCPeerConnection', FakePeer)
  const presence: RoomPresence = { participants: [{ identity: 'local', name: 'Local', connection: 'connected', voice: { available: false } }, { identity: 'remote', name: 'Remote', connection: 'connected', voice: { available: false } }], tracks: [] }
  let nextSessionStatus = 200
  let nextRemoteMid = 0
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    const path = url.split('/v1/')[1]!
    const body = options.body ? JSON.parse(String(options.body)) : {}
    calls.push({ path, body })
    if (path === 'session') {
      if (!options.body && new Headers(options.headers).get('content-type') === 'application/json') {
        return new Response('{"error":"FST_ERR_CTP_EMPTY_JSON_BODY"}', { status: 400 })
      }
      const status = nextSessionStatus
      nextSessionStatus = 200
      return new Response('{"sessionId":"local-session"}', { status })
    }
    if (path === 'tracks') {
      const tracks = body.tracks as { location: string; mid?: string; kind?: string; sessionId?: string; trackName: string }[]
      if (tracks[0]!.location === 'local') return new Response(JSON.stringify({ tracks, sessionDescription: { type: 'answer', sdp: 'answer-sdp' } }))
      const mapped = tracks.map((t) => ({ ...t, mid: `remote-${nextRemoteMid++}` }))
      return new Response(JSON.stringify({ tracks: mapped, requiresImmediateRenegotiation: true,
        sessionDescription: { type: 'offer', sdp: JSON.stringify(mapped.map((t) => ({ mid: t.mid, kind: presence.tracks.find((p) => p.trackName === t.trackName)!.kind }))) } }))
    }
    if (path === 'media/prepare') return new Response(JSON.stringify({ dataChannel: { id: 0 },
      requiresImmediateRenegotiation: true, sessionDescription: { type: 'offer', sdp: '[]' } }))
    if (path === 'tracks/close') return new Response(JSON.stringify({ tracks: (body.mids as string[]).map((mid) => ({ mid })),
      sessionDescription: { type: 'answer', sdp: 'answer-sdp' } }))
    return new Response('{}')
  })
  vi.stubGlobal('fetch', fetcher)
  const service = new CloudflareRoomService()
  services.push(service)
  const snapshots: RoomSnapshot[] = []
  const states: string[] = []
  service.onSnapshot((snapshot) => snapshots.push(snapshot))
  service.onConnection((state) => states.push(state))
  const update = async () => { service.updatePresence(structuredClone(presence)); await vi.advanceTimersByTimeAsync(0) }
  const connect = async () => {
    await service.connect({ participantToken: 'opaque-token', identity: 'local', expiresAt: Date.now() + 7200000 })
    service.setSignalingAvailable(true)
    await update()
  }
  const stream = (audio = true) => {
    const tracks = [new FakeTrack('video', 'screen'), ...(audio ? [new FakeTrack('audio', 'system-audio')] : [])]
    return { tracks, media: { getTracks: () => tracks, getVideoTracks: () => tracks.filter((t) => t.kind === 'video'), getAudioTracks: () => tracks.filter((t) => t.kind === 'audio') } as unknown as MediaStream }
  }
  return {
    service, presence, calls, states, snapshots, connect, stream, update, fetcher,
    failNextSession: (status: number) => { nextSessionStatus = status },
  }
}

describe('Cloudflare WebRTC room lifecycle', () => {
  it('identifies signaling errors for classified diagnostics', () => {
    expect(new SignalingError(503)).toMatchObject({ name: 'SignalingError', status: 503 })
  })

  it('preserves per-track SFU errors before applying a rejected SDP and stops the microphone', async () => {
    const { connect, service, fetcher } = setup()
    await connect()
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({
        tracks: [{ errorCode: 'invalid_session_description' }],
        sessionDescription: { type: 'answer', sdp: 'invalid-sdp' },
      })))
    const setRemote = vi.spyOn(FakePeer.prototype, 'setRemoteDescription')
    const microphone = new FakeTrack('audio', 'microphone')
    await expect(service.publishMicrophone(microphone as unknown as MediaStreamTrack)).rejects.toMatchObject({
      code: 'TRACK_PUBLISH_FAILED',
      cause: expect.objectContaining({ message: 'SFU could not process tracks: invalid_session_description' }),
    })
    expect(setRemote).not.toHaveBeenCalled()
    expect(microphone.readyState).toBe('ended')
    expect(FakePeer.instances[0]!.connectionState).toBe('closed')
  })

  it('sends the gathered offer instead of the initial candidate-free SDP', async () => {
    const { connect, service, stream, calls } = setup()
    await connect()
    const setLocal = FakePeer.prototype.setLocalDescription
    vi.spyOn(FakePeer.prototype, 'setLocalDescription').mockImplementation(async function (this: FakePeer, description) {
      await setLocal.call(this, description)
      this.iceGatheringState = 'gathering'
    })
    const publishing = service.publishScreen(stream(false).media, '720p')
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.some((call) => call.path === 'tracks')).toBe(false)
    const peer = FakePeer.instances[0]!
    peer.localDescription = { toJSON: () => ({ type: 'offer', sdp: 'gathered-offer-sdp' }) }
    peer.iceGatheringState = 'complete'
    peer.dispatchEvent(new Event('icegatheringstatechange'))
    await publishing
    expect(calls.find((call) => call.path === 'tracks')!.body.sessionDescription).toEqual({ type: 'offer', sdp: 'gathered-offer-sdp' })
  })

  it('waits for candidates before sending the answer to an SFU subscription offer', async () => {
    const { connect, service, presence, calls } = setup()
    await connect()
    calls.length = 0
    const setLocal = FakePeer.prototype.setLocalDescription
    vi.spyOn(FakePeer.prototype, 'setLocalDescription').mockImplementation(async function (this: FakePeer, description) {
      await setLocal.call(this, description)
      this.iceGatheringState = 'gathering'
    })
    presence.tracks.push({ sessionId: 'remote-session', trackName: 'screen', kind: 'video', source: 'screen-video', participantIdentity: 'remote', participantName: 'Remote' })
    service.updatePresence(presence)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.some((call) => call.path === 'renegotiate')).toBe(false)
    const peer = FakePeer.instances[0]!
    peer.localDescription = { toJSON: () => ({ type: 'answer', sdp: 'gathered-answer-sdp' }) }
    peer.iceGatheringState = 'complete'
    peer.dispatchEvent(new Event('icegatheringstatechange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.find((call) => call.path === 'renegotiate')!.body.sessionDescription).toEqual({ type: 'answer', sdp: 'gathered-answer-sdp' })
  })

  it('stops local capture synchronously while the room controller owns departure', async () => {
    const { connect, service, stream, calls } = setup()
    await connect()
    const capture = stream()
    await service.publishScreen(capture.media, '720p')
    const leaving = service.disconnect()
    expect(capture.tracks.every((track) => track.readyState === 'ended')).toBe(true)
    expect(calls.some((call) => call.path === 'leave')).toBe(false)
    await leaving
  })

  it('does not play a leave sound when a remote screen ends', async () => {
    const { connect, service, presence, snapshots, update } = setup()
    const play = vi.fn()
    const notifier = new PresenceSoundNotifier(play)
    await connect()
    notifier.update(snapshots[snapshots.length - 1]!.participants)
    service.onSnapshot((snapshot) => notifier.update(snapshot.participants))
    presence.tracks.push({ sessionId: 'remote-session', trackName: 'screen', kind: 'video', source: 'screen-video', participantIdentity: 'remote', participantName: 'Remote' })
    await update()
    presence.tracks.length = 0
    await update()
    expect(play).not.toHaveBeenCalled()
    presence.participants.pop()
    await update()
    expect(play).toHaveBeenCalledExactlyOnceWith('leave')
  })

  it('prepares RTC as a muted viewer without asking for capture or publishing media', async () => {
    const { connect, calls, snapshots } = setup()
    await connect()
    expect(calls.map((call) => call.path)).toEqual(['session', 'ice-servers', 'media/prepare', 'renegotiate'])
    expect(FakePeer.instances).toHaveLength(1)
    expect(FakePeer.instances[0]!.connectionState).toBe('connected')
    expect(snapshots[snapshots.length - 1]!.participants[0]!.isLocal).toBe(true)
  })

  it('publishes video and audio in one offer, then detaches and closes both', async () => {
    const { connect, service, calls, stream } = setup()
    await connect()
    const capture = stream()
    await service.publishScreen(capture.media, '720p')
    expect(calls.find((c) => c.path === 'tracks')!.body).toMatchObject({
      sessionDescription: { type: 'offer' },
      tracks: [{ location: 'local', kind: 'video', source: 'screen-video', mid: '0' }, { location: 'local', kind: 'audio', source: 'screen-audio', mid: '1' }],
    })
    await service.unpublishScreen()
    expect(calls[calls.length - 1]).toEqual({ path: 'tracks/close', body: { mids: ['0', '1'], sessionDescription: { type: 'offer', sdp: 'offer-sdp' } } })
    expect(capture.tracks.every((track) => track.readyState === 'ended')).toBe(true)
    expect(FakePeer.instances[0]!.transceivers.every((t) => t.sender.track === null)).toBe(true)
    await service.unpublishScreen()
    expect(calls.filter((c) => c.path === 'tracks/close')).toHaveLength(1)
  })

  it('keeps microphone and screen lifecycles independent', async () => {
    const { connect, service, calls, stream } = setup()
    await connect()
    const microphone = new FakeTrack('audio', 'microphone')
    await service.publishMicrophone(microphone as unknown as MediaStreamTrack)
    const capture = stream(true)
    await service.publishScreen(capture.media, '720p')
    expect((calls.filter((c) => c.path === 'tracks')[0]!.body.tracks as { source: string }[]).map((t) => t.source)).toEqual(['microphone'])
    expect((calls.filter((c) => c.path === 'tracks')[1]!.body.tracks as { source: string }[]).map((t) => t.source)).toEqual(['screen-video', 'screen-audio'])
    await service.unpublishScreen()
    expect(microphone.readyState).toBe('live')
    expect(calls[calls.length - 1]).toEqual({ path: 'tracks/close', body: { mids: ['1', '2'], sessionDescription: { type: 'offer', sdp: 'offer-sdp' } } })
    await service.unpublishMicrophone()
    expect(microphone.readyState).toBe('ended')
    expect(calls[calls.length - 1]).toEqual({ path: 'tracks/close', body: { mids: ['0'], sessionDescription: { type: 'offer', sdp: 'offer-sdp' } } })
  })

  it('receives first with an SFU offer, answers, groups audio/video and removes stopped shares', async () => {
    const { connect, calls, presence, snapshots, update } = setup()
    presence.tracks = [{ kind: 'video' as const, source: 'screen-video' as const }, { kind: 'audio' as const, source: 'screen-audio' as const }].map(({ kind, source }) => ({ sessionId: 'publisher-session', trackName: kind, kind, source, participantIdentity: 'remote', participantName: 'Remote' }))
    await connect()
    expect(calls.find((c) => c.path === 'tracks')!.body).not.toHaveProperty('sessionDescription')
    expect(calls.find((c) => c.path === 'renegotiate')!.body).toEqual({ sessionDescription: { type: 'answer', sdp: 'answer-sdp' } })
    expect(snapshots[snapshots.length - 1]!.shares).toHaveLength(1)
    expect(snapshots[snapshots.length - 1]!.shares[0]).toMatchObject({ participantName: 'Remote', videoTrack: { kind: 'video' }, audioTrack: { kind: 'audio' } })
    presence.tracks = []
    await update()
    expect(calls[calls.length - 1]!.path).toBe('tracks/close')
    expect(snapshots[snapshots.length - 1]!.shares).toEqual([])
  })

  it('rebuilds a failed peer and republishes the existing live capture', async () => {
    const { connect, service, calls, stream, states } = setup()
    await connect()
    const capture = stream(false)
    await service.publishScreen(capture.media, '1080p')
    const oldPeer = FakePeer.instances[0]!
    oldPeer.connectionState = 'failed'
    oldPeer.onconnectionstatechange?.()
    await vi.advanceTimersByTimeAsync(3000)
    expect(oldPeer.connectionState).toBe('closed')
    expect(FakePeer.instances).toHaveLength(2)
    expect(calls.filter((c) => c.path === 'tracks')).toHaveLength(2)
    expect(capture.tracks[0]!.readyState).toBe('live')
    expect(states).toContain('reconnecting')
    expect(states[states.length - 1]).toBe('connected')
  })

  it('keeps media alive through a brief ICE disconnect', async () => {
    const { connect, service, stream, states } = setup()
    await connect()
    const capture = stream(false)
    await service.publishScreen(capture.media, '720p')
    const peer = FakePeer.instances[0]!

    peer.connectionState = 'disconnected'
    peer.onconnectionstatechange?.()
    await vi.advanceTimersByTimeAsync(6_000)

    expect(FakePeer.instances).toHaveLength(1)
    expect(capture.tracks[0]!.readyState).toBe('live')
    peer.connectionState = 'connected'
    peer.onconnectionstatechange?.()
    expect(states[states.length - 1]).toBe('connected')
  })

  it('keeps working media and pauses recovery while room signaling is unavailable', async () => {
    const { connect, service, stream, calls } = setup()
    await connect()
    const capture = stream(false)
    await service.publishScreen(capture.media, '720p')
    service.setSignalingAvailable(false)
    const count = calls.length
    await vi.advanceTimersByTimeAsync(25_000)
    expect(calls).toHaveLength(count)
    expect(capture.tracks[0]!.readyState).toBe('live')
    expect(FakePeer.instances).toHaveLength(1)

    service.setSignalingAvailable(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(FakePeer.instances).toHaveLength(1)
  })

  it('recovers the warm transport without retrying a failed publication', async () => {
    const { connect, service, calls, stream, states, fetcher } = setup()
    await connect()
    const capture = stream(false)
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 500 }))

    await expect(service.publishScreen(capture.media, '720p')).rejects.toThrow('não pôde ser transmitida')
    expect(capture.tracks[0]!.readyState).toBe('ended')
    expect(states[states.length - 1]).toBe('reconnecting')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls.filter((call) => call.path === 'session')).toHaveLength(2)
    expect(calls.filter((call) => call.path === 'tracks')).toHaveLength(0)
    expect(states[states.length - 1]).toBe('connected')
  })

  it('reports revoked media credentials to the room controller', async () => {
    const { connect, service, stream, failNextSession, states } = setup()
    await connect()
    const capture = stream(false)
    await service.publishScreen(capture.media, '720p')
    failNextSession(401)
    FakePeer.instances[0]!.connectionState = 'failed'
    FakePeer.instances[0]!.onconnectionstatechange?.()
    await vi.advanceTimersByTimeAsync(3000)
    expect(states[states.length - 1]).toBe('disconnected')
    await service.disconnect()
    expect(capture.tracks[0]!.readyState).toBe('ended')
  })

  it('does not continue polling after explicit disconnect', async () => {
    const { connect, service, calls } = setup()
    await connect()
    await service.disconnect()
    const count = calls.length
    await vi.advanceTimersByTimeAsync(60000)
    expect(calls).toHaveLength(count)
    expect(calls.some((call) => call.path === 'room' || call.path === 'leave')).toBe(false)
  })
  it('keeps two simultaneous screen streams and voice independent when one publisher stops', async () => {
    const { connect, service, presence, snapshots, update } = setup()
    await connect()
    const microphone = new FakeTrack('audio', 'microphone')
    await service.publishMicrophone(microphone as unknown as MediaStreamTrack)
    presence.tracks = ['alice', 'bob'].flatMap((identity) => [
      { sessionId: `${identity}-session`, trackName: 'video', kind: 'video' as const, source: 'screen-video' as const, participantIdentity: identity, participantName: identity },
      { sessionId: `${identity}-session`, trackName: 'audio', kind: 'audio' as const, source: 'screen-audio' as const, participantIdentity: identity, participantName: identity },
    ])
    await update()
    const peer = FakePeer.instances[0]!
    const bob = snapshots[snapshots.length - 1]!.shares.find((share) => share.participantIdentity === 'bob')!
    expect(snapshots[snapshots.length - 1]!.shares).toHaveLength(2)
    expect(bob.videoTrack).toBeDefined()
    expect(bob.audioTrack).toBeDefined()
    presence.tracks = presence.tracks.filter((track) => track.participantIdentity !== 'alice')
    service.updatePresence(structuredClone(presence))
    // Discovery withdrawal hides an ended share even before asynchronous closure completes.
    expect(snapshots[snapshots.length - 1]!.shares).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(snapshots[snapshots.length - 1]!.shares[0]!.videoTrack).toBe(bob.videoTrack)
    expect(snapshots[snapshots.length - 1]!.shares[0]!.audioTrack).toBe(bob.audioTrack)
    expect(microphone.readyState).toBe('live')
    expect(FakePeer.instances).toEqual([peer])
  })
  it('serializes screen publication behind an outstanding subscription answer', async () => {
    const { connect, service, presence, calls, fetcher, stream } = setup()
    await connect()
    const originalFetch = fetcher.getMockImplementation()!
    let acceptAnswer!: () => void
    fetcher.mockImplementation(async (url, options) => {
      if (url.endsWith('/renegotiate')) await new Promise<void>((resolve) => { acceptAnswer = resolve })
      return originalFetch(url, options)
    })
    presence.tracks.push({ sessionId: 'remote-session', trackName: 'video', kind: 'video', source: 'screen-video', participantIdentity: 'remote', participantName: 'Remote' })
    service.updatePresence(presence)
    await vi.advanceTimersByTimeAsync(0)
    const publishing = service.publishScreen(stream().media, '720p')
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.filter((call) => call.path === 'tracks')).toHaveLength(1)
    acceptAnswer()
    await publishing
    expect(calls.filter((call) => call.path === 'tracks')).toHaveLength(2)
    expect(FakePeer.instances).toHaveLength(1)
  })
  it('keeps existing media when a discovered track disappears before subscription', async () => {
    const { connect, service, presence, fetcher, snapshots } = setup()
    await connect()
    const microphone = new FakeTrack('audio', 'microphone')
    await service.publishMicrophone(microphone as unknown as MediaStreamTrack)
    fetcher.mockResolvedValueOnce(new Response('{}', { status: 403 }))
    presence.tracks.push({ sessionId: 'gone', trackName: 'video', kind: 'video', source: 'screen-video', participantIdentity: 'remote', participantName: 'Remote' })
    service.updatePresence(presence)
    await vi.advanceTimersByTimeAsync(0)
    presence.tracks = []
    service.updatePresence(presence)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(FakePeer.instances).toHaveLength(1)
    expect(microphone.readyState).toBe('live')
    expect(snapshots[snapshots.length - 1]!.shares).toEqual([])
  })
  it('recovers an unexpectedly ended receiver track while retaining the live microphone', async () => {
    const { connect, service, presence, snapshots, update } = setup()
    await connect()
    const microphone = new FakeTrack('audio', 'microphone')
    await service.publishMicrophone(microphone as unknown as MediaStreamTrack)
    presence.tracks.push({ sessionId: 'remote-session', trackName: 'video', kind: 'video', source: 'screen-video', participantIdentity: 'remote', participantName: 'Remote' })
    await update()
    const oldTrack = snapshots[snapshots.length - 1]!.shares[0]!.videoTrack as unknown as FakeTrack
    oldTrack.stop()
    oldTrack.onended?.()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(snapshots[snapshots.length - 1]!.shares[0]!.videoTrack).toBeDefined()
    expect(snapshots[snapshots.length - 1]!.shares[0]!.videoTrack).not.toBe(oldTrack)
    expect(microphone.readyState).toBe('live')
    expect(FakePeer.instances).toHaveLength(2)
  })
  it('applies the closure answer even when an individual close fails, then restores other sources', async () => {
    const { connect, service, stream, fetcher, states } = setup()
    await connect()
    const microphone = new FakeTrack('audio', 'microphone')
    await service.publishMicrophone(microphone as unknown as MediaStreamTrack)
    await service.publishScreen(stream(false).media, '720p')
    const setRemote = vi.spyOn(FakePeer.prototype, 'setRemoteDescription')
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ tracks: [{ mid: '1', errorCode: 'close_track_error' }],
      sessionDescription: { type: 'answer', sdp: 'close-answer' } })))
    await service.unpublishScreen()
    expect(setRemote).toHaveBeenCalledWith({ type: 'answer', sdp: 'close-answer' })
    expect(states[states.length - 1]).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(FakePeer.instances).toHaveLength(2)
    expect(microphone.readyState).toBe('live')
    expect(states[states.length - 1]).toBe('connected')
  })
})
