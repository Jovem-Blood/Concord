<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RemoteVoiceTrack } from '../services/cloudflare/types'
import { playbackLevel, type AudioLevel } from '../services/audio-level'
const props = defineProps<{ voices: RemoteVoiceTrack[]; deafened: boolean; volume: number; levels: Record<string, AudioLevel>; outputDeviceId: string }>()
const emit = defineEmits<{ audioError: [message: string] }>()
const blocked = ref(false)
const elements = new Map<string, { audio: HTMLAudioElement; track: MediaStreamTrack }>()
async function play(): Promise<void> {
  const results = await Promise.allSettled([...elements.values()].map(({ audio }) => audio.play()))
  blocked.value = results.some((r) => r.status === 'rejected')
}
function attach(): void {
  for (const [key, entry] of elements) {
    if (props.voices.some((voice) => voice.key === key && voice.track === entry.track)) continue
    entry.audio.pause(); entry.audio.srcObject = null; elements.delete(key)
  }
  for (const voice of props.voices) {
    if (!elements.has(voice.key)) {
      const audio = new Audio()
      audio.autoplay = true
      audio.srcObject = new MediaStream([voice.track])
      void applyDevice(audio)
      elements.set(voice.key, { audio, track: voice.track })
    }
  }
  applyLevels()
  void play()
}
async function applyDevice(audio: HTMLAudioElement): Promise<void> {
  if (typeof audio.setSinkId !== 'function') return
  try { await audio.setSinkId(props.outputDeviceId) }
  catch { emit('audioError', 'Não foi possível usar a saída de áudio selecionada para a conversa.') }
}
function applyLevels(): void {
  for (const voice of props.voices) {
    const entry = elements.get(voice.key)
    if (!entry) continue
    const level = playbackLevel(props.volume, props.deafened, props.levels[voice.participantIdentity])
    entry.audio.volume = level.volume
    entry.audio.muted = level.muted
  }
}
watch(() => props.voices, attach)
watch(() => props.outputDeviceId, () => { elements.forEach(({ audio }) => { void applyDevice(audio) }) })
watch([() => props.volume, () => props.levels], applyLevels, { deep: true })
watch(() => props.deafened, (deafened) => {
  applyLevels()
  if (!deafened) void play()
})
onMounted(attach)
onBeforeUnmount(() => { elements.forEach(({ audio }) => { audio.pause(); audio.srcObject = null }); elements.clear() })
</script>
<template>
  <div v-if="blocked && !deafened" class="notice-banner audio-unlock" role="status">
    <span>O navegador pausou o áudio da conversa.</span><button class="button secondary" @click="play">Ouvir sala</button>
  </div>
</template>
