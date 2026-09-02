import type { VoiceState } from './cloudflare/types'

type Publisher = { publishMicrophone(track: MediaStreamTrack): Promise<void>; unpublishMicrophone(): Promise<void> }
export class MicrophoneService {
  private track: MediaStreamTrack | null = null
  private epoch = 0
  private busy = false
  private state: VoiceState = { joined: false, muted: true, deafened: false, microphoneAvailable: false }
  constructor(private readonly publisher: Publisher,
    private readonly changed: (state: VoiceState, track: MediaStreamTrack | null, busy: boolean) => void,
    private readonly error: (message: string) => void) {}
  async toggle(): Promise<void> {
    if (this.busy) return
    if (this.track?.readyState === 'live') {
      this.state.muted = !this.state.muted
      this.track.enabled = !this.state.muted
      this.emit(); return
    }
    const epoch = this.epoch
    this.busy = true; this.emit()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 },
      }, video: false })
      if (epoch !== this.epoch) { stream.getTracks().forEach((track) => track.stop()); return }
      const track = stream.getAudioTracks()[0]
      if (!track) { stream.getTracks().forEach((t) => t.stop()); throw new DOMException('No microphone', 'NotFoundError') }
      this.track = track
      track.onended = () => {
        this.reset()
        void this.publisher.unpublishMicrophone()
        this.error('O microfone foi desconectado. Você ainda pode ouvir a sala e usar o chat.')
      }
      await this.publisher.publishMicrophone(track)
      if (epoch !== this.epoch) { track.stop(); return }
      this.state = { ...this.state, joined: true, muted: false, microphoneAvailable: true }
    } catch (error) {
      if (epoch !== this.epoch) return
      this.track?.stop(); this.track = null
      this.state = { ...this.state, joined: false, muted: true, microphoneAvailable: false }
      this.error(microphoneError(error))
    } finally { if (epoch === this.epoch) { this.busy = false; this.emit() } }
  }
  toggleDeafen(): void { this.state.deafened = !this.state.deafened; this.emit() }
  reset(): void {
    this.epoch++
    if (this.track) { this.track.onended = null; this.track.stop() }
    this.track = null; this.busy = false
    this.state = { joined: false, muted: true, deafened: false, microphoneAvailable: false }; this.emit()
  }
  private emit(): void { this.changed({ ...this.state }, this.track, this.busy) }
}
export function microphoneError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microfone não autorizado. Libere a permissão e tente novamente. Você pode continuar ouvindo e usando o chat.'
  if (name === 'NotFoundError') return 'Nenhum microfone encontrado. Conecte um dispositivo e tente novamente.'
  if (name === 'NotReadableError') return 'O microfone está ocupado ou indisponível. Confira o dispositivo e tente novamente.'
  return 'Não foi possível ativar o microfone. Você pode continuar ouvindo e usando o chat.'
}
