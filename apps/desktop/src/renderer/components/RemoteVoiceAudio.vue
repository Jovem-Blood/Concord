<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RemoteVoiceTrack } from '../services/cloudflare/types'
const props = defineProps<{ voices: RemoteVoiceTrack[]; deafened: boolean }>()
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
      audio.autoplay = true; audio.muted = props.deafened
      audio.srcObject = new MediaStream([voice.track])
      elements.set(voice.key, { audio, track: voice.track })
    }
  }
  void play()
}
watch(() => props.voices, attach)
watch(() => props.deafened, (deafened) => {
  elements.forEach(({ audio }) => { audio.muted = deafened })
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
