<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { CaptureProfile, CaptureSourceDTO } from '../shared/capture'
import type { AppError } from '../shared/errors'
import MediaTile from './components/MediaTile.vue'
import SourcePicker from './components/SourcePicker.vue'
import { stopMediaStream } from './domain/capture-cleanup'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from './domain/room-code'
import type { RoomState, ShareState } from './domain/state'
import { LiveKitRoomService } from './services/livekit/room'
import type { ParticipantView, RemoteShareView } from './services/livekit/types'
import { requestJoinToken } from './services/token'

const roomService = new LiveKitRoomService()
const displayName = ref(localStorage.getItem('displayName') ?? '')
const roomCodeInput = ref('')
const currentRoomCode = ref('')
const roomState = ref<RoomState>('idle')
const shareState = ref<ShareState>('idle')
const participants = ref<ParticipantView[]>([])
const shares = shallowRef<RemoteShareView[]>([])
const localStream = ref<MediaStream | null>(null)
const localPreview = ref<HTMLVideoElement | null>(null)
const errorMessage = ref('')
const copied = ref(false)
const focusedShareKey = ref('')
let cleanupPromise: Promise<void> | null = null

const canSubmit = computed(() => displayName.value.trim().length >= 1 && roomState.value !== 'joining')
const statusLabel = computed(() => ({
  connected: 'Conectado',
  reconnecting: 'Reconectando…',
  joining: 'Entrando…',
  disconnected: 'Desconectado',
  error: 'Erro de conexão',
  idle: 'Inativo',
}[roomState.value]))

roomService.onSnapshot((snapshot) => {
  participants.value = snapshot.participants
  shares.value = snapshot.shares
  if (focusedShareKey.value && !snapshot.shares.some((share) => share.key === focusedShareKey.value)) {
    focusedShareKey.value = ''
  }
})

roomService.onConnection((state) => {
  roomState.value = state
  if (state === 'disconnected' && currentRoomCode.value) {
    errorMessage.value = 'A conexão com a sala foi encerrada.'
  }
})

async function joinRoom(roomCode: string): Promise<void> {
  const name = displayName.value.trim().normalize('NFC')
  if (!name || name.length > 32) {
    errorMessage.value = 'Use um nome entre 1 e 32 caracteres.'
    return
  }

  const normalizedCode = normalizeRoomCode(roomCode)
  if (!isValidRoomCode(normalizedCode)) {
    errorMessage.value = 'O código da sala deve ter entre 8 e 12 caracteres válidos.'
    return
  }

  roomState.value = 'joining'
  errorMessage.value = ''
  try {
    const credentials = await requestJoinToken(normalizedCode, name)
    await roomService.connect(credentials.serverUrl, credentials.participantToken)
    localStorage.setItem('displayName', name)
    currentRoomCode.value = normalizedCode
  } catch (error) {
    roomState.value = 'error'
    errorMessage.value = getErrorMessage(error)
  }
}

function createRoom(): void {
  void joinRoom(generateRoomCode())
}

function enterRoom(): void {
  void joinRoom(roomCodeInput.value)
}

async function leaveRoom(): Promise<void> {
  await stopSharing()
  await roomService.disconnect()
  currentRoomCode.value = ''
  roomState.value = 'idle'
  participants.value = []
  shares.value = []
}

async function copyCode(): Promise<void> {
  await navigator.clipboard.writeText(currentRoomCode.value)
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1500)
}

function openPicker(): void {
  errorMessage.value = ''
  shareState.value = 'selecting'
}

async function cancelPicker(): Promise<void> {
  await window.captureAPI.cancelSelection()
  shareState.value = 'idle'
}

async function startSharing(
  source: CaptureSourceDTO,
  includeSystemAudio: boolean,
  profile: CaptureProfile,
): Promise<void> {
  shareState.value = 'starting'
  errorMessage.value = ''

  try {
    await window.captureAPI.selectSource({ sourceId: source.id, includeSystemAudio })
    const frameRate = profile === 'smooth' ? 30 : 15
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: 1920, height: 1080, frameRate },
      audio: includeSystemAudio,
    })

    localStream.value = stream
    const videoTrack = stream.getVideoTracks()[0]
    if (!videoTrack) throw new Error('Missing video track')
    videoTrack.contentHint = profile === 'smooth' ? 'motion' : 'detail'
    videoTrack.onended = () => void stopSharing()

    if (localPreview.value) localPreview.value.srcObject = stream
    await roomService.publishScreen(stream, profile)
    shareState.value = 'sharing'
  } catch (error) {
    await window.captureAPI.cancelSelection()
    await stopSharing()
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      shareState.value = 'idle'
      return
    }
    shareState.value = 'error'
    errorMessage.value = getErrorMessage(error)
  }
}

function stopSharing(): Promise<void> {
  if (cleanupPromise) return cleanupPromise
  if (!localStream.value && shareState.value === 'idle') return Promise.resolve()

  cleanupPromise = (async () => {
    shareState.value = 'stopping'
    const stream = localStream.value
    localStream.value = null

    stopMediaStream(stream)
    if (localPreview.value) localPreview.value.srcObject = null
    await roomService.unpublishScreen()
    shareState.value = 'idle'
  })().finally(() => {
    cleanupPromise = null
  })

  return cleanupPromise
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as AppError).message)
  return 'Algo deu errado. Tente novamente.'
}

onBeforeUnmount(() => {
  void stopSharing()
  void roomService.disconnect()
})
</script>

<template>
  <main v-if="!currentRoomCode" class="welcome-shell">
    <section class="welcome-card">
      <div class="brand-mark">C</div>
      <p class="eyebrow">Concord</p>
      <h1>Entre e compartilhe.</h1>
      <p class="welcome-copy">Uma sala privada para transmitir sua tela enquanto vocês conversam onde preferirem.</p>

      <label class="field">
        <span>Seu nome</span>
        <input v-model="displayName" maxlength="32" placeholder="Como seus amigos verão você" autofocus />
      </label>

      <button class="button primary full" :disabled="!canSubmit" @click="createRoom">Criar uma sala</button>

      <div class="divider"><span>ou entre em uma</span></div>
      <div class="join-row">
        <input
          v-model="roomCodeInput"
          maxlength="14"
          placeholder="CÓDIGO DA SALA"
          aria-label="Código da sala"
          @keyup.enter="enterRoom"
        />
        <button class="button secondary" :disabled="!canSubmit" @click="enterRoom">Entrar</button>
      </div>

      <p v-if="roomState === 'joining'" class="status-note">Conectando à sala…</p>
      <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>
    </section>
  </main>

  <div v-else class="app-shell">
    <header class="topbar">
      <div class="brand-inline"><span class="brand-mark small">C</span><strong>Concord</strong></div>
      <button class="room-code" title="Copiar código" @click="copyCode">
        <span>Sala</span><strong>{{ currentRoomCode }}</strong><small>{{ copied ? 'Copiado!' : 'Copiar' }}</small>
      </button>
      <div class="connection-state" :data-state="roomState"><span />{{ statusLabel }}</div>
    </header>

    <div class="workspace">
      <aside class="sidebar">
        <div class="sidebar-heading">
          <h2>Participantes</h2><span>{{ participants.length }}</span>
        </div>
        <ul class="participant-list">
          <li v-for="participant in participants" :key="participant.identity">
            <span class="avatar">{{ participant.name.slice(0, 1).toUpperCase() }}</span>
            <span><strong>{{ participant.name }}</strong><small>{{ participant.isLocal ? 'Você' : 'Na sala' }}</small></span>
          </li>
        </ul>
        <button class="leave-button" @click="leaveRoom">Sair da sala</button>
      </aside>

      <section class="stage">
        <div v-if="errorMessage" class="error-banner stage-error">{{ errorMessage }}<button @click="errorMessage = ''">×</button></div>

        <div v-if="shares.length === 0 && !localStream" class="empty-stage">
          <div class="empty-illustration"><span /><span /><span /></div>
          <h2>Ninguém está compartilhando</h2>
          <p>Escolha uma janela ou monitor para começar.</p>
        </div>

        <div v-else class="media-grid" :class="{ 'has-focus': focusedShareKey }">
          <article v-if="localStream" class="media-tile local" :class="{ hidden: focusedShareKey }">
            <video ref="localPreview" autoplay playsinline muted :srcObject="localStream" />
            <footer><span class="live-dot" />Sua tela <span class="audio-badge">prévia local</span></footer>
          </article>
          <MediaTile
            v-for="share in shares"
            :key="share.key"
            :share="share"
            :focused="focusedShareKey === share.key"
            :class="{ hidden: focusedShareKey && focusedShareKey !== share.key }"
            @focus="focusedShareKey = focusedShareKey === share.key ? '' : share.key"
          />
        </div>

        <div class="stage-actions">
          <button v-if="shareState === 'sharing' || shareState === 'stopping'" class="button danger" :disabled="shareState === 'stopping'" @click="stopSharing">
            {{ shareState === 'stopping' ? 'Parando…' : 'Parar transmissão' }}
          </button>
          <button v-else class="button primary" :disabled="shareState !== 'idle'" @click="openPicker">
            {{ shareState === 'starting' ? 'Iniciando…' : 'Compartilhar tela' }}
          </button>
        </div>
      </section>
    </div>
  </div>

  <SourcePicker v-if="shareState === 'selecting'" @cancel="cancelPicker" @share="startSharing" />
</template>
