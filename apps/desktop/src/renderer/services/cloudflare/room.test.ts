import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudflareRoomService } from './room'
import type { RoomSnapshot } from './types'

class FakeTrack {
  readyState = 'live'
  onended: (() => void) | null = null
  constructor(readonly kind: string, readonly id: string) {}
  stop = vi.fn(() => { this.readyState = 'ended' })
}
class FakePeer extends EventTarget {
  static instances: FakePeer[] = []
  connectionState = 'new'
  onconnectionstatechange: (() => void) | null = null
  ontrack: ((event: { track: FakeTrack }) => void) | null = null
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
        this.transceivers.push({ mid: item.mid, sender: { track: null, replaceTrack: async () => undefined }, receiver: { track }, stop: vi.fn() })
        this.ontrack?.({ track })
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
  vi.useRealTimers()
  FakePeer.instances = []
})

function setup() {
  vi.useFakeTimers()
  vi.stubGlobal('RTCPeerConnection', FakePeer)
  const presence = { participants: [{ identity: 'local', name: 'Local' }, { identity: 'remote', name: 'Remote' }], tracks: [] as { sessionId: string; trackName: string; kind: string; participantIdentity: string; participantName: string }[] }
  let nextRoomStatus = 200
  let nextSessionStatus = 200
  const calls: { path: string; body: Record<string, unknown> }[] = []
  const fetcher = vi.fn(async (url: string, options: RequestInit) => {
    const path = url.split('/v1/')[1]!
    const body = options.body ? JSON.parse(String(options.body)) : {}
    calls.push({ path, body })
    if (path === 'room') {
      const status = nextRoomStatus
      nextRoomStatus = 200
      return new Response(JSON.stringify(presence), { status })
    }
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
      const mapped = tracks.map((t, i) => ({ ...t, mid: `remote-${i}` }))
      return new Response(JSON.stringify({ tracks: mapped, requiresImmediateRenegotiation: true,
        sessionDescription: { type: 'offer', sdp: JSON.stringify(mapped.map((t) => ({ mid: t.mid, kind: presence.tracks.find((p) => p.trackName === t.trackName)!.kind }))) } }))
    }
    return new Response('{}')
  })
  vi.stubGlobal('fetch', fetcher)
  const service = new CloudflareRoomService()
  services.push(service)
  const snapshots: RoomSnapshot[] = []
  const states: string[] = []
  service.onSnapshot((snapshot) => snapshots.push(snapshot))
  service.onConnection((state) => states.push(state))
  const connect = () => service.connect({ participantToken: 'opaque-token', identity: 'local', expiresAt: Date.now() + 7200000, iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] })
  const stream = (audio = true) => {
    const tracks = [new FakeTrack('video', 'screen'), ...(audio ? [new FakeTrack('audio', 'system-audio')] : [])]
    return { tracks, media: { getTracks: () => tracks, getVideoTracks: () => tracks.filter((t) => t.kind === 'video') } as unknown as MediaStream }
  }
  return {
    service, presence, calls, states, snapshots, connect, stream,
    failNextPoll: (status: number) => { nextRoomStatus = status },
    failNextSession: (status: number) => { nextSessionStatus = status },
  }
}

describe('Cloudflare WebRTC room lifecycle', () => {
  it('joins as a viewer without allocating media or asking for capture', async () => {
    const { connect, calls, snapshots } = setup()
    await connect()
    expect(calls.map((c) => c.path)).toEqual(['room'])
    expect(FakePeer.instances).toHaveLength(0)
    expect(snapshots[snapshots.length - 1]!.participants[0]!.isLocal).toBe(true)
  })

  it('publishes video and audio in one offer, then detaches and closes both', async () => {
    const { connect, service, calls, stream } = setup()
    await connect()
    const capture = stream()
    await service.publishScreen(capture.media, 'smooth')
    expect(calls.find((c) => c.path === 'tracks')!.body).toMatchObject({
      sessionDescription: { type: 'offer' },
      tracks: [{ location: 'local', kind: 'video', mid: '0' }, { location: 'local', kind: 'audio', mid: '1' }],
    })
    await service.unpublishScreen()
    expect(calls[calls.length - 1]).toEqual({ path: 'tracks/close', body: { mids: ['0', '1'] } })
    expect(capture.tracks.every((track) => track.readyState === 'ended')).toBe(true)
    expect(FakePeer.instances[0]!.transceivers.every((t) => t.sender.track === null)).toBe(true)
    await service.unpublishScreen()
    expect(calls.filter((c) => c.path === 'tracks/close')).toHaveLength(1)
  })

  it('receives first with an SFU offer, answers, groups audio/video and removes stopped shares', async () => {
    const { connect, calls, presence, snapshots } = setup()
    presence.tracks = ['video', 'audio'].map((kind) => ({ sessionId: 'publisher-session', trackName: kind, kind, participantIdentity: 'remote', participantName: 'Remote' }))
    await connect()
    expect(calls.find((c) => c.path === 'tracks')!.body).not.toHaveProperty('sessionDescription')
    expect(calls.find((c) => c.path === 'renegotiate')!.body).toEqual({ sessionDescription: { type: 'answer', sdp: 'answer-sdp' } })
    expect(snapshots[snapshots.length - 1]!.shares).toHaveLength(1)
    expect(snapshots[snapshots.length - 1]!.shares[0]).toMatchObject({ participantName: 'Remote', videoTrack: { kind: 'video' }, audioTrack: { kind: 'audio' } })
    presence.tracks = []
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls[calls.length - 1]!.path).toBe('tracks/close')
    expect(snapshots[snapshots.length - 1]!.shares).toEqual([])
  })

  it('rebuilds a failed peer and republishes the existing live capture', async () => {
    const { connect, service, calls, stream, states } = setup()
    await connect()
    const capture = stream(false)
    await service.publishScreen(capture.media, 'sharp')
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

  it('does not enter a reconnect loop when initial publication fails', async () => {
    const { connect, service, calls, stream, states, failNextSession } = setup()
    await connect()
    const capture = stream(false)
    failNextSession(500)

    await expect(service.publishScreen(capture.media, 'smooth')).rejects.toThrow('não pôde ser transmitida')
    expect(capture.tracks[0]!.readyState).toBe('ended')
    expect(states[states.length - 1]).toBe('connected')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls.filter((call) => call.path === 'session')).toHaveLength(1)
    expect(states[states.length - 1]).toBe('connected')
  })

  it('stops capture and clears state when the API revokes the participant token', async () => {
    const { connect, service, stream, failNextPoll, states, snapshots } = setup()
    await connect()
    const capture = stream(false)
    await service.publishScreen(capture.media, 'smooth')
    failNextPoll(401)
    await vi.advanceTimersByTimeAsync(3000)
    expect(capture.tracks[0]!.readyState).toBe('ended')
    expect(snapshots[snapshots.length - 1]).toEqual({ participants: [], shares: [] })
    expect(states[states.length - 1]).toBe('disconnected')
  })

  it('does not continue polling after explicit disconnect', async () => {
    const { connect, service, calls } = setup()
    await connect()
    await service.disconnect()
    const count = calls.length
    await vi.advanceTimersByTimeAsync(60000)
    expect(calls).toHaveLength(count)
    expect(calls[calls.length - 1]!.path).toBe('leave')
  })
})
