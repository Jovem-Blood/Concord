import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { RoomSession } from '../services/room-session'
import type { RemoteVoiceTrack, VoiceState } from '../services/cloudflare/types'
import { MicrophoneService } from '../services/microphone'
import { soundPlayer } from '../services/sounds'
import { SpeakingMonitor } from '../services/speaking'

export function useVoice(room: RoomSession) {
  const voice = ref<VoiceState>({ joined: false, muted: true, deafened: false, microphoneAvailable: false })
  const busy = ref(false)
  const notice = ref('')
  const localTrack = shallowRef<MediaStreamTrack | null>(null)
  const remoteTracks = shallowRef<RemoteVoiceTrack[]>([])
  const speaking = ref<Record<string, boolean>>({})
  const microphoneVolume = ref(100)
  const outputVolume = ref(100)
  const inputDeviceId = ref('')
  const outputDeviceId = ref('')
  const inputDevices = ref<{ value: string; label: string }[]>([])
  const outputDevices = ref<{ value: string; label: string }[]>([])
  const outputSelectionSupported = typeof HTMLMediaElement.prototype.setSinkId === 'function'
  const monitor = new SpeakingMonitor((id, active) => { speaking.value = { ...speaking.value, [id]: active } })
  const microphone = new MicrophoneService(room, (state, track, pending) => {
    voice.value = state; localTrack.value = track; busy.value = pending
    if (state.muted) speaking.value = { ...speaking.value, local: false }
  }, (message) => { notice.value = message })
  watch([localTrack, remoteTracks], () => {
    monitor.setTracks([
      ...(localTrack.value ? [{ id: 'local', track: localTrack.value }] : []),
      ...remoteTracks.value.map((item) => ({ id: item.participantIdentity, track: item.track })),
    ])
    const identities = new Set(['local', ...remoteTracks.value.map((item) => item.participantIdentity)])
    speaking.value = Object.fromEntries(Object.entries(speaking.value).filter(([id]) => identities.has(id)))
  })
  function toggleMicrophone(): void {
    notice.value = ''; monitor.resume()
    const wasActive = voice.value.joined && !voice.value.muted
    void microphone.toggle().then(() => {
      const isActive = voice.value.joined && !voice.value.muted
      if (isActive !== wasActive) soundPlayer.play(isActive ? 'microphone-on' : 'microphone-off')
      void refreshDevices()
    })
  }
  function reset(): void { microphone.reset(); remoteTracks.value = []; monitor.stop(); speaking.value = {}; notice.value = '' }
  function setMicrophoneVolume(value: number): void { microphoneVolume.value = value; microphone.setVolume(value) }
  async function refreshDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const options = (kind: MediaDeviceKind, label: string) => devices.filter((device) => device.kind === kind && device.deviceId && device.deviceId !== 'default')
        .map((device, index) => ({ value: device.deviceId, label: device.label || `${label} ${index + 1}` }))
      inputDevices.value = options('audioinput', 'Microfone')
      outputDevices.value = options('audiooutput', 'Saída')
    } catch { notice.value = 'Não foi possível listar os dispositivos de áudio. Confira as permissões do aplicativo.' }
  }
  async function setInputDevice(deviceId: string): Promise<void> {
    if (busy.value) return
    inputDeviceId.value = deviceId
    monitor.resume()
    await microphone.setDevice(deviceId)
    await refreshDevices()
  }
  async function setOutputDevice(deviceId: string): Promise<void> {
    if (!outputSelectionSupported) return
    try {
      await new Audio().setSinkId(deviceId)
      outputDeviceId.value = deviceId
    } catch { notice.value = 'Não foi possível usar essa saída de áudio. Confira a conexão e a permissão do dispositivo.' }
  }
  onMounted(() => navigator.mediaDevices?.addEventListener('devicechange', refreshDevices))
  onBeforeUnmount(() => { reset(); navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices) })
  return { voice, busy, notice, remoteTracks, speaking, microphoneVolume, outputVolume, setMicrophoneVolume,
    inputDeviceId, outputDeviceId, inputDevices, outputDevices, outputSelectionSupported, refreshDevices, setInputDevice, setOutputDevice,
    toggleMicrophone, toggleDeafen: () => microphone.toggleDeafen(),
    resumeAudio: () => monitor.resume(), reset }
}
