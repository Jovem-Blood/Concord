<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CaptureProfile, CaptureSourceDTO } from '../shared/capture'
import type { AppError } from '../shared/errors'
import ConcordBrand from './components/ConcordBrand.vue'
import CallControls from './components/CallControls.vue'
import ChatPanel from './components/ChatPanel.vue'
import MediaTile from './components/MediaTile.vue'
import ParticipantList from './components/ParticipantList.vue'
import RemoteVoiceAudio from './components/RemoteVoiceAudio.vue'
import SiteFooter from './components/SiteFooter.vue'
import SourcePicker from './components/SourcePicker.vue'
import { useVoice } from './composables/useVoice'
import { stopMediaStream } from './domain/capture-cleanup'
import { avatarUrl } from './domain/avatar'
import { createRoomLink, roomCodeFromRoute } from './domain/room-link'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from './domain/room-code'
import type { RoomState, ShareState } from './domain/state'
import { captureProvider } from './services/capture/provider'
import { writeClipboard } from './services/clipboard'
import { CloudflareRoomService } from './services/cloudflare/room'
import type { ChatSnapshot } from './services/chat'
import type { ParticipantView, RemoteShareView } from './services/cloudflare/types'
import { requestJoinToken } from './services/server'

const roomService = new CloudflareRoomService()
const voiceControls = useVoice(roomService)
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
const chatOpen = ref(false)
const chat = ref<ChatSnapshot>({ messages: [], unread: 0, open: false, ready: false })
const chatError = ref('')
const chatPanel = ref<{ clearDraft(): void } | null>(null)
let cleanupPromise: Promise<void> | null = null

const captureEnvironment = captureProvider.capabilities.environment
const configuredWebAppUrl = String(import.meta.env.VITE_WEB_APP_URL ?? '').trim()
const publicWebAppUrl = configuredWebAppUrl || (captureEnvironment === 'web' ? window.location.origin : 'http://localhost:5173')
const invitedRoomCode = computed(() => roomCodeFromRoute(route.params.roomCode))
const canSubmit = computed(() => displayName.value.trim().length >= 1 && roomState.value !== 'joining')
const avatarPreviewUrl = computed(() => avatarUrl(displayName.value))
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
  voiceControls.remoteTracks.value = snapshot.remoteVoiceTracks
  if (focusedShareKey.value && !snapshot.shares.some((share) => share.key === focusedShareKey.value)) {
    focusedShareKey.value = ''
  }
})
roomService.onChat((snapshot) => { chat.value = snapshot })

roomService.onConnection((state) => {
  roomState.value = state
  if (state === 'disconnected' && currentRoomCode.value) {
    errorMessage.value = 'A conexão com a sala foi encerrada.'
    void stopSharing()
    voiceControls.reset()
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
  voiceControls.reset()
  chatOpen.value = false
  currentRoomCode.value = ''
  roomState.value = 'idle'
  participants.value = []
  shares.value = []
  errorMessage.value = ''
  shareNotice.value = ''
  await router.replace('/')
}
function toggleChat(): void {
  chatOpen.value = !chatOpen.value
  roomService.setChatOpen(chatOpen.value)
  if (chatOpen.value) chatError.value = ''
}
function sendChat(content: string): void {
  chatError.value = ''
  if (roomService.sendChat(content)) chatPanel.value?.clearDraft()
  else chatError.value = 'A mensagem não foi enviada. Aguarde a conexão do chat e tente novamente.'
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
    if (includeSystemAudio && voiceControls.voice.value.joined) {
      shareNotice.value = 'O áudio do sistema pode incluir a própria conversa da sala.'
    }

    if (localPreview.value) localPreview.value.srcObject = stream
    await roomService.publishScreen(stream, profile)
    shareState.value = 'sharing'
  } catch (error) {
    await captureProvider.cancel()
    await stopSharing()
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      shareState.value = 'idle'
      if (captureEnvironment === 'electron') {
        errorMessage.value = 'O aplicativo não conseguiu iniciar a captura da fonte selecionada.'
      }
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
  voiceControls.reset()
})
</script>

<template>
  <main v-if="!currentRoomCode" class="welcome-shell">
    <section class="welcome-frame">
      <div class="welcome-intro">
        <div class="brand-lockup">
          <ConcordBrand />
          <span>voz, chat e tela privados</span>
        </div>
        <div class="welcome-message">
          <p class="eyebrow">Direto ao ponto</p>
          <h1>Mostre sua tela.<br /><span>Continue a conversa.</span></h1>
          <p>Converse por voz, troque mensagens efêmeras e compartilhe sua tela, sem contas ou configuração demorada.</p>
        </div>
        <p class="privacy-note">Acesso somente por código ou link</p>
      </div>

      <section class="welcome-card" aria-labelledby="access-title">
        <header class="access-header">
          <p class="eyebrow">Acessar o Concord</p>
          <h2 id="access-title">{{ invitedRoomCode ? 'Seu convite está pronto' : 'Comece uma sala privada' }}</h2>
          <p>{{ invitedRoomCode ? 'Informe seu nome para entrar.' : 'Informe seu nome para começar.' }}</p>
        </header>

        <div v-if="invitedRoomCode" class="invite-banner">
          <span>Sala do convite</span>
          <strong>{{ invitedRoomCode }}</strong>
        </div>

        <div class="identity-field">
          <img class="avatar-preview" :src="avatarPreviewUrl" :alt="displayName.trim() ? `Avatar de ${displayName.trim()}` : 'Prévia do seu avatar'" />
          <label class="field">
            <span>Como devemos chamar você?</span>
            <input v-model="displayName" maxlength="32" placeholder="Seu nome" autocomplete="name" autofocus />
          </label>
        </div>

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

        <div class="access-feedback">
          <p v-if="roomState === 'joining'" class="status-note" aria-live="polite">Conectando à sala…</p>
          <p v-if="errorMessage" class="error-banner" role="alert">{{ errorMessage }}</p>
        </div>
      </section>
    </section>
    <SiteFooter v-if="captureEnvironment === 'web'" />
  </main>

  <div v-else class="app-shell" :inert="shareState === 'selecting'">
    <header class="topbar">
      <ConcordBrand compact />
      <div class="room-context">
        <span>Sala privada</span>
        <button class="room-code" :data-copied="copied" :aria-label="copied ? 'Link copiado' : `Copiar link da sala ${currentRoomCode}`" @click="copyLink">
          <strong>{{ currentRoomCode }}</strong><small aria-live="polite">{{ copied ? 'Copiado' : 'Copiar link' }}</small>
        </button>
      </div>
      <div class="connection-state" :data-state="roomState" role="status"><span aria-hidden="true" />{{ statusLabel }}</div>
    </header>

    <div class="workspace" :class="{ 'chat-open': chatOpen }">
      <aside class="sidebar">
        <div class="sidebar-room">
          <span class="sidebar-kicker">Nesta sala</span>
          <strong>{{ currentRoomCode }}</strong>
          <small>Compartilhamento protegido pelo link</small>
        </div>
        <ParticipantList :participants="participants" :voice="voiceControls.voice.value" :speaking="voiceControls.speaking.value" :status="statusLabel" />
        <p class="sidebar-help">Ative o microfone somente quando quiser falar. Você pode ouvir a sala sem conceder permissão.</p>
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
          <div v-if="errorMessage || shareNotice" class="stage-banners">
            <div v-if="errorMessage" class="error-banner stage-error" role="alert"><span>{{ errorMessage }}</span><button aria-label="Fechar erro" @click="errorMessage = ''">×</button></div>
            <div v-if="shareNotice" class="notice-banner stage-notice" role="status"><span>{{ shareNotice }}</span><button aria-label="Fechar aviso" @click="shareNotice = ''">×</button></div>
            <div v-if="voiceControls.notice.value" class="notice-banner stage-notice" role="status"><span>{{ voiceControls.notice.value }}</span><button aria-label="Fechar aviso" @click="voiceControls.notice.value = ''">×</button></div>
          </div>
          <RemoteVoiceAudio :voices="voiceControls.remoteTracks.value" :deafened="voiceControls.voice.value.deafened" @click="voiceControls.resumeAudio" />

          <div v-if="shares.length === 0 && !localStream" class="empty-stage">
            <p class="eyebrow">Nenhuma transmissão</p>
            <h2>O palco está livre</h2>
            <p>Compartilhe uma janela ou monitor quando estiver pronto.</p>
            <button class="button primary" :disabled="shareState !== 'idle'" @click="openPicker">Compartilhar minha tela</button>
          </div>

          <div v-else class="media-grid" :class="{ 'has-focus': focusedShareKey, 'single-share': shares.length + (localStream ? 1 : 0) === 1 }">
            <article v-if="localStream" class="media-tile local" :class="{ hidden: focusedShareKey }">
              <video ref="localPreview" autoplay playsinline muted :srcObject="localStream" aria-label="Prévia da sua tela" />
              <footer><span class="live-label"><span class="live-dot" aria-hidden="true" />{{ shareState === 'sharing' ? 'Ao vivo' : 'Iniciando…' }}</span><strong>Sua tela</strong><span class="audio-badge">Prévia local · {{ localStream.getAudioTracks().length ? 'Com áudio' : 'Sem áudio' }}</span></footer>
            </article>
            <MediaTile
              v-for="share in shares"
              :key="share.key"
              :share="share"
              :deafened="voiceControls.voice.value.deafened"
              :focused="focusedShareKey === share.key"
              :class="{ hidden: focusedShareKey && focusedShareKey !== share.key }"
              @focus="focusedShareKey = focusedShareKey === share.key ? '' : share.key"
            />
          </div>
        </div>

        <CallControls
          :voice="voiceControls.voice.value" :voice-busy="voiceControls.busy.value" :share-state="shareState"
          :connected="roomState === 'connected'" :chat-open="chatOpen" :unread="chat.unread"
          @microphone="voiceControls.toggleMicrophone" @deafen="voiceControls.toggleDeafen" @share="openPicker"
          @stop-share="stopSharing" @chat="toggleChat" @leave="leaveRoom"
        />
      </section>
      <ChatPanel v-if="chatOpen" ref="chatPanel" :chat="chat" :error="chatError" @close="toggleChat" @send="sendChat" />
    </div>
  </div>

  <SourcePicker v-if="shareState === 'selecting'" :voice-active="voiceControls.voice.value.joined" @cancel="cancelPicker" @share="startSharing" />
</template>
