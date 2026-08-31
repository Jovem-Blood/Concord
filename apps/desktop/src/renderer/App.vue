<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CaptureProfile, CaptureSourceDTO } from '../shared/capture'
import type { AppError } from '../shared/errors'
import MediaTile from './components/MediaTile.vue'
import SourcePicker from './components/SourcePicker.vue'
import { stopMediaStream } from './domain/capture-cleanup'
import { createRoomLink, roomCodeFromRoute } from './domain/room-link'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from './domain/room-code'
import type { RoomState, ShareState } from './domain/state'
import { captureProvider } from './services/capture/provider'
import { CloudflareRoomService } from './services/cloudflare/room'
import type { ParticipantView, RemoteShareView } from './services/cloudflare/types'
import { requestJoinToken } from './services/token'

const roomService = new CloudflareRoomService()
const route = useRoute()
const router = useRouter()
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
const shareNotice = ref('')
const copied = ref(false)
const focusedShareKey = ref('')
let cleanupPromise: Promise<void> | null = null

const captureEnvironment = captureProvider.capabilities.environment
const configuredWebAppUrl = String(import.meta.env.VITE_WEB_APP_URL ?? '').trim()
const publicWebAppUrl = configuredWebAppUrl || (captureEnvironment === 'web' ? window.location.origin : 'http://localhost:5173')
const invitedRoomCode = computed(() => roomCodeFromRoute(route.params.roomCode))
const canSubmit = computed(() => displayName.value.trim().length >= 1 && roomState.value !== 'joining')
const statusLabel = computed(() => ({
  connected: 'Conectado',
  reconnecting: 'Reconectando…',
  joining: 'Entrando…',
  disconnected: 'Desconectado',
  error: 'Erro de conexão',
  idle: 'Inativo',
}[roomState.value]))

watch(
  () => route.params.roomCode,
  (roomCode) => {
    const normalizedCode = roomCodeFromRoute(roomCode)
    if (normalizedCode && !currentRoomCode.value) roomCodeInput.value = normalizedCode
  },
  { immediate: true },
)

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
    void stopSharing()
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
    await roomService.connect(credentials)
    localStorage.setItem('displayName', name)
    currentRoomCode.value = normalizedCode
    roomCodeInput.value = normalizedCode
    await router.replace(`/${normalizedCode}`)
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
  errorMessage.value = ''
  shareNotice.value = ''
  await router.replace('/')
}

async function copyLink(): Promise<void> {
  try {
    await writeClipboard(createRoomLink(publicWebAppUrl, currentRoomCode.value))
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1500)
  } catch {
    errorMessage.value = 'Não foi possível copiar o link desta sala.'
  }
}

function openPicker(): void {
  errorMessage.value = ''
  shareState.value = 'selecting'
}

async function cancelPicker(): Promise<void> {
  await captureProvider.cancel()
  shareState.value = 'idle'
}

async function startSharing(
  source: CaptureSourceDTO | undefined,
  includeSystemAudio: boolean,
  profile: CaptureProfile,
): Promise<void> {
  shareState.value = 'starting'
  errorMessage.value = ''
  shareNotice.value = ''

  try {
    const stream = await captureProvider.capture({ source, includeSystemAudio, profile })

    localStream.value = stream
    const videoTrack = stream.getVideoTracks()[0]
    if (!videoTrack) throw new Error('Missing video track')
    videoTrack.contentHint = profile === 'smooth' ? 'motion' : 'detail'
    videoTrack.onended = () => void stopSharing()

    if (includeSystemAudio && stream.getAudioTracks().length === 0 && captureEnvironment === 'web') {
      shareNotice.value = 'A tela está sendo transmitida sem áudio. O navegador ou a fonte escolhida não ofereceu áudio.'
    }

    if (localPreview.value) localPreview.value.srcObject = stream
    await roomService.publishScreen(stream, profile)
    shareState.value = 'sharing'
  } catch (error) {
    await captureProvider.cancel()
    await stopSharing()
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      shareState.value = 'idle'
      return
    }
    shareState.value = 'error'
    errorMessage.value = getErrorMessage(error)
  }
}

async function writeClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copiedSuccessfully = document.execCommand('copy')
  textarea.remove()
  if (!copiedSuccessfully) throw new Error('Clipboard unavailable')
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
    <section class="welcome-frame">
      <div class="welcome-intro">
        <div class="brand-lockup">
          <div class="brand-mark">C</div>
          <div><strong>Concord</strong><span>screen sharing privado</span></div>
        </div>
        <div class="welcome-message">
          <p class="eyebrow">Direto ao ponto</p>
          <h1>Mostre sua tela.<br />Continue a conversa.</h1>
          <p>Uma sala leve para compartilhar janelas e monitores com seu grupo, sem contas ou configuração demorada.</p>
        </div>
        <div class="privacy-note"><span aria-hidden="true">✓</span> Acesso somente por código ou link</div>
      </div>

      <section class="welcome-card" aria-labelledby="access-title">
        <header class="access-header">
          <p class="eyebrow">Acessar o Concord</p>
          <h2 id="access-title">{{ invitedRoomCode ? 'Seu convite está pronto' : 'Comece uma sala privada' }}</h2>
          <p>{{ invitedRoomCode ? 'Informe seu nome para entrar.' : 'Dê um nome à sala começando pelo seu.' }}</p>
        </header>

        <div v-if="invitedRoomCode" class="invite-banner">
          <span>Sala do convite</span>
          <strong>{{ invitedRoomCode }}</strong>
        </div>

        <label class="field">
          <span>Como devemos chamar você?</span>
          <input v-model="displayName" maxlength="32" placeholder="Seu nome" autocomplete="name" autofocus />
        </label>

        <button v-if="invitedRoomCode" class="button primary full" :disabled="!canSubmit" @click="joinRoom(invitedRoomCode)">
          Entrar na sala
        </button>
        <button v-else class="button primary full" :disabled="!canSubmit" @click="createRoom">Criar sala agora</button>

        <div class="divider"><span>{{ invitedRoomCode ? 'Entrar com outro código' : 'Já tem um código?' }}</span></div>
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

        <button v-if="invitedRoomCode" class="create-alternate" :disabled="!canSubmit" @click="createRoom">Prefiro criar uma nova sala</button>

        <p v-if="roomState === 'joining'" class="status-note" aria-live="polite">Conectando à sala…</p>
        <p v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</p>
      </section>
    </section>
  </main>

  <div v-else class="app-shell">
    <header class="topbar">
      <div class="brand-inline"><span class="brand-mark small">C</span><strong>Concord</strong></div>
      <div class="room-context">
        <span>Sala privada</span>
        <button class="room-code" :aria-label="copied ? 'Link copiado' : 'Copiar link da sala'" @click="copyLink">
          <strong>{{ currentRoomCode }}</strong><small>{{ copied ? 'Copiado' : 'Copiar link' }}</small>
        </button>
      </div>
      <div class="connection-state" :data-state="roomState"><span />{{ statusLabel }}</div>
    </header>

    <div class="workspace">
      <aside class="sidebar">
        <div class="sidebar-room">
          <span class="sidebar-kicker">Nesta sala</span>
          <strong>{{ currentRoomCode }}</strong>
          <small>Compartilhamento protegido pelo link</small>
        </div>
        <div class="sidebar-heading">
          <h2>Participantes</h2><span>{{ participants.length }}</span>
        </div>
        <ul class="participant-list">
          <li v-for="participant in participants" :key="participant.identity">
            <span class="avatar">{{ participant.name.slice(0, 1).toUpperCase() }}</span>
            <span><strong>{{ participant.name }}</strong><small>{{ participant.isLocal ? 'Você' : 'Conectado' }}</small></span>
          </li>
        </ul>
        <button class="leave-button" @click="leaveRoom">Sair da sala</button>
      </aside>

      <section class="stage">
        <header class="stage-header">
          <div>
            <p class="eyebrow">Transmissões</p>
            <h1>Palco da sala</h1>
          </div>
          <span class="stage-count">{{ shares.length + (localStream ? 1 : 0) }} {{ shares.length + (localStream ? 1 : 0) === 1 ? 'tela' : 'telas' }}</span>
        </header>

        <div class="stage-canvas">
          <div v-if="errorMessage" class="error-banner stage-error" role="alert">{{ errorMessage }}<button aria-label="Fechar erro" @click="errorMessage = ''">×</button></div>
          <div v-if="shareNotice" class="notice-banner stage-notice">{{ shareNotice }}<button aria-label="Fechar aviso" @click="shareNotice = ''">×</button></div>

          <div v-if="shares.length === 0 && !localStream" class="empty-stage">
            <div class="empty-illustration" aria-hidden="true"><span /><span /></div>
            <h2>O palco está livre</h2>
            <p>Compartilhe uma janela ou monitor quando estiver pronto.</p>
            <button class="button primary" :disabled="shareState !== 'idle'" @click="openPicker">Compartilhar minha tela</button>
          </div>

          <div v-else class="media-grid" :class="{ 'has-focus': focusedShareKey }">
            <article v-if="localStream" class="media-tile local" :class="{ hidden: focusedShareKey }">
              <video ref="localPreview" autoplay playsinline muted :srcObject="localStream" />
              <footer><span class="live-dot" />Sua tela <span class="audio-badge">Prévia local</span></footer>
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
        </div>

        <footer class="stage-actions">
          <span>{{ shareState === 'sharing' ? 'Sua tela está visível para a sala' : 'Áudio do sistema é opcional' }}</span>
          <button v-if="shareState === 'sharing' || shareState === 'stopping'" class="button danger" :disabled="shareState === 'stopping'" @click="stopSharing">
            {{ shareState === 'stopping' ? 'Parando…' : 'Parar transmissão' }}
          </button>
          <button v-else class="button primary" :disabled="shareState !== 'idle'" @click="openPicker">
            {{ shareState === 'starting' ? 'Iniciando…' : 'Compartilhar tela' }}
          </button>
        </footer>
      </section>
    </div>
  </div>

  <SourcePicker v-if="shareState === 'selecting'" @cancel="cancelPicker" @share="startSharing" />
</template>
