import { AppError } from '../../../shared/errors'
import type { CaptureProfile } from '../../../shared/capture'
import { tokenServerUrl, type JoinResponse } from '../token'
import type { PublishedTrack, RemoteShareView, RoomPresence, RoomSnapshot, SfuResponse } from './types'

type ConnectionState = 'connected' | 'reconnecting' | 'disconnected'
type Subscription = { source: PublishedTrack; mid: string }
const trackKey = (track: PublishedTrack) => `${track.sessionId}:${track.trackName}`

export class SignalingError extends Error {
  constructor(public readonly status: number) { super(`Room API responded with ${status}`) }
}

export class CloudflareRoomService {
  private credentials: JoinResponse | null = null
  private pc: RTCPeerConnection | null = null
  private controller = new AbortController()
  private generation = 0
  private queue: Promise<unknown> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | undefined
  private snapshotListener: ((snapshot: RoomSnapshot) => void) | null = null
  private connectionListener: ((state: ConnectionState) => void) | null = null
  private presence: RoomPresence = { participants: [], tracks: [] }
  private subscriptions = new Map<string, Subscription>()
  private localTransceivers: RTCRtpTransceiver[] = []
  private localStream: MediaStream | null = null
  private profile: CaptureProfile = 'smooth'
  private needsReset = false
  private disconnectedAt = 0
  private failures = 0

  onSnapshot(listener: (snapshot: RoomSnapshot) => void): void { this.snapshotListener = listener }
  onConnection(listener: (state: ConnectionState) => void): void { this.connectionListener = listener }

  async connect(credentials: JoinResponse): Promise<void> {
    await this.disconnect()
    this.credentials = credentials
    this.controller = new AbortController()
    this.failures = 0
    const generation = this.generation
    try {
      await this.enqueue(() => this.synchronize())
      if (generation !== this.generation) return
      this.connectionListener?.('connected')
      this.schedule()
    } catch (error) {
      await this.disconnect()
      throw new AppError('ROOM_CONNECT_FAILED', 'Não foi possível conectar à sala.', { cause: error })
    }
  }

  async publishScreen(stream: MediaStream, profile: CaptureProfile): Promise<void> {
    return this.enqueue(async () => {
      if (!this.credentials) throw new AppError('NETWORK_DISCONNECTED', 'Você não está conectado a uma sala.')
      if (!stream.getVideoTracks().some((t) => t.readyState === 'live')) {
        throw new AppError('CAPTURE_SOURCE_GONE', 'A fonte selecionada não está mais disponível.')
      }
      try {
        await this.unpublish()
        this.localStream = stream
        this.profile = profile
        await this.publish()
      } catch (error) {
        this.localStream = null
        stream.getTracks().forEach((track) => track.stop())
        // Publishing failed, but room polling is still healthy. Retry media only on the next explicit share.
        this.disposePeer()
        this.connectionListener?.('connected')
        throw new AppError('TRACK_PUBLISH_FAILED', 'A captura iniciou, mas não pôde ser transmitida.', { cause: error })
      }
    })
  }

  unpublishScreen(): Promise<void> {
    // Stop capture immediately, even if negotiation is waiting for the network.
    this.localStream?.getTracks().forEach((track) => track.stop())
    this.localStream = null
    return this.enqueue(async () => {
      try { await this.unpublish() } catch {
        this.needsReset = true
        this.connectionListener?.('reconnecting')
      }
    })
  }

  async disconnect(): Promise<void> {
    const credentials = this.credentials
    this.credentials = null
    this.generation++
    this.controller.abort()
    clearTimeout(this.timer)
    this.localStream?.getTracks().forEach((track) => track.stop())
    this.localStream = null
    this.disposePeer()
    this.presence = { participants: [], tracks: [] }
    this.emitSnapshot()
    await this.queue.catch(() => undefined)
    if (credentials) {
      await fetch(`${tokenServerUrl}/v1/leave`, {
        method: 'POST', headers: { authorization: `Bearer ${credentials.participantToken}` },
        keepalive: true, signal: AbortSignal.timeout(5_000),
      }).catch(() => undefined)
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const generation = this.generation
    const result = this.queue.then(() => {
      if (generation !== this.generation) throw new DOMException('Session changed', 'AbortError')
      return operation()
    })
    this.queue = result.catch(() => undefined)
    return result
  }

  private async api<T>(path: string, body?: unknown): Promise<T> {
    const credentials = this.credentials
    const generation = this.generation
    if (!credentials) throw new SignalingError(401)
    const response = await fetch(`${tokenServerUrl}/v1/${path}`, {
      method: path === 'room' ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${credentials.participantToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(25_000)]),
    })
    if (!response.ok) throw new SignalingError(response.status)
    const result = await response.json() as T
    if (generation !== this.generation) throw new DOMException('Session changed', 'AbortError')
    return result
  }

  private async ensurePeer(): Promise<RTCPeerConnection> {
    if (this.pc) return this.pc
    await this.api('session')
    const pc = new RTCPeerConnection({ iceServers: this.credentials!.iceServers, bundlePolicy: 'max-bundle' })
    this.pc = pc
    this.needsReset = false
    pc.ontrack = (event) => {
      if (this.pc !== pc) return
      event.track.onended = () => this.emitSnapshot()
      this.emitSnapshot()
    }
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return
      if (pc.connectionState === 'connected') {
        this.disconnectedAt = 0
        this.connectionListener?.('connected')
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.disconnectedAt ||= Date.now()
        this.needsReset ||= pc.connectionState === 'failed'
        this.connectionListener?.('reconnecting')
      }
    }
    return pc
  }

  private async negotiate(result: SfuResponse, pc: RTCPeerConnection): Promise<void> {
    if (result.sessionDescription) {
      await pc.setRemoteDescription(result.sessionDescription)
      if (result.sessionDescription.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer())
        await this.api('renegotiate', { sessionDescription: pc.localDescription!.toJSON() })
      }
    } else if (result.requiresImmediateRenegotiation) {
      throw new Error('SFU requested renegotiation without an SDP offer')
    }
    if (result.tracks?.some((track) => track.errorCode)) throw new Error('SFU could not process all tracks')
  }

  private async publish(): Promise<void> {
    const stream = this.localStream
    if (!stream) return
    const tracks = stream.getTracks().filter((track) => track.readyState === 'live')
    if (!tracks.some((track) => track.kind === 'video')) { this.localStream = null; return }
    const pc = await this.ensurePeer()
    this.localTransceivers = tracks.map((track) => pc.addTransceiver(track, {
      direction: 'sendonly', streams: [stream],
      sendEncodings: [{ maxBitrate: track.kind === 'audio' ? 128_000 : this.profile === 'smooth' ? 5_000_000 : 3_000_000,
        ...(track.kind === 'video' ? { maxFramerate: this.profile === 'smooth' ? 30 : 15 } : {}) }],
    }))
    await pc.setLocalDescription(await pc.createOffer())
    // Browser track IDs are opaque; use our own portable names in the signaling API.
    const publications = this.localTransceivers.map((transceiver) => ({
      location: 'local', mid: transceiver.mid, trackName: crypto.randomUUID(),
      kind: transceiver.sender.track!.kind,
    }))
    const result = await this.api<SfuResponse>('tracks', {
      sessionDescription: pc.localDescription!.toJSON(),
      tracks: publications,
    })
    await this.negotiate(result, pc)
    if (result.tracks?.length !== tracks.length || !result.sessionDescription ||
        publications.some((track) => !result.tracks?.some((published) => published.trackName === track.trackName && published.mid))) {
      throw new Error('Incomplete publication response')
    }
    await this.waitConnected(pc)
  }

  private async unpublish(): Promise<void> {
    const transceivers = this.localTransceivers
    this.localTransceivers = []
    this.localStream = null
    for (const transceiver of transceivers) {
      await transceiver.sender.replaceTrack(null).catch(() => undefined)
      transceiver.stop()
    }
    const mids = transceivers.map((t) => t.mid).filter((mid): mid is string => mid !== null)
    if (mids.length && this.credentials) {
      const result = await this.api<SfuResponse>('tracks/close', { mids })
      if (result.tracks?.some((t) => t.errorCode)) throw new Error('Could not close published tracks')
    }
  }

  private async synchronize(): Promise<void> {
    this.presence = await this.api<RoomPresence>('room')
    this.emitSnapshot()
    if (this.disconnectedAt && Date.now() - this.disconnectedAt > 8_000) this.needsReset = true
    if (this.needsReset) {
      this.disposePeer()
      // Reset even an idle session to withdraw any partially published tracks.
      await this.ensurePeer()
      await this.publish()
    }
    const wanted = this.presence.tracks.filter((t) => t.participantIdentity !== this.credentials!.identity)
    const keys = new Set(wanted.map(trackKey))
    const removed = [...this.subscriptions.entries()].filter(([key]) => !keys.has(key))
    if (removed.length) {
      const result = await this.api<SfuResponse>('tracks/close', { mids: removed.map(([, t]) => t.mid) })
      if (result.tracks?.some((t) => t.errorCode)) throw new Error('Could not close subscriptions')
      for (const [key, subscription] of removed) {
        const transceiver = this.pc?.getTransceivers().find((t) => t.mid === subscription.mid)
        transceiver?.receiver.track.stop()
        transceiver?.stop()
        this.subscriptions.delete(key)
      }
      this.emitSnapshot()
    }
    const added = wanted.filter((t) => !this.subscriptions.has(trackKey(t)))
    for (let offset = 0; offset < added.length; offset += 32) {
      const batch = added.slice(offset, offset + 32)
      const pc = await this.ensurePeer()
      const result = await this.api<SfuResponse>('tracks', {
        tracks: batch.map((t) => ({ location: 'remote', sessionId: t.sessionId, trackName: t.trackName })),
      })
      // ontrack may fire during setRemoteDescription, so register mids before negotiation.
      for (const track of result.tracks ?? []) {
        const source = batch.find((t) => t.sessionId === track.sessionId && t.trackName === track.trackName)
        if (source && track.mid && !track.errorCode) this.subscriptions.set(trackKey(source), { source, mid: track.mid })
      }
      await this.negotiate(result, pc)
      if (batch.some((t) => !this.subscriptions.has(trackKey(t)))) throw new Error('Incomplete subscription response')
      await this.waitConnected(pc)
      this.emitSnapshot()
    }
  }

  private schedule(): void {
    const generation = this.generation
    this.timer = setTimeout(() => {
      void this.enqueue(() => this.synchronize()).then(() => {
        this.failures = 0
        if (!this.pc || this.pc.connectionState === 'connected' || this.pc.connectionState === 'new') {
          this.connectionListener?.('connected')
        }
      }).catch((error: unknown) => {
        if (generation !== this.generation) return
        this.failures++
        if ((error instanceof SignalingError && error.status === 401) || this.failures >= 8) {
          void this.disconnect().then(() => this.connectionListener?.('disconnected'))
          return
        }
        this.needsReset = true
        this.connectionListener?.('reconnecting')
      }).finally(() => {
        if (generation === this.generation && this.credentials) this.schedule()
      })
    }, Math.min(3_000 * 2 ** this.failures, 15_000))
  }

  private waitConnected(pc: RTCPeerConnection): Promise<void> {
    if (pc.connectionState === 'connected') return Promise.resolve()
    const signal = this.controller.signal
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout)
        pc.removeEventListener('connectionstatechange', check)
        signal.removeEventListener('abort', abort)
        if (error) reject(error); else resolve()
      }
      const check = () => {
        if (pc.connectionState === 'connected') finish()
        else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') finish(new Error('WebRTC connection failed'))
      }
      const abort = () => finish(new DOMException('Session closed', 'AbortError'))
      const timeout = setTimeout(() => finish(new Error('WebRTC connection timed out')), 20_000)
      pc.addEventListener('connectionstatechange', check)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort(); else check()
    })
  }

  private disposePeer(): void {
    const pc = this.pc
    this.pc = null
    if (pc) {
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.close()
    }
    this.localTransceivers = []
    this.subscriptions.clear()
    this.needsReset = false
    this.disconnectedAt = 0
  }

  private emitSnapshot(): void {
    const shares = new Map<string, RemoteShareView>()
    for (const { source, mid } of this.subscriptions.values()) {
      const track = this.pc?.getTransceivers().find((t) => t.mid === mid)?.receiver.track
      if (!track || track.readyState === 'ended') continue
      const key = `${source.participantIdentity}:${source.sessionId}`
      const share = shares.get(key) ?? {
        key, participantIdentity: source.participantIdentity, participantName: source.participantName,
        streamName: source.sessionId,
      }
      if (source.kind === 'video') share.videoTrack = track
      else share.audioTrack = track
      shares.set(key, share)
    }
    this.snapshotListener?.({
      participants: this.presence.participants.map((p) => ({ ...p, isLocal: p.identity === this.credentials?.identity })),
      shares: [...shares.values()],
    })
  }
}
