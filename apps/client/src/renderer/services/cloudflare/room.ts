import { AppError } from '../../../shared/errors'
import type { CaptureResolution } from '../../../shared/capture'
import { serverUrl, type JoinResponse } from '../server'
import type { MediaSource, PublishedTrack, RemoteShareView, RemoteVoiceTrack, RoomPresence, RoomSnapshot, SfuResponse } from './types'
import { logClient } from '../telemetry'
import { waitForIceGathering } from './ice'

type ConnectionState = 'connected' | 'reconnecting' | 'disconnected'
type Subscription = { source: PublishedTrack; mid: string }
const trackKey = (track: PublishedTrack) => `${track.sessionId}:${track.trackName}`

export class SignalingError extends Error {
  constructor(public readonly status: number) { super(`Room API responded with ${status}`) }
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]

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
  private localTransceivers = new Map<MediaSource, RTCRtpTransceiver>()
  private localStream: MediaStream | null = null
  private microphone: MediaStreamTrack | null = null
  private signalingAvailable = false
  private syncQueued = false
  private presenceRevision = 0
  private resolution: CaptureResolution = '720p'
  private needsReset = false
  private disconnectedAt = 0
  private failures = 0
  private connectionState: ConnectionState | null = null
  private pausedShares = new Set<string>()
  private iceServers: RTCIceServer[] = ICE_SERVERS

  private connection(state: ConnectionState, error?: unknown): void {
    if (this.connectionState !== state) {
      logClient(state === 'connected' ? 'info' : state === 'disconnected' ? 'error' : 'warn',
        `room.${state}`, { error, attempt: this.failures })
      this.connectionState = state
    }
    this.connectionListener?.(state)
  }

  onSnapshot(listener: (snapshot: RoomSnapshot) => void): void { this.snapshotListener = listener }
  onConnection(listener: (state: ConnectionState) => void): void { this.connectionListener = listener }
  updateCredentials(credentials: JoinResponse): void { this.credentials = credentials }
  setSignalingAvailable(available: boolean): void {
    this.signalingAvailable = available
    if (!available) clearTimeout(this.timer)
    else this.reconcile()
  }
  updatePresence(presence: RoomPresence): void {
    this.presenceRevision++
    this.presence = presence
    this.emitSnapshot()
    this.reconcile()
  }
  private reconcile(): void {
    if (!this.credentials || !this.signalingAvailable || this.syncQueued) return
    this.syncQueued = true
    const revision = this.presenceRevision
    const generation = this.generation
    void this.enqueue(() => this.synchronize()).catch((error: unknown) => {
      if (generation !== this.generation) return
      if (error instanceof SignalingError && error.status === 401) this.connection('disconnected', error)
      else this.signalReconnecting(false, error)
    }).finally(() => {
      if (generation !== this.generation) return
      this.syncQueued = false
      if (revision !== this.presenceRevision) this.reconcile()
      else if (this.needsReset || this.disconnectedAt) this.schedule()
    })
  }
  pauseShare(shareKey: string): Promise<void> {
    this.pausedShares.add(shareKey)
    return this.closeShareSubscriptions(shareKey)
  }

  resumeShare(shareKey: string): Promise<void> {
    this.pausedShares.delete(shareKey)
    return this.enqueue(() => this.synchronize())
  }
  async connect(credentials: JoinResponse): Promise<void> {
    await this.disconnect()
    this.credentials = credentials
    this.controller = new AbortController()
    this.failures = 0
    this.syncQueued = false
  }

  async publishScreen(stream: MediaStream, resolution: CaptureResolution): Promise<void> {
    return this.enqueue(async () => {
      if (!this.credentials) throw new AppError('NETWORK_DISCONNECTED', 'Você não está conectado a uma sala.')
      if (!stream.getVideoTracks().some((t) => t.readyState === 'live')) {
        throw new AppError('CAPTURE_SOURCE_GONE', 'A fonte selecionada não está mais disponível.')
      }
      try {
        await this.unpublish(['screen-video', 'screen-audio'])
        this.localStream = stream
        this.resolution = resolution
        await this.publish()
      } catch (error) {
        this.localStream = null
        stream.getTracks().forEach((track) => track.stop())
        this.disposePeer()
        // Restore another active source, but never retry the failed capture itself.
        if (this.microphone?.readyState === 'live') this.signalReconnecting()
        else this.connection('connected')
        logClient('error', 'screen.publish.failed', { error, code: 'TRACK_PUBLISH_FAILED' })
        throw new AppError('TRACK_PUBLISH_FAILED', 'A captura iniciou, mas não pôde ser transmitida.', { cause: error })
      }
    })
  }

  unpublishScreen(): Promise<void> {
    // Stop capture immediately, even if negotiation is waiting for the network.
    this.localStream?.getTracks().forEach((track) => track.stop())
    this.localStream = null
    return this.enqueue(async () => {
      try { await this.unpublish(['screen-video', 'screen-audio']) } catch (error) {
        logClient('warn', 'screen.unpublish.failed', { error })
        this.needsReset = true
        this.signalReconnecting()
      }
    })
  }

  publishMicrophone(track: MediaStreamTrack): Promise<void> {
    return this.enqueue(async () => {
      if (!this.credentials || track.kind !== 'audio' || track.readyState !== 'live') throw new Error('Microfone indisponível.')
      await this.unpublish(['microphone'])
      this.microphone = track
      try { await this.publish() } catch (error) {
        this.microphone = null
        track.stop()
        this.disposePeer()
        if (this.localStream?.getVideoTracks().some((t) => t.readyState === 'live')) this.signalReconnecting()
        else this.connection('connected')
        logClient('error', 'microphone.publish.failed', { error, code: 'TRACK_PUBLISH_FAILED' })
        throw new AppError('TRACK_PUBLISH_FAILED', 'Não foi possível transmitir o microfone. Tente novamente.', { cause: error })
      }
    })
  }
  unpublishMicrophone(): Promise<void> {
    this.microphone?.stop()
    this.microphone = null
    return this.enqueue(async () => {
      try { await this.unpublish(['microphone']) } catch (error) {
        logClient('warn', 'microphone.unpublish.failed', { error })
        this.needsReset = true; this.signalReconnecting()
      }
    })
  }

  async disconnect(): Promise<void> {
    this.credentials = null
    this.signalingAvailable = false
    this.generation++
    this.controller.abort()
    clearTimeout(this.timer)
    this.localStream?.getTracks().forEach((track) => track.stop())
    this.localStream = null
    this.microphone?.stop()
    this.microphone = null
    this.disposePeer()
    this.presence = { participants: [], tracks: [] }
    this.pausedShares.clear()
    this.iceServers = ICE_SERVERS
    this.emitSnapshot()
    await this.queue.catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) logClient('debug', 'room.queue.cancelled', { error })
    })
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
    const response = await fetch(`${serverUrl}/v1/${path}`, {
      method: path === 'ice-servers' ? 'GET' : 'POST',
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
    const ice = await this.api<{ iceServers?: RTCIceServer[] }>('ice-servers')
    if (ice.iceServers?.length) this.iceServers = ice.iceServers
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' })
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
        this.connection('connected')
      } else if (pc.connectionState === 'disconnected') {
        this.disconnectedAt ||= Date.now()
        // ICE can report a short-lived disconnect while changing routes or recovering
        // packets. Keep the current tracks alive and only rebuild after the grace period.
        this.signalReconnecting(false, new Error('WebRTC disconnected'))
      } else if (pc.connectionState === 'failed') {
        this.disconnectedAt ||= Date.now()
        this.signalReconnecting(true, new Error('WebRTC failed'))
      }
    }
    return pc
  }

  private async negotiate(result: SfuResponse, pc: RTCPeerConnection): Promise<void> {
    if (result.sessionDescription) {
      await pc.setRemoteDescription(result.sessionDescription)
      if (result.sessionDescription.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer())
        await waitForIceGathering(pc, this.controller.signal)
        await this.api('renegotiate', { sessionDescription: pc.localDescription!.toJSON() })
      }
    } else if (result.requiresImmediateRenegotiation) {
      throw new Error('SFU requested renegotiation without an SDP offer')
    }
    if (result.tracks?.some((track) => track.errorCode)) throw new Error('SFU could not process all tracks')
  }

  private async publish(): Promise<void> {
    const stream = this.localStream
    const wanted: { source: MediaSource; track: MediaStreamTrack; stream?: MediaStream }[] = []
    if (this.microphone?.readyState === 'live') wanted.push({ source: 'microphone', track: this.microphone })
    if (stream?.getVideoTracks().some((t) => t.readyState === 'live')) {
      for (const track of stream.getTracks().filter((t) => t.readyState === 'live')) {
        const source = track.kind === 'video' ? 'screen-video' : 'screen-audio'
        if (!wanted.some((t) => t.source === source)) wanted.push({ source, track, stream })
      }
    }
    const tracks = wanted.filter((t) => !this.localTransceivers.has(t.source))
    if (!tracks.length) return
    const pc = await this.ensurePeer()
    for (const { track, source, stream: mediaStream } of tracks) {
      const transceiver = pc.addTransceiver(track, {
      direction: 'sendonly', ...(mediaStream ? { streams: [mediaStream] } : {}),
      sendEncodings: [{ maxBitrate: source === 'microphone' ? 64_000 : track.kind === 'audio' ? 128_000 : this.resolution === '720p' ? 3_000_000 : 5_000_000,
        ...(track.kind === 'video' ? { maxFramerate: 30 } : {}) }],
      })
      // Prefer Opus for speech without rewriting negotiated SDP.
      if (source === 'microphone' && typeof RTCRtpSender !== 'undefined') {
        const codecs = RTCRtpSender.getCapabilities('audio')?.codecs
        if (codecs?.some((c) => c.mimeType.toLowerCase() === 'audio/opus')) {
          transceiver.setCodecPreferences([...codecs].sort((a, b) => Number(b.mimeType.toLowerCase() === 'audio/opus') - Number(a.mimeType.toLowerCase() === 'audio/opus')))
        }
      }
      this.localTransceivers.set(source, transceiver)
    }
    await pc.setLocalDescription(await pc.createOffer())
    // This HTTP signaling flow has no trickle ICE: include gathered candidates in SDP.
    await waitForIceGathering(pc, this.controller.signal)
    // Browser track IDs are opaque; use our own portable names in the signaling API.
    const publications = tracks.map(({ source }) => {
      const transceiver = this.localTransceivers.get(source)!
      return {
      location: 'local', mid: transceiver.mid, trackName: crypto.randomUUID(),
      kind: transceiver.sender.track!.kind, source,
    } })
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

  private async unpublish(sources: MediaSource[]): Promise<void> {
    const transceivers = sources.flatMap((source) => {
      const transceiver = this.localTransceivers.get(source)
      this.localTransceivers.delete(source)
      return transceiver ? [transceiver] : []
    })
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
    if (!this.signalingAvailable || !this.credentials) return
    this.emitSnapshot()
    if (this.disconnectedAt && Date.now() - this.disconnectedAt > 8_000) this.needsReset = true
    if (this.needsReset) {
      this.disposePeer()
      // Reset even an idle session to withdraw any partially published tracks.
      await this.ensurePeer()
      await this.publish()
    }
    const wanted = this.presence.tracks.filter((t) => t.participantIdentity !== this.credentials!.identity &&
      (t.source === 'microphone' || !this.pausedShares.has(`${t.participantIdentity}:${t.sessionId}`)))
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
      try {
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
      } catch (error) {
        // A tracks/new request or SDP exchange may have partially changed either side.
        // Recreate the session on the next pass rather than layering another offer on it.
        this.needsReset = true
        throw error
      }
    }
  }

  private closeShareSubscriptions(shareKey: string): Promise<void> {
    if (!this.signalingAvailable) return Promise.resolve()
    return this.enqueue(async () => {
      const removed = [...this.subscriptions.entries()].filter(([, subscription]) =>
        subscription.source.source !== 'microphone' &&
        `${subscription.source.participantIdentity}:${subscription.source.sessionId}` === shareKey)
      if (!removed.length || !this.credentials) return
      const result = await this.api<SfuResponse>('tracks/close', { mids: removed.map(([, subscription]) => subscription.mid) })
      if (result.tracks?.some((track) => track.errorCode)) throw new Error('Could not close share subscriptions')
      for (const [key, subscription] of removed) {
        const transceiver = this.pc?.getTransceivers().find((item) => item.mid === subscription.mid)
        transceiver?.receiver.track.stop()
        transceiver?.stop()
        this.subscriptions.delete(key)
      }
      this.emitSnapshot()
    })
  }

  private schedule(): void {
    clearTimeout(this.timer)
    if (!this.signalingAvailable || !this.credentials) return
    const generation = this.generation
    this.timer = setTimeout(() => {
      void this.enqueue(() => this.synchronize()).then(() => {
        this.failures = 0
        if (!this.needsReset && (!this.pc || this.pc.connectionState === 'connected' || this.pc.connectionState === 'new')) {
          this.connection('connected')
        }
      }).catch((error: unknown) => {
        if (generation !== this.generation) return
        this.failures++
        if (error instanceof SignalingError && error.status === 401) {
          logClient('error', 'room.session.expired', { error, attempt: this.failures })
          this.connection('disconnected', error)
          return
        }
        // Signaling and media use separate paths. A temporary API outage must not tear
        // down a healthy WebRTC connection (or stop capture); keep retrying in place.
        logClient(this.failures === 1 ? 'warn' : 'debug', 'media.recovery.failed', { error, attempt: this.failures })
        this.signalReconnecting(false, error)
      }).finally(() => {
        if (generation === this.generation && this.credentials && (this.needsReset || this.disconnectedAt || this.failures)) this.schedule()
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
      const timeout = setTimeout(() => finish(new DOMException(
        `WebRTC connection timed out (connection=${pc.connectionState}, ice=${pc.iceConnectionState}, gathering=${pc.iceGatheringState})`,
        'TimeoutError',
      )), 20_000)
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
    this.localTransceivers.clear()
    this.subscriptions.clear()
    this.needsReset = false
    this.disconnectedAt = 0
  }

  private signalReconnecting(resetPeer = true, error?: unknown): void {
    if (resetPeer) this.needsReset = true
    this.connection('reconnecting', error)
    this.schedule()
  }

  private emitSnapshot(): void {
    const shares = new Map<string, RemoteShareView>()
    const remoteVoiceTracks: RemoteVoiceTrack[] = []
    for (const source of this.presence.tracks) {
      if (source.participantIdentity === this.credentials?.identity || source.source === 'microphone') continue
      const key = `${source.participantIdentity}:${source.sessionId}`
      if (!shares.has(key)) shares.set(key, {
        key, participantIdentity: source.participantIdentity, participantName: source.participantName,
        streamName: source.sessionId,
      })
    }
    for (const { source, mid } of this.subscriptions.values()) {
      const track = this.pc?.getTransceivers().find((t) => t.mid === mid)?.receiver.track
      if (!track || track.readyState === 'ended') continue
      if (source.source === 'microphone') {
        remoteVoiceTracks.push({ key: trackKey(source), participantIdentity: source.participantIdentity,
          participantName: source.participantName, track })
        continue
      }
      const key = `${source.participantIdentity}:${source.sessionId}`
      const share = shares.get(key) ?? {
        key, participantIdentity: source.participantIdentity, participantName: source.participantName,
        streamName: source.sessionId,
      }
      if (source.source === 'screen-video') share.videoTrack = track
      else if (source.source === 'screen-audio') share.audioTrack = track
      shares.set(key, share)
    }
    this.snapshotListener?.({
      participants: this.presence.participants.map((p) => ({ ...p, voice: p.voice ?? { available: false }, isLocal: p.identity === this.credentials?.identity })),
      shares: [...shares.values()],
      remoteVoiceTracks,
    })
  }
}
