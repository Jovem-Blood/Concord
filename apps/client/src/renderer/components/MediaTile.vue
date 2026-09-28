<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RemoteShareView } from '../services/cloudflare/types'

const props = defineProps<{ share: RemoteShareView; focused: boolean; deafened: boolean; placeholder?: string }>()
const emit = defineEmits<{ focus: []; frame: [dataUrl: string] }>()

const videoElement = ref<HTMLVideoElement | null>(null)
const audioElement = ref<HTMLAudioElement | null>(null)
const audioBlocked = ref(false)
let frameCaptured = false

function attach(): void {
  if (videoElement.value) videoElement.value.srcObject = props.share.videoTrack ? new MediaStream([props.share.videoTrack]) : null
  if (audioElement.value) {
    audioElement.value.srcObject = props.share.audioTrack ? new MediaStream([props.share.audioTrack]) : null
    audioElement.value.muted = props.deafened
    if (props.share.audioTrack) void playAudio()
  }
}

function captureFrame(): void {
  if (frameCaptured || props.placeholder || !videoElement.value || videoElement.value.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
  const video = videoElement.value
  if (!video.videoWidth || !video.videoHeight) return
  const canvas = document.createElement('canvas')
  const width = Math.min(640, video.videoWidth)
  canvas.width = width
  canvas.height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth))
  const context = canvas.getContext('2d')
  if (!context) return
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  frameCaptured = true
  emit('frame', canvas.toDataURL('image/jpeg', 0.72))
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
  frameCaptured = Boolean(props.placeholder)
  attach()
  requestAnimationFrame(captureFrame)
})
watch(() => props.placeholder, (placeholder) => { frameCaptured = Boolean(placeholder) })
watch(() => props.deafened, (deafened) => {
  if (audioElement.value) audioElement.value.muted = deafened
  if (!deafened && props.share.audioTrack) void playAudio()
})
onMounted(() => { attach(); requestAnimationFrame(captureFrame) })
onBeforeUnmount(detach)
</script>

<template>
  <article
    class="media-tile"
    :class="{ focused, 'has-placeholder': Boolean(placeholder && !share.videoTrack) }"
    role="button"
    tabindex="0"
    :aria-label="`Focar tela de ${share.participantName}`"
    @click="emit('focus')"
    @keydown.enter.prevent="emit('focus')"
    @keydown.space.prevent="emit('focus')"
  >
    <img v-if="placeholder && !share.videoTrack" class="media-placeholder-image" :src="placeholder" :alt="`Prévia congelada da tela de ${share.participantName}`" />
    <video ref="videoElement" autoplay playsinline muted :aria-label="`Tela de ${share.participantName}`" />
    <audio ref="audioElement" autoplay />
    <div v-if="!share.videoTrack" class="media-placeholder" role="status">Aguardando vídeo…</div>
    <footer>
      <span class="live-label"><span v-if="share.videoTrack" class="live-dot" aria-hidden="true" />{{ share.videoTrack ? 'Ao vivo' : 'Prévia' }}</span>
      <strong>{{ share.participantName }}</strong>
      <span class="audio-badge">{{ share.audioTrack ? (audioBlocked ? 'Áudio pausado' : 'Com áudio') : 'Sem áudio' }}</span>
      <button v-if="audioBlocked" class="audio-button" @click.stop="playAudio">Ativar áudio</button>
    </footer>
  </article>
</template>
