import { describe, expect, it, vi } from 'vitest'
import { EphemeralChat, MAX_CHAT_MESSAGES, parseChatPayload, validChatContent } from './chat'

describe('ephemeral chat validation', () => {
  const payload = (content = 'Olá') => JSON.stringify({ id: 'message-1', type: 'text', content, sentAt: 1 })
  it('accepts plain text and rejects malformed, oversized, HTML-shaped extra fields and invalid UTF-16', () => {
    expect(parseChatPayload(payload())).toMatchObject({ type: 'text', content: 'Olá' })
    expect(parseChatPayload('{')).toBeNull()
    expect(parseChatPayload(JSON.stringify({ id: 'x', type: 'text', content: '<b>texto</b>', sentAt: 1, html: true }))).toBeNull()
    expect(parseChatPayload(payload('a'.repeat(2001)))).toBeNull()
    expect(validChatContent('\ud800')).toBe(false)
    expect(validChatContent('🙂'.repeat(2000))).toBe(true)
  })
  it('caps memory, unread count and spam bursts', () => {
    const snapshots: { messages: unknown[]; unread: number }[] = []
    const chat = new EphemeralChat((snapshot) => snapshots.push(snapshot))
    for (let index = 0; index < MAX_CHAT_MESSAGES + 20; index++) {
      chat.append({ id: String(index), type: 'text', content: 'x', sentAt: index }, 'sender', 'Nome', true)
    }
    expect(snapshots[snapshots.length - 1]!.messages).toHaveLength(MAX_CHAT_MESSAGES)
    expect(snapshots[snapshots.length - 1]!.unread).toBe(MAX_CHAT_MESSAGES)
    const now = Date.now()
    expect([0, 1, 2, 3, 4].every(() => chat.allow('spam', now))).toBe(true)
    expect(chat.allow('spam', now)).toBe(false)
    chat.setOpen(true)
    expect(snapshots[snapshots.length - 1]!.unread).toBe(0)
  })
  it('clears every message on transport reset', () => {
    const changed = vi.fn()
    const chat = new EphemeralChat(changed)
    chat.receive(payload(), { participantIdentity: 'trusted', participantName: 'Alice' })
    chat.reset()
    expect(changed.mock.calls[changed.mock.calls.length - 1]![0]).toMatchObject({ messages: [], unread: 0, ready: false })
  })
})
