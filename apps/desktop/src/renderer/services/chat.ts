export const MAX_CHAT_LENGTH = 2000
export const MAX_CHAT_MESSAGES = 500
const MAX_WIRE_BYTES = 16_384
export type ChatPayload = { id: string; type: 'text'; content: string; sentAt: number }
export type ChatMessage = ChatPayload & { senderId: string; senderName: string }
export type ChatSnapshot = { messages: ChatMessage[]; unread: number; open: boolean; ready: boolean }

export function validChatContent(content: unknown): content is string {
  return typeof content === 'string' && content.length <= MAX_CHAT_LENGTH * 2 &&
    [...content].length <= MAX_CHAT_LENGTH && content.trim().length > 0 &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(content)
}

export function parseChatPayload(data: unknown): ChatPayload | null {
  if (typeof data !== 'string' || data.length > MAX_WIRE_BYTES || new TextEncoder().encode(data).length > MAX_WIRE_BYTES) return null
  try {
    const p = JSON.parse(data) as Record<string, unknown>
    if (!p || Array.isArray(p) || typeof p !== 'object' || p.type !== 'text' || !validChatContent(p.content) ||
        typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) ||
        typeof p.sentAt !== 'number' || !Number.isSafeInteger(p.sentAt) || p.sentAt < 0 || p.sentAt > 8_640_000_000_000_000 ||
        Object.keys(p).some((key) => !['id', 'type', 'content', 'sentAt'].includes(key))) return null
    return { id: p.id, type: 'text', content: p.content, sentAt: p.sentAt }
  } catch { return null }
}

// All retention is bounded, in memory, and explicitly reset with the transport.
export class EphemeralChat {
  private state: ChatSnapshot = { messages: [], unread: 0, open: false, ready: false }
  private recent = new Map<string, number[]>()
  constructor(private readonly changed: (snapshot: ChatSnapshot) => void) {}
  setOpen(open: boolean): void { this.state.open = open; if (open) this.state.unread = 0; this.emit() }
  setReady(ready: boolean): void { this.state.ready = ready; this.emit() }
  reset(): void { this.state.messages = []; this.state.unread = 0; this.state.ready = false; this.recent.clear(); this.emit() }
  allow(senderId: string, now = Date.now()): boolean {
    const times = (this.recent.get(senderId) ?? []).filter((time) => now - time < 5000)
    if (times.length >= 5) return false
    if (this.recent.size >= 32 && !this.recent.has(senderId)) this.recent.delete(this.recent.keys().next().value!)
    this.recent.set(senderId, [...times, now]); return true
  }
  receive(data: unknown, sender: { participantIdentity: string; participantName: string }): void {
    // Rate-limit before parsing. Identity comes from the authorized SFU subscription.
    if (!this.allow(sender.participantIdentity)) return
    const payload = parseChatPayload(data)
    if (payload) this.append(payload, sender.participantIdentity, sender.participantName, true)
  }
  append(payload: ChatPayload, senderId: string, senderName: string, remote: boolean): void {
    if (this.state.messages.some((m) => m.id === payload.id && m.senderId === senderId)) return
    this.state.messages = [...this.state.messages, { ...payload, senderId, senderName }].slice(-MAX_CHAT_MESSAGES)
    if (remote && !this.state.open) this.state.unread = Math.min(MAX_CHAT_MESSAGES, this.state.unread + 1)
    this.emit()
  }
  private emit(): void { this.changed({ ...this.state, messages: [...this.state.messages] }) }
}
