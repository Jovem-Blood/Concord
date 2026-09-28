import { MAX_MESSAGES, type ErrorCode, type Message, type SyncState, type Typist } from '@concord/protocol'

export type ChatMessage = Omit<Message, 'sequence'> & { sequence?: number; status: 'pending' | 'sent' | 'failed'; failure?: ErrorCode }
export type ChatSnapshot = {
  messages: ChatMessage[]; unread: number; open: boolean; ready: boolean; typing: Typist[]
  conversation: string; notification: number; drafts: { id: string; content: string; senderId: string }[]
}
export const emptyChat = (): ChatSnapshot => ({ messages: [], unread: 0, open: false, ready: false, typing: [], conversation: '', notification: 0, drafts: [] })

export class RoomChat {
  private state = emptyChat()
  constructor(private readonly changed: (snapshot: ChatSnapshot) => void) {}
  get snapshot(): ChatSnapshot { return { ...this.state, messages: [...this.state.messages], typing: [...this.state.typing], drafts: [...this.state.drafts] } }
  setOpen(open: boolean): void { this.state.open = open; if (open) this.state.unread = 0; this.emit() }
  setReady(ready: boolean): void { this.state.ready = ready; if (!ready) this.state.typing = []; this.emit() }
  setTyping(typing: Typist[], localIdentity: string): void { this.state.typing = typing.filter((item) => item.identity !== localIdentity); this.emit() }
  reset(recoverDrafts = false): void {
    const drafts = recoverDrafts ? [...this.state.drafts, ...this.unsentDrafts()].slice(-20) : []
    this.state = { ...emptyChat(), drafts }; this.emit()
  }
  restoreDrafts(drafts: ChatSnapshot['drafts']): void { this.state.drafts = drafts.slice(-20); this.emit() }

  synchronize(state: SyncState, localIdentity: string, initial: boolean): boolean {
    const reset = this.state.conversation !== state.conversation
    if (reset) {
      this.state.drafts = [...this.state.drafts, ...this.unsentDrafts()].slice(-20)
      this.state.messages = []; this.state.unread = 0; this.state.typing = []
      this.state.conversation = state.conversation
    }
    for (const message of state.messages) this.merge(message, localIdentity, !initial && !reset, false)
    this.state.drafts = this.state.drafts.filter((draft) => !state.messages.some((message) => message.id === draft.id && message.senderId === draft.senderId))
    this.state.messages = this.state.messages.filter((message) => message.sequence === undefined || message.sequence > state.cursor - MAX_MESSAGES)
    this.state.typing = state.typing.filter((item) => item.identity !== localIdentity)
    this.emit()
    return reset
  }

  pending(message: Omit<Message, 'sequence'>): void {
    const pendingCount = this.state.messages.filter((item) => item.status === 'pending').length
    const keepFailed = Math.max(0, 19 - pendingCount)
    const failed = keepFailed ? this.state.messages.filter((item) => item.status === 'failed').slice(-keepFailed) : []
    this.state.messages = [...this.state.messages.filter((item) => item.status !== 'failed'), ...failed]
    this.state.messages.push({ ...message, status: 'pending' })
    this.emit()
  }
  status(id: string, status: 'pending' | 'failed', failure?: ErrorCode): void {
    this.state.messages = this.state.messages.map((message) => message.id === id && message.status !== 'sent' ? { ...message, status, failure } : message)
    this.emit()
  }
  receive(message: Message, localIdentity: string, live = true): void {
    if (message.conversation !== this.state.conversation) return
    this.merge(message, localIdentity, true, live)
    this.emit()
  }
  dismissDraft(id: string): void { this.state.drafts = this.state.drafts.filter((draft) => draft.id !== id); this.emit() }
  private unsentDrafts(): ChatSnapshot['drafts'] {
    return this.state.messages.filter((message) => message.status !== 'sent').map(({ id, content, senderId }) => ({ id, content, senderId }))
  }

  private merge(message: Message, localIdentity: string, unread: boolean, sound: boolean): void {
    const index = this.state.messages.findIndex((item) => item.id === message.id && item.senderId === message.senderId)
    if (index >= 0) this.state.messages[index] = { ...message, status: 'sent' }
    else {
      this.state.messages.push({ ...message, status: 'sent' })
      if (message.senderId !== localIdentity) {
        if (unread && !this.state.open) this.state.unread = Math.min(MAX_MESSAGES, this.state.unread + 1)
        if (sound) this.state.notification++
      }
    }
    const sent = this.state.messages.filter((item) => item.status === 'sent').sort((a, b) => a.sequence! - b.sequence!).slice(-MAX_MESSAGES)
    const outgoing = this.state.messages.filter((item) => item.status !== 'sent').slice(-20)
    this.state.messages = [...sent, ...outgoing]
  }
  private emit(): void { this.changed(this.snapshot) }
}
