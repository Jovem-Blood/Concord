<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { RemoteShareView } from '../services/livekit/types'

const props = defineProps<{ share: RemoteShareView; focused: boolean }>()
const emit = defineEmits<{ focus: [] }>()

const videoElement = ref<HTMLVideoElement | null>(null)
const audioElement = ref<HTMLAudioElement | null>(null)

function attach(): void {
  if (videoElement.value && props.share.videoTrack) props.share.videoTrack.attach(videoElement.value)
  if (audioElement.value && props.share.audioTrack) props.share.audioTrack.attach(audioElement.value)
}

function detach(): void {
  if (videoElement.value) props.share.videoTrack?.detach(videoElement.value)
  if (audioElement.value) props.share.audioTrack?.detach(audioElement.value)
}

watch(() => [props.share.videoTrack, props.share.audioTrack], () => {
  detach()
  attach()
})
onMounted(attach)
onBeforeUnmount(detach)
</script>

<template>
  <article class="media-tile" :class="{ focused }" @click="emit('focus')">
    <video ref="videoElement" autoplay playsinline />
    <audio ref="audioElement" autoplay />
    <div v-if="!share.videoTrack" class="media-placeholder">Aguardando vídeo…</div>
    <footer>
      <span class="live-dot" />
      {{ share.participantName }}
      <span v-if="share.audioTrack" class="audio-badge">com áudio</span>
    </footer>
  </article>
</template>
