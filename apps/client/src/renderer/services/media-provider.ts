import type { Credentials, Presence } from '@concord/protocol'
import type { CaptureResolution } from '../../shared/capture'
import { CloudflareRoomService } from './cloudflare/room'
import { LiveKitRoomService } from './livekit/room'
import type { RoomSnapshot } from './cloudflare/types'
import type { MediaService } from './room-session'
import { serverUrl } from './server'

// Provider selection belongs to the server, so all participants use the same SFU.
export class SelectableMediaService implements MediaService {
  private delegate?: MediaService
  private controller?: AbortController
  private generation = 0
  private snapshot: (value: RoomSnapshot) => void = () => undefined
  private connection: (value: 'connected' | 'reconnecting' | 'disconnected') => void = () => undefined
  constructor(private readonly create = (provider: 'livekit' | 'cloudflare'): MediaService =>
    provider === 'livekit' ? new LiveKitRoomService() : new CloudflareRoomService()) {}

  onSnapshot(listener: typeof this.snapshot): void { this.snapshot = listener; this.delegate?.onSnapshot(listener) }
  onConnection(listener: typeof this.connection): void { this.connection = listener; this.delegate?.onConnection(listener) }
  async connect(credentials: Credentials): Promise<void> {
    const cleanup = this.disconnect()
    const generation = this.generation
    await cleanup
    if (generation !== this.generation) throw new DOMException('Entrada cancelada.', 'AbortError')
    const controller = new AbortController()
    this.controller = controller
    const response = await fetch(`${serverUrl}/v1/media/config`, { cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
    if (!response.ok) throw new Error('Não foi possível consultar o provedor de mídia.')
    const { provider } = await response.json() as { provider: string }
    if (provider !== 'livekit' && provider !== 'cloudflare') throw new Error('Provedor de mídia inválido.')
    if (generation !== this.generation) throw new DOMException('Entrada cancelada.', 'AbortError')
    const media = this.create(provider)
    this.delegate = media
    media.onSnapshot(value => { if (this.delegate === media) this.snapshot(value) })
    media.onConnection(value => { if (this.delegate === media) this.connection(value) })
    try {
      await media.connect(credentials)
      if (generation !== this.generation) { await media.disconnect(); throw new DOMException('Entrada cancelada.', 'AbortError') }
    } catch (error) {
      if (this.delegate === media) await this.disconnect()
      throw error
    }
  }
  async disconnect(): Promise<void> {
    this.generation++
    this.controller?.abort(); this.controller = undefined
    const media = this.delegate; this.delegate = undefined
    await media?.disconnect()
    this.snapshot({ participants: [], shares: [], remoteVoiceTracks: [] })
  }
  updateCredentials(value: Credentials): void { this.delegate?.updateCredentials(value) }
  updatePresence(value: Presence): void { this.delegate?.updatePresence(value) }
  setSignalingAvailable(value: boolean): void { this.delegate?.setSignalingAvailable(value) }
  async publishScreen(stream: MediaStream, resolution: CaptureResolution): Promise<void> {
    if (!this.delegate) { stream.getTracks().forEach(t => t.stop()); throw new Error('Entre na sala antes de compartilhar.') }
    await this.delegate.publishScreen(stream, resolution)
  }
  async unpublishScreen(): Promise<void> { await this.delegate?.unpublishScreen() }
  async publishMicrophone(track: MediaStreamTrack): Promise<void> {
    if (!this.delegate) { track.stop(); throw new Error('Entre na sala antes de ativar o microfone.') }
    await this.delegate.publishMicrophone(track)
  }
  async unpublishMicrophone(): Promise<void> { await this.delegate?.unpublishMicrophone() }
  async pauseShare(key: string): Promise<void> { await this.delegate?.pauseShare(key) }
  async resumeShare(key: string): Promise<void> { await this.delegate?.resumeShare(key) }
  async getDiagnostics(): Promise<unknown> { return this.delegate?.getDiagnostics?.() }
}
