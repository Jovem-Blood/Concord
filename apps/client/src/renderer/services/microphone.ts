import type { VoiceState } from './cloudflare/types'
import { AppError } from '../../shared/errors'
import { logClient } from './telemetry'

type Publisher = { publishMicrophone(track: MediaStreamTrack): Promise<void>; unpublishMicrophone(): Promise<void> }
const ACTIVATION_TIMEOUT_MS = 20_000
export class MicrophoneService {
  private track: MediaStreamTrack | null = null
  private epoch = 0
  private busy = false
  private cancelActivation: (() => void) | null = null
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
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new DOMException('Microphone activation timed out', 'TimeoutError')), ACTIVATION_TIMEOUT_MS)
        this.cancelActivation = () => reject(new DOMException('Microphone activation cancelled', 'AbortError'))
      })
      await Promise.race([this.activate(epoch), deadline])
    } catch (error) {
      if (epoch !== this.epoch) return
      // Invalidate late permission/publication results before making retry available.
      this.epoch++
      this.cancelActivation = null
      logClient('error', 'microphone.start.failed', { error })
      this.track?.stop(); this.track = null
      void this.publisher.unpublishMicrophone().catch((cleanupError: unknown) => logClient('warn', 'microphone.cleanup.failed', { error: cleanupError }))
      this.state = { ...this.state, joined: false, muted: true, microphoneAvailable: false }
      this.busy = false; this.emit()
      this.error(microphoneError(error))
    } finally {
      clearTimeout(timeout)
      if (epoch === this.epoch) { this.cancelActivation = null; this.busy = false; this.emit() }
    }
  }
  private async activate(epoch: number): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: { ideal: 1 },
    }, video: false })
    if (epoch !== this.epoch) { stream.getTracks().forEach((track) => track.stop()); return }
    const track = stream.getAudioTracks()[0]
    if (!track) { stream.getTracks().forEach((t) => t.stop()); throw new DOMException('No microphone', 'NotFoundError') }
    this.track = track
    // Capture remains silent until publication succeeds; failed activation never goes live.
    track.enabled = false
    track.onended = () => {
      if (epoch !== this.epoch) return
      logClient('warn', 'microphone.disconnected')
      this.reset()
      void this.publisher.unpublishMicrophone().catch((error: unknown) => logClient('warn', 'microphone.cleanup.failed', { error }))
      this.error('O microfone foi desconectado. Você ainda pode ouvir a sala e usar o chat.')
    }
    await this.publisher.publishMicrophone(track)
    if (epoch !== this.epoch) { track.stop(); return }
    track.enabled = true
    this.state = { ...this.state, joined: true, muted: false, microphoneAvailable: true }
  }
  toggleDeafen(): void { this.state.deafened = !this.state.deafened; this.emit() }
  reset(): void {
    this.epoch++
    this.cancelActivation?.(); this.cancelActivation = null
    if (this.track) { this.track.onended = null; this.track.stop() }
    this.track = null; this.busy = false
    this.state = { joined: false, muted: true, deafened: false, microphoneAvailable: false }; this.emit()
  }
  private emit(): void { this.changed({ ...this.state }, this.track, this.busy) }
}
export function microphoneError(error: unknown): string {
  if (error instanceof AppError) return error.message
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microfone não autorizado. Libere a permissão e tente novamente. Você pode continuar ouvindo e usando o chat.'
  if (name === 'NotFoundError') return 'Nenhum microfone encontrado. Conecte um dispositivo e tente novamente.'
  if (name === 'NotReadableError') return 'O microfone está ocupado ou indisponível. Confira o dispositivo e tente novamente.'
  if (name === 'TimeoutError') return 'A ativação do microfone demorou demais. Confira a permissão e a conexão e tente novamente.'
  return 'Não foi possível ativar o microfone. Você pode continuar ouvindo e usando o chat.'
}
