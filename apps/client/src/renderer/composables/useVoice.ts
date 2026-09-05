import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { CloudflareRoomService } from '../services/cloudflare/room'
import type { RemoteVoiceTrack, VoiceState } from '../services/cloudflare/types'
import { MicrophoneService } from '../services/microphone'
import { soundPlayer } from '../services/sounds'
import { SpeakingMonitor } from '../services/speaking'

export function useVoice(room: CloudflareRoomService) {
  const voice = ref<VoiceState>({ joined: false, muted: true, deafened: false, microphoneAvailable: false })
  const busy = ref(false)
  const notice = ref('')
  const localTrack = shallowRef<MediaStreamTrack | null>(null)
  const remoteTracks = shallowRef<RemoteVoiceTrack[]>([])
  const speaking = ref<Record<string, boolean>>({})
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
    })
  }
  function reset(): void { microphone.reset(); remoteTracks.value = []; monitor.stop(); speaking.value = {}; notice.value = '' }
  onBeforeUnmount(reset)
  return { voice, busy, notice, remoteTracks, speaking, toggleMicrophone, toggleDeafen: () => microphone.toggleDeafen(),
    resumeAudio: () => monitor.resume(), reset }
}
