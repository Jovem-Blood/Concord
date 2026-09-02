<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RemoteShareView } from '../services/cloudflare/types'

const props = defineProps<{ share: RemoteShareView; focused: boolean; deafened: boolean }>()
const emit = defineEmits<{ focus: [] }>()

const videoElement = ref<HTMLVideoElement | null>(null)
const audioElement = ref<HTMLAudioElement | null>(null)
const audioBlocked = ref(false)

function attach(): void {
  if (videoElement.value) videoElement.value.srcObject = props.share.videoTrack ? new MediaStream([props.share.videoTrack]) : null
  if (audioElement.value) {
    audioElement.value.srcObject = props.share.audioTrack ? new MediaStream([props.share.audioTrack]) : null
    audioElement.value.muted = props.deafened
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
watch(() => props.deafened, (deafened) => {
  if (audioElement.value) audioElement.value.muted = deafened
  if (!deafened && props.share.audioTrack) void playAudio()
})
onMounted(attach)
onBeforeUnmount(detach)
</script>

<template>
  <article class="media-tile" :class="{ focused }">
    <video ref="videoElement" autoplay playsinline muted :aria-label="`Tela de ${share.participantName}`" />
    <audio ref="audioElement" autoplay />
    <div v-if="!share.videoTrack" class="media-placeholder" role="status">Aguardando vídeo…</div>
    <button class="focus-button" :aria-pressed="focused" :aria-label="focused ? 'Sair do foco' : `Focar tela de ${share.participantName}`" @click="emit('focus')">
      {{ focused ? 'Reduzir' : 'Focar' }}
    </button>
    <footer>
      <span class="live-label"><span v-if="share.videoTrack" class="live-dot" aria-hidden="true" />{{ share.videoTrack ? 'Ao vivo' : 'Conectando' }}</span>
      <strong :title="share.participantName">{{ share.participantName }}</strong>
      <span class="audio-badge">{{ share.audioTrack ? (audioBlocked ? 'Áudio pausado' : 'Com áudio') : 'Sem áudio' }}</span>
      <button v-if="audioBlocked" class="audio-button" @click="playAudio">Ativar áudio</button>
    </footer>
  </article>
</template>
