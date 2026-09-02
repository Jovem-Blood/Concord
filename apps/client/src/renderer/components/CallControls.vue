<script setup lang="ts">
import type { ShareState } from '../domain/state'
import type { VoiceState } from '../services/cloudflare/types'
defineProps<{ voice: VoiceState; voiceBusy: boolean; shareState: ShareState; connected: boolean; chatOpen: boolean; unread: number }>()
const emit = defineEmits<{ microphone: []; deafen: []; share: []; stopShare: []; chat: []; leave: [] }>()
</script>
<template>
  <footer class="call-controls" aria-label="Controles da sala">
    <button
      class="call-control" :class="{ active: voice.joined && !voice.muted }" :disabled="!connected || voiceBusy"
      :aria-pressed="voice.joined && !voice.muted" :aria-label="voice.joined && !voice.muted ? 'Silenciar microfone' : 'Ativar microfone'"
      :title="voice.joined && !voice.muted ? 'Silenciar microfone' : 'Ativar microfone'" @click="emit('microphone')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /><path v-if="voice.muted" d="m3 3 18 18" /></svg>
      <span>{{ voiceBusy ? 'Ativando…' : 'Microfone' }}</span><small>{{ voice.joined && !voice.muted ? 'Ligado' : 'Desligado' }}</small>
    </button>
    <button
      class="call-control" :class="{ active: voice.deafened }" :aria-pressed="voice.deafened"
      :aria-label="voice.deafened ? 'Voltar a ouvir a sala' : 'Silenciar áudio da sala'" :title="voice.deafened ? 'Voltar a ouvir a sala' : 'Silenciar sala; seu microfone não muda'" @click="emit('deafen')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" /><path v-if="voice.deafened" d="m3 3 18 18" /></svg>
      <span>Áudio da sala</span><small>{{ voice.deafened ? 'Silenciado' : 'Ligado' }}</small>
    </button>
    <button
      class="call-control share-control" :class="{ active: shareState === 'sharing' }"
      :disabled="!connected || !['idle', 'sharing', 'error'].includes(shareState)" :aria-pressed="shareState === 'sharing'"
      :aria-label="shareState === 'sharing' ? 'Parar transmissão de tela' : 'Compartilhar tela'" :title="shareState === 'sharing' ? 'Parar transmissão; o microfone continua' : 'Compartilhar tela'"
      @click="shareState === 'sharing' ? emit('stopShare') : emit('share')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M12 17v4m-4 0h8m-4-8V7m-3 3 3-3 3 3" /></svg>
      <span>{{ shareState === 'sharing' ? 'Parar tela' : 'Compartilhar' }}</span><small>{{ shareState === 'starting' ? 'Iniciando…' : shareState === 'sharing' ? 'Ao vivo' : 'Tela ou janela' }}</small>
    </button>
    <button id="chat-toggle" class="call-control" :class="{ active: chatOpen }" :aria-expanded="chatOpen" aria-controls="room-chat" aria-label="Abrir ou fechar chat da sala" title="Chat efêmero da sala" @click="emit('chat')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 14a3 3 0 0 1-3 3H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /><path d="M7 8h10M7 12h6" /></svg>
      <span>Chat <b v-if="unread" class="unread-badge">{{ unread > 99 ? '99+' : unread }}</b></span><small>{{ chatOpen ? 'Aberto' : 'Fechado' }}</small>
    </button>
    <button class="call-control leave-control" aria-label="Sair da sala" title="Sair da sala" @click="emit('leave')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H4v18h5m5-14 5 5-5 5m-7-5h12" /></svg><span>Sair</span><small>Encerrar</small>
    </button>
  </footer>
</template>
