<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RemoteShareView } from '../services/cloudflare/types'

const props = defineProps<{ share: RemoteShareView; focused: boolean }>()
const emit = defineEmits<{ focus: [] }>()

const videoElement = ref<HTMLVideoElement | null>(null)
const audioElement = ref<HTMLAudioElement | null>(null)
const audioBlocked = ref(false)

function attach(): void {
  if (videoElement.value) videoElement.value.srcObject = props.share.videoTrack ? new MediaStream([props.share.videoTrack]) : null
  if (audioElement.value) {
    audioElement.value.srcObject = props.share.audioTrack ? new MediaStream([props.share.audioTrack]) : null
    if (props.share.audioTrack) void playAudio()
  }
}

function detach(): void {
  if (videoElement.value) videoElement.value.srcObject = null
  if (audioElement.value) audioElement.value.srcObject = null
  audioBlocked.value = false
}

async function playAudio(): Promise<void> {
  try {
    await audioElement.value?.play()
    audioBlocked.value = false
  } catch {
    audioBlocked.value = true
  }
}

watch([() => props.share.videoTrack, () => props.share.audioTrack], () => {
  detach()
  attach()
})
onMounted(attach)
onBeforeUnmount(detach)
</script>

<template>
  <article class="media-tile" :class="{ focused }">
    <video ref="videoElement" autoplay playsinline muted />
    <audio ref="audioElement" autoplay />
    <div v-if="!share.videoTrack" class="media-placeholder"><span />Aguardando vídeo…</div>
    <button class="focus-button" :aria-label="focused ? 'Sair do foco' : `Focar tela de ${share.participantName}`" @click="emit('focus')">
      {{ focused ? 'Reduzir' : 'Focar' }}
    </button>
    <footer>
      <span class="live-dot" />
      <strong>{{ share.participantName }}</strong>
      <span v-if="share.audioTrack" class="audio-badge">Com áudio</span>
      <button v-if="audioBlocked" class="audio-button" @click="playAudio">Ativar áudio</button>
    </footer>
  </article>
</template>
