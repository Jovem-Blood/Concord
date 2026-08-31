<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { ChatSnapshot } from '../services/chat'
const props = defineProps<{ chat: ChatSnapshot; error: string }>()
const emit = defineEmits<{ close: []; send: [content: string] }>()
const draft = ref('')
const composer = ref<HTMLTextAreaElement | null>(null)
const log = ref<HTMLElement | null>(null)
const follow = ref(true)
const count = () => [...draft.value].length
function send(): void { if (props.chat.ready && draft.value.trim() && count() <= 2000) emit('send', draft.value) }
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() }
}
function scroll(): void { if (log.value) follow.value = log.value.scrollHeight - log.value.scrollTop - log.value.clientHeight < 70 }
watch(() => props.chat.messages.length ? props.chat.messages[props.chat.messages.length - 1]?.id : '', async () => {
  await nextTick(); if (follow.value && log.value) log.value.scrollTop = log.value.scrollHeight
})
onMounted(() => composer.value?.focus({ preventScroll: true }))
onBeforeUnmount(() => document.getElementById('chat-toggle')?.focus({ preventScroll: true }))
defineExpose({ clearDraft: () => { draft.value = '' } })
</script>
<template>
  <aside id="room-chat" class="chat-panel" aria-labelledby="chat-title" @keydown.esc.stop="emit('close')">
    <header class="chat-header"><div><p class="eyebrow">Só nesta sessão</p><h2 id="chat-title">Chat da sala</h2></div><button class="icon-button" aria-label="Fechar chat" title="Fechar chat" @click="emit('close')">×</button></header>
    <p class="chat-privacy">Sem histórico. As mensagens desaparecem ao sair ou reconectar.</p>
    <div ref="log" class="chat-log" role="log" aria-label="Mensagens da sala" aria-live="polite" aria-relevant="additions" @scroll="scroll">
      <div v-if="!chat.messages.length" class="chat-empty"><strong>A conversa começa aqui</strong><p>Somente novas mensagens aparecem nesta sessão.</p></div>
      <article v-for="message in chat.messages" :key="`${message.senderId}:${message.id}`" class="chat-message">
        <header><strong>{{ message.senderName }}</strong><time :datetime="new Date(message.sentAt).toISOString()">{{ new Date(message.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}</time></header>
        <p>{{ message.content }}</p>
      </article>
    </div>
    <form class="chat-composer" @submit.prevent="send">
      <label for="chat-message">Mensagem para a sala</label>
      <textarea id="chat-message" ref="composer" v-model="draft" rows="3" maxlength="4000" :disabled="!chat.ready" :placeholder="chat.ready ? 'Escreva uma mensagem…' : 'Conectando o chat…'" @keydown="onKey" />
      <div><small :class="{ 'text-danger': count() > 2000 }">{{ count() }}/2000 · Shift+Enter: nova linha</small><button class="button primary" :disabled="!chat.ready || !draft.trim() || count() > 2000">Enviar</button></div>
      <p v-if="error" class="chat-error" role="alert">{{ error }}</p>
    </form>
  </aside>
</template>
