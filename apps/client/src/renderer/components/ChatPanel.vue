<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { REACTION_EMOJIS, type ReactionEmoji, type ReplyReference } from '@concord/protocol'
import type { ChatMessage, ChatSnapshot } from '../services/room-chat'

const props = defineProps<{ chat: ChatSnapshot; error: string; reconnecting: boolean }>()
const emit = defineEmits<{
  close: []
  send: [content: string, replyTo?: ReplyReference]
  react: [messageId: string, emoji: ReactionEmoji]
  typing: [active: boolean]
  retry: [id: string]
  dismissDraft: [id: string]
}>()
const draft = defineModel<string>('draft', { default: '' })
const composer = ref<HTMLTextAreaElement | null>(null)
const log = ref<HTMLElement | null>(null)
const follow = ref(true)
const replyingTo = ref<ReplyReference | null>(null)
const emojiOpen = ref(false)
const reactionMessage = ref('')
const composerEmojis = ['😀', '😄', '😂', '😊', '😍', '🥳', '😎', '🤔', '😮', '😢', '😡', '👍', '👏', '🙌', '🙏', '❤️', '🔥', '✨', '🎉', '✅', '👀', '💡', '🚀', '💯']
const count = () => [...draft.value].length

function send(): void {
  if (!props.chat.ready || !draft.value.trim() || count() > 2000) return
  emit('typing', false)
  emit('send', draft.value, replyingTo.value ?? undefined)
  void nextTick(() => { if (!draft.value) replyingTo.value = null })
}
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
function onEscape(): void {
  if (emojiOpen.value) { emojiOpen.value = false; return }
  if (reactionMessage.value) { reactionMessage.value = ''; return }
  if (replyingTo.value) { replyingTo.value = null; return }
  emit('close')
}
function insertEmoji(emoji: string): void {
  const element = composer.value
  const start = element?.selectionStart ?? draft.value.length
  const end = element?.selectionEnd ?? start
  const next = `${draft.value.slice(0, start)}${emoji}${draft.value.slice(end)}`
  if ([...next].length > 2000) return
  draft.value = next
  emojiOpen.value = false
  emit('typing', Boolean(next.trim()))
  void nextTick(() => {
    element?.focus()
    element?.setSelectionRange(start + emoji.length, start + emoji.length)
  })
}
function replyTo(message: ChatMessage): void {
  replyingTo.value = { id: message.id, senderName: message.senderName, content: message.content }
  reactionMessage.value = ''
  void nextTick(() => composer.value?.focus())
}
function react(messageId: string, emoji: ReactionEmoji): void {
  emit('react', messageId, emoji)
  reactionMessage.value = ''
}
function reacted(message: ChatMessage, emoji: ReactionEmoji): boolean {
  return Boolean(message.reactions.find((reaction) => reaction.emoji === emoji)?.senders.some((sender) => sender.id === props.chat.localIdentity))
}
function reactionLabel(message: ChatMessage, emoji: ReactionEmoji): string {
  const names = message.reactions.find((reaction) => reaction.emoji === emoji)?.senders.map((sender) => sender.name) ?? []
  return names.length ? `${emoji} por ${names.join(', ')}` : `Reagir com ${emoji}`
}
function isGrouped(index: number): boolean {
  const message = props.chat.messages[index]
  const previous = props.chat.messages[index - 1]
  return Boolean(message && previous && message.senderId === previous.senderId && message.sentAt - previous.sentAt < 5 * 60_000)
}
function jumpTo(messageId: string): void {
  const target = [...(log.value?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])]
    .find((element) => element.dataset.messageId === messageId)
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  target?.focus({ preventScroll: true })
}
function scroll(): void {
  if (log.value) follow.value = log.value.scrollHeight - log.value.scrollTop - log.value.clientHeight < 70
}
watch(() => props.chat.messages.length ? props.chat.messages[props.chat.messages.length - 1]?.id : '', async () => {
  await nextTick()
  if (follow.value && log.value) log.value.scrollTop = log.value.scrollHeight
})
onMounted(() => { composer.value?.focus({ preventScroll: true }); if (log.value) log.value.scrollTop = log.value.scrollHeight })
onBeforeUnmount(() => { emit('typing', false); document.getElementById('chat-toggle')?.focus({ preventScroll: true }) })
</script>

<template>
  <aside id="room-chat" class="chat-panel" aria-labelledby="chat-title" @keydown.esc.stop="onEscape">
    <header class="chat-header">
      <div><p class="eyebrow">Só nesta sessão</p><h2 id="chat-title">Chat da sala</h2></div>
      <button class="icon-button" aria-label="Fechar chat" data-tooltip="Fechar chat" @click="emit('close')">×</button>
    </header>
    <p class="chat-privacy">Até 500 mensagens na memória do servidor. Quando a última conexão cai, o histórico é apagado.</p>
    <div ref="log" class="chat-log" role="log" aria-label="Mensagens da sala" aria-live="polite" aria-relevant="additions" @scroll="scroll">
      <div v-if="!chat.messages.length" class="chat-empty"><strong>A conversa começa aqui</strong><p>As mensagens ficam disponíveis enquanto a sala estiver ocupada.</p></div>
      <article
        v-for="(message, index) in chat.messages"
        :key="`${message.senderId}:${message.id}`"
        class="chat-message"
        :class="[`message-${message.status}`, { grouped: isGrouped(index), own: message.senderId === chat.localIdentity }]"
        :data-message-id="message.id"
        tabindex="-1"
        :aria-label="message.status === 'pending' ? 'Mensagem pendente' : message.status === 'failed' ? 'Falha ao enviar mensagem' : undefined"
      >
        <header v-if="!isGrouped(index)">
          <strong>{{ message.senderName }}{{ message.senderId === chat.localIdentity ? ' · Você' : '' }}</strong>
          <time :datetime="new Date(message.sentAt).toISOString()">{{ new Date(message.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}</time>
        </header>
        <button v-if="message.replyTo" class="message-quote" type="button" :aria-label="`Ir para mensagem de ${message.replyTo.senderName}`" @click="jumpTo(message.replyTo.id)">
          <strong>{{ message.replyTo.senderName }}</strong><span>{{ message.replyTo.content }}</span>
        </button>
        <p class="message-content">{{ message.content }}</p>
        <div v-if="message.reactions.length" class="message-reactions" aria-label="Reações">
          <button
            v-for="reaction in message.reactions"
            :key="reaction.emoji"
            type="button"
            :class="{ active: reacted(message, reaction.emoji) }"
            :disabled="!chat.ready"
            :aria-label="reactionLabel(message, reaction.emoji)"
            :aria-pressed="reacted(message, reaction.emoji)"
            :title="reactionLabel(message, reaction.emoji)"
            @click="react(message.id, reaction.emoji)"
          >
            {{ reaction.emoji }} <span>{{ reaction.senders.length }}</span>
          </button>
        </div>
        <div v-if="message.status === 'sent'" class="message-actions">
          <button type="button" aria-label="Responder" title="Responder" @click="replyTo(message)">↩</button>
          <button type="button" aria-label="Adicionar reação" title="Adicionar reação" :aria-expanded="reactionMessage === message.id" @click="reactionMessage = reactionMessage === message.id ? '' : message.id">☺</button>
          <time v-if="isGrouped(index)" :datetime="new Date(message.sentAt).toISOString()">{{ new Date(message.sentAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}</time>
        </div>
        <div v-if="reactionMessage === message.id" class="reaction-picker" aria-label="Escolha uma reação">
          <button v-for="emoji in REACTION_EMOJIS" :key="emoji" type="button" :class="{ active: reacted(message, emoji) }" :aria-label="reactionLabel(message, emoji)" @click="react(message.id, emoji)">{{ emoji }}</button>
        </div>
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
      <div v-if="replyingTo" class="composer-reply">
        <div><span>Respondendo a {{ replyingTo.senderName }}</span><p>{{ replyingTo.content }}</p></div>
        <button type="button" aria-label="Cancelar resposta" @click="replyingTo = null">×</button>
      </div>
      <label for="chat-message">Mensagem para a sala</label>
      <div class="composer-input">
        <textarea id="chat-message" ref="composer" v-model="draft" rows="3" maxlength="4000" :placeholder="chat.ready ? 'Escreva uma mensagem…' : reconnecting ? 'Seu rascunho fica aqui enquanto reconectamos…' : 'Entre novamente para enviar seu rascunho…'" @input="emit('typing', Boolean(draft.trim()))" @keydown="onKey" />
        <button class="emoji-toggle" type="button" aria-label="Adicionar emoji" :aria-expanded="emojiOpen" @click="emojiOpen = !emojiOpen">☺</button>
        <div v-if="emojiOpen" class="emoji-picker" aria-label="Escolha um emoji">
          <button v-for="emoji in composerEmojis" :key="emoji" type="button" :aria-label="`Adicionar ${emoji}`" @click="insertEmoji(emoji)">{{ emoji }}</button>
        </div>
      </div>
      <div class="composer-footer"><small :class="{ 'text-danger': count() > 2000 }">{{ count() }}/2000 · Shift+Enter: nova linha</small><button class="button primary chat-send" :disabled="!chat.ready || !draft.trim() || count() > 2000" :aria-label="reconnecting ? 'Reconectando o chat' : 'Enviar mensagem'" :aria-busy="reconnecting"><span v-if="reconnecting" class="send-spinner" aria-hidden="true" /><span v-else>Enviar</span></button></div>
      <p v-if="error" class="chat-error" role="alert">{{ error }}</p>
    </form>
  </aside>
</template>
