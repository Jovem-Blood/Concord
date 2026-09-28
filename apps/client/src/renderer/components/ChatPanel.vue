<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { ChatSnapshot } from '../services/room-chat'
const props = defineProps<{ chat: ChatSnapshot; error: string; reconnecting: boolean }>()
const emit = defineEmits<{ close: []; send: [content: string]; typing: [active: boolean]; retry: [id: string]; dismissDraft: [id: string] }>()
const draft = defineModel<string>('draft', { default: '' })
const composer = ref<HTMLTextAreaElement | null>(null)
const log = ref<HTMLElement | null>(null)
const follow = ref(true)
const count = () => [...draft.value].length
function send(): void { if (props.chat.ready && draft.value.trim() && count() <= 2000) { emit('typing', false); emit('send', draft.value) } }
const typingLabel = computed(() => {
  const names = props.chat.typing.map((item) => item.name)
  if (names.length === 1) return `${names[0]} está digitando…`
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando…`
  return names.length ? `${names.slice(0, 2).join(', ')} e mais ${names.length - 2} estão digitando…` : ''
})
function copyDraft(content: string, id?: string): void {
  draft.value = content
  if (id) emit('dismissDraft', id)
  void nextTick(() => composer.value?.focus())
}
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() }
}
function scroll(): void { if (log.value) follow.value = log.value.scrollHeight - log.value.scrollTop - log.value.clientHeight < 70 }
watch(() => props.chat.messages.length ? props.chat.messages[props.chat.messages.length - 1]?.id : '', async () => {
  await nextTick(); if (follow.value && log.value) log.value.scrollTop = log.value.scrollHeight
})
onMounted(() => { composer.value?.focus({ preventScroll: true }); if (log.value) log.value.scrollTop = log.value.scrollHeight })
onBeforeUnmount(() => { emit('typing', false); document.getElementById('chat-toggle')?.focus({ preventScroll: true }) })
</script>
<template>
  <aside id="room-chat" class="chat-panel" aria-labelledby="chat-title" @keydown.esc.stop="emit('close')">
    <header class="chat-header"><div><p class="eyebrow">Só nesta sessão</p><h2 id="chat-title">Chat da sala</h2></div><button class="icon-button" aria-label="Fechar chat" data-tooltip="Fechar chat" @click="emit('close')">×</button></header>
    <p class="chat-privacy">Até 500 mensagens na memória do servidor. Quando a última conexão cai, o histórico é apagado.</p>
    <div ref="log" class="chat-log" role="log" aria-label="Mensagens da sala" aria-live="polite" aria-relevant="additions" @scroll="scroll">
      <div v-if="!chat.messages.length" class="chat-empty"><strong>A conversa começa aqui</strong><p>As mensagens ficam disponíveis enquanto a sala estiver ocupada.</p></div>
      <article v-for="message in chat.messages" :key="`${message.senderId}:${message.id}`" class="chat-message" :class="`message-${message.status}`" :aria-label="message.status === 'pending' ? 'Mensagem pendente' : message.status === 'failed' ? 'Falha ao enviar mensagem' : undefined">
        <header><strong>{{ message.senderName }}</strong><time :datetime="new Date(message.sentAt).toISOString()">{{ new Date(message.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}</time></header>
        <p>{{ message.content }}</p>
        <button v-if="message.status === 'failed' && message.failure !== 'MESSAGE_EXPIRED'" class="message-retry" :disabled="!chat.ready" @click="emit('retry', message.id)">Reenviar</button>
        <button v-else-if="message.status === 'failed'" class="message-retry" @click="copyDraft(message.content)">Copiar para o rascunho</button>
      </article>
      <div v-for="item in chat.drafts" :key="item.id" class="chat-recovered-draft">
        <p>A conversa anterior terminou. Você pode recuperar seu rascunho.</p>
        <button class="message-retry" @click="copyDraft(item.content, item.id)">Copiar para o rascunho</button>
        <button class="message-retry" @click="emit('dismissDraft', item.id)">Descartar</button>
      </div>
    </div>
    <form class="chat-composer" @submit.prevent="send">
      <p class="chat-typing" role="status" aria-live="polite">{{ typingLabel }}</p>
      <label for="chat-message">Mensagem para a sala</label>
      <textarea id="chat-message" ref="composer" v-model="draft" rows="3" maxlength="4000" :placeholder="chat.ready ? 'Escreva uma mensagem…' : reconnecting ? 'Seu rascunho fica aqui enquanto reconectamos…' : 'Entre novamente para enviar seu rascunho…'" @input="emit('typing', Boolean(draft.trim()))" @keydown="onKey" />
      <div><small :class="{ 'text-danger': count() > 2000 }">{{ count() }}/2000 · Shift+Enter: nova linha</small><button class="button primary chat-send" :disabled="!chat.ready || !draft.trim() || count() > 2000" :aria-label="reconnecting ? 'Reconectando o chat' : 'Enviar mensagem'" :aria-busy="reconnecting"><span v-if="reconnecting" class="send-spinner" aria-hidden="true" /><span v-else>Enviar</span></button></div>
      <p v-if="error" class="chat-error" role="alert">{{ error }}</p>
    </form>
  </aside>
</template>
