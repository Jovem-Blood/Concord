<script setup lang="ts">
import type { ShareState } from '../domain/state'
import type { VoiceState } from '../services/cloudflare/types'
import AudioMenu from './AudioMenu.vue'
defineProps<{
  voice: VoiceState; voiceBusy: boolean; shareState: ShareState; connected: boolean; chatOpen: boolean; unread: number; focused: boolean
  microphoneVolume: number; outputVolume: number; inputDeviceId: string; outputDeviceId: string; outputSelectionSupported: boolean
  inputDevices: { value: string; label: string }[]; outputDevices: { value: string; label: string }[]
}>()
const emit = defineEmits<{
  microphone: []; deafen: []; share: []; stopShare: []; chat: []; leave: []; grid: []; microphoneVolume: [value: number]; outputVolume: [value: number]
  devices: []; inputDevice: [value: string]; outputDevice: [value: string]
}>()
</script>
<template>
  <footer class="call-controls" aria-label="Controles da sala">
    <AudioMenu label="Microfone" :volume="microphoneVolume" :muted="voice.muted" mute-label="Silenciar microfone" :disabled="(!connected && !voice.joined) || voiceBusy" hover @toggle="emit('microphone')" @volume="emit('microphoneVolume', $event)" @opened="emit('devices')">
      <template #default="{ open, menuId }">
        <button
          class="call-control" :class="{ active: voice.joined && !voice.muted }" :disabled="(!connected && !voice.joined) || voiceBusy"
          :aria-busy="voiceBusy" :aria-pressed="voice.joined && !voice.muted" :aria-label="voiceBusy ? 'Ativando microfone…' : voice.joined && !voice.muted ? 'Silenciar microfone' : 'Ativar microfone'"
          :aria-expanded="open" :aria-controls="menuId" aria-haspopup="dialog" @click="emit('microphone')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /><path v-if="voice.muted" d="m3 3 18 18" /></svg>
        </button>
      </template>
      <template #options>
        <label class="audio-device-option">Dispositivo de entrada
          <select :value="inputDeviceId" :disabled="voiceBusy" @change="emit('inputDevice', ($event.target as HTMLSelectElement).value)">
            <option value="">Padrão do sistema</option>
            <option v-for="device in inputDevices" :key="device.value" :value="device.value">{{ device.label }}</option>
          </select>
        </label>
        <small v-if="!inputDevices.length" class="audio-device-hint">Ative o microfone para liberar a lista de dispositivos.</small>
      </template>
    </AudioMenu>
    <AudioMenu label="Fone" :volume="outputVolume" :muted="voice.deafened" mute-label="Silenciar áudio da sala" hover @toggle="emit('deafen')" @volume="emit('outputVolume', $event)" @opened="emit('devices')">
      <template #default="{ open, menuId }">
        <button
          class="call-control" :class="{ active: voice.deafened }" :aria-pressed="voice.deafened"
          :aria-label="voice.deafened ? 'Voltar a ouvir a sala' : 'Silenciar áudio da sala'" :aria-expanded="open" :aria-controls="menuId" aria-haspopup="dialog" @click="emit('deafen')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-3a8 8 0 0 1 16 0v3" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" /><path v-if="voice.deafened" d="m3 3 18 18" /></svg>
        </button>
      </template>
      <template #options>
        <label class="audio-device-option">Dispositivo de saída
          <select :value="outputDeviceId" :disabled="!outputSelectionSupported" @change="emit('outputDevice', ($event.target as HTMLSelectElement).value)">
            <option value="">Padrão do sistema</option>
            <option v-for="device in outputDevices" :key="device.value" :value="device.value">{{ device.label }}</option>
          </select>
        </label>
        <small v-if="!outputSelectionSupported" class="audio-device-hint">Este navegador usa a saída definida no sistema.</small>
        <small v-else-if="!outputDevices.length" class="audio-device-hint">Ative o microfone para liberar a lista de dispositivos.</small>
      </template>
    </AudioMenu>
    <button
      class="call-control share-control" :class="{ active: shareState === 'sharing' }"
      :disabled="(!connected && shareState !== 'sharing') || !['idle', 'sharing', 'error'].includes(shareState)" :aria-pressed="shareState === 'sharing'"
      :aria-label="shareState === 'sharing' ? 'Parar transmissão de tela' : 'Compartilhar tela'" :data-tooltip="shareState === 'sharing' ? 'Parar transmissão; o microfone continua' : 'Compartilhar tela'"
      @click="shareState === 'sharing' ? emit('stopShare') : emit('share')"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M12 17v4m-4 0h8m-4-8V7m-3 3 3-3 3 3" /></svg>
    </button>
    <button id="chat-toggle" class="call-control" :class="{ active: chatOpen }" :aria-expanded="chatOpen" aria-controls="room-chat" aria-label="Abrir ou fechar chat da sala" data-tooltip="Chat efêmero da sala" @click="emit('chat')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 14a3 3 0 0 1-3 3H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /><path d="M7 8h10M7 12h6" /></svg>
      <b v-if="unread" class="unread-badge">{{ unread > 99 ? '99+' : unread }}</b>
    </button>
    <button v-if="focused" class="call-control" data-tooltip="Voltar para a grade" aria-label="Voltar para a grade" @click="emit('grid')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
    </button>
    <button class="call-control leave-control" aria-label="Sair da sala" data-tooltip="Sair da sala" @click="emit('leave')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H4v18h5m5-14 5 5-5 5m-7-5h12" /></svg>
    </button>
  </footer>
</template>
