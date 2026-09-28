import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { MAX_MESSAGES, RECOVERY_MS, TOKEN_MS, TYPING_MS, validContent,
  type Credentials, type ErrorCode, type MediaSource, type Message, type Presence, type SendMessage, type SyncRequest, type SyncState, type Typist } from '@concord/protocol'

type Publication = { mid: string; trackName: string; kind: 'video' | 'audio'; source: MediaSource }
export type Participant = {
  identity: string; name: string; roomCode: string; expiresAt: number
  credentials: Credentials; pendingCredentials?: Credentials; tokens: Set<string>
  socketId?: string; joined: boolean; recoveryUntil: number; ready: boolean
  sessionId?: string; published: Map<string, Publication>; mids: Set<string>; busy: boolean
  chatSentAt: number[]; typingAt: number; typingUntil: number
  sequenceConversation: string; highWater: number
}
type Conversation = { id: string; cursor: number; messages: Message[]; receipts: Map<string, Message> }
export class RoomError extends Error {
  constructor(readonly code: ErrorCode, readonly statusCode = 400) { super(code) }
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

// The only authority for room membership, credential lifetime and conversation generations.
// Socket and HTTP adapters both use this object; HTTP traffic never extends presence.
export class RoomAuthority {
  readonly members = new Map<string, Participant>()
  private tokens = new Map<string, { member: Participant; until: number }>()
  private conversations = new Map<string, Conversation>()
  private lastPresence = new Map<string, string>()
  onPresence: (room: string, presence: Presence) => void = () => undefined
  onTyping: (room: string, typing: Typist[]) => void = () => undefined
  onMessage: (room: string, message: Message) => void = () => undefined
  onEnd: (socketId: string, reason: ErrorCode) => void = () => undefined

  constructor(private readonly cleanup: (member: Participant) => Promise<void>, private readonly now = () => Date.now()) {}

  create(roomCode: string, name: string): Credentials {
    this.sweep()
    if (this.members.size >= 2000) throw Object.assign(new Error('Server capacity reached.'), { statusCode: 503 })
    if (this.roomMembers(roomCode).length >= 16) throw Object.assign(new Error('Room capacity reached.'), { statusCode: 409 })
    const identity = randomUUID()
    const credentials = { participantToken: randomBytes(32).toString('base64url'), identity, expiresAt: this.now() + TOKEN_MS }
    const member: Participant = { identity, name, roomCode, credentials, expiresAt: credentials.expiresAt, tokens: new Set(),
      joined: false, ready: false, recoveryUntil: this.now() + RECOVERY_MS, published: new Map(), mids: new Set(), busy: false,
      chatSentAt: [], typingAt: 0, typingUntil: 0, sequenceConversation: '', highWater: 0 }
    this.members.set(identity, member)
    this.addToken(member, credentials.participantToken)
    return credentials
  }

  active(member: Participant): boolean {
    return this.members.get(member.identity) === member && member.expiresAt > this.now() &&
      (Boolean(member.socketId) || member.recoveryUntil > this.now())
  }

  authenticate(token: unknown, requireSocket = false): Participant {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new RoomError('SESSION_ENDED', 401)
    const entry = this.tokens.get(hash(token))
    if (!entry || entry.until <= this.now() || !this.active(entry.member)) throw new RoomError('SESSION_ENDED', 401)
    if (requireSocket && (!entry.member.socketId || !entry.member.ready)) throw new RoomError('NOT_READY', 409)
    return entry.member
  }

  attach(token: unknown, socketId: string): Participant {
    const member = this.authenticate(token)
    const previous = member.socketId
    // Replace ownership before closing the old socket; its disconnect callback becomes harmless.
    member.socketId = socketId
    member.ready = false
    member.joined = true
    member.recoveryUntil = 0
    if (previous && previous !== socketId) this.onEnd(previous, 'REPLACED')
    this.conversation(member.roomCode)
    this.changed(member.roomCode)
    return member
  }

  owns(member: Participant, socketId: string): boolean {
    return this.active(member) && member.socketId === socketId
  }

  detach(member: Participant, socketId: string): void {
    if (member.socketId !== socketId || !this.members.has(member.identity)) return
    member.socketId = undefined
    member.ready = false
    member.recoveryUntil = this.now() + RECOVERY_MS
    member.typingUntil = 0
    this.clearEmptyConversation(member.roomCode)
    this.changed(member.roomCode)
    this.typingChanged(member.roomCode)
  }

  sync(member: Participant, request: SyncRequest): SyncState {
    if (!record(request) || typeof request.conversation !== 'string' || request.conversation.length > 64 ||
      !Number.isSafeInteger(request.after) || request.after < 0) throw new RoomError('INVALID_REQUEST')
    const chat = this.conversation(member.roomCode)
    this.prepareSequence(member, chat.id)
    member.ready = true
    return { presence: this.presence(member.roomCode), conversation: chat.id, cursor: chat.cursor,
      messages: request.conversation === chat.id ? chat.messages.filter((message) => message.sequence > request.after) : [...chat.messages],
      typing: this.typing(member.roomCode), serverTime: this.now(), credentials: member.pendingCredentials ?? member.credentials,
      nextClientSequence: member.highWater + 1 }
  }

  send(member: Participant, input: SendMessage): Message {
    if (!member.ready) throw new RoomError('NOT_READY')
    if (!record(input) || typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.id) || !validContent(input.content) ||
      typeof input.conversation !== 'string' || !Number.isSafeInteger(input.clientSequence) || input.clientSequence < 1 ||
      Object.keys(input).some((key) => !['id', 'content', 'conversation', 'clientSequence'].includes(key))) throw new RoomError('INVALID_REQUEST')
    const chat = this.conversation(member.roomCode)
    if (input.conversation !== chat.id) throw new RoomError('CONVERSATION_RESET')
    this.pruneReceipts(chat)
    const key = `${member.identity}:${input.id}`
    const existing = chat.receipts.get(key) ?? chat.messages.find((message) => message.senderId === member.identity && message.id === input.id)
    if (existing) {
      if (existing.content !== input.content || existing.clientSequence !== input.clientSequence) throw new RoomError('INVALID_REQUEST')
      return existing
    }
    this.prepareSequence(member, chat.id)
    // A bounded high-water mark prevents ancient retries from being re-published after eviction.
    if (input.clientSequence <= member.highWater) throw new RoomError('MESSAGE_EXPIRED')
    member.chatSentAt = member.chatSentAt.filter((time) => this.now() - time < 5000)
    if (member.chatSentAt.length >= 5) throw new RoomError('RATE_LIMITED', 429)
    member.chatSentAt.push(this.now())
    member.highWater = input.clientSequence
    const message: Message = { ...input, type: 'text', senderId: member.identity, senderName: member.name, sentAt: this.now(), sequence: ++chat.cursor }
    chat.messages.push(message)
    if (chat.messages.length > MAX_MESSAGES) chat.messages.shift()
    chat.receipts.set(key, message)
    while (chat.receipts.size > 2048) chat.receipts.delete(chat.receipts.keys().next().value!)
    member.typingUntil = 0
    this.onMessage(member.roomCode, message)
    this.typingChanged(member.roomCode)
    return message
  }

  setTyping(member: Participant, input: { conversation: string; active: boolean }): void {
    if (!member.ready || !record(input) || typeof input.active !== 'boolean' || input.conversation !== this.conversation(member.roomCode).id) return
    if (input.active && this.now() - member.typingAt < 900) return
    member.typingAt = this.now()
    member.typingUntil = input.active ? this.now() + TYPING_MS : 0
    this.typingChanged(member.roomCode)
  }

  renew(member: Participant): Credentials {
    if (member.pendingCredentials) return member.pendingCredentials
    if (member.expiresAt - this.now() > 10 * 60 * 1000) return member.credentials
    const credentials = { participantToken: randomBytes(32).toString('base64url'), identity: member.identity, expiresAt: this.now() + TOKEN_MS }
    member.pendingCredentials = credentials
    member.expiresAt = credentials.expiresAt
    this.addToken(member, credentials.participantToken)
    // Keep the previous credential valid until the replacement is acknowledged.
    return credentials
  }

  confirm(member: Participant, token: string): void {
    if (member.credentials.participantToken === token) return
    if (member.pendingCredentials?.participantToken !== token) throw new RoomError('INVALID_REQUEST')
    const previous = this.tokens.get(hash(member.credentials.participantToken))
    if (previous) previous.until = this.now() + 45_000
    member.credentials = member.pendingCredentials
    member.pendingCredentials = undefined
  }

  remove(member: Participant, reason: ErrorCode = 'SESSION_ENDED'): void {
    if (!this.members.delete(member.identity)) return
    member.expiresAt = 0
    member.ready = false
    for (const key of member.tokens) this.tokens.delete(key)
    if (member.socketId) this.onEnd(member.socketId, reason)
    member.socketId = undefined
    this.clearEmptyConversation(member.roomCode)
    this.changed(member.roomCode)
    this.typingChanged(member.roomCode)
    // In-flight SFU requests own their eventual cleanup in the HTTP adapter's finally block.
    if (!member.busy) void this.cleanup(member)
  }

  presence(roomCode: string): Presence {
    const members = this.roomMembers(roomCode).filter((member) => member.joined)
    return {
      participants: members.map((member) => ({ identity: member.identity, name: member.name,
        connection: member.socketId ? 'connected' : 'reconnecting',
        voice: { available: [...member.published.values()].some((track) => track.source === 'microphone') } })),
      tracks: members.flatMap((member) => [...member.published.values()].map((track) => ({
        participantIdentity: member.identity, participantName: member.name, sessionId: member.sessionId!,
        trackName: track.trackName, kind: track.kind, source: track.source,
      }))),
    }
  }

  changed(roomCode: string): void {
    const presence = this.presence(roomCode)
    const serialized = JSON.stringify(presence)
    if (this.lastPresence.get(roomCode) !== serialized) {
      this.lastPresence.set(roomCode, serialized)
      this.onPresence(roomCode, presence)
    }
    if (!this.roomMembers(roomCode).length) this.lastPresence.delete(roomCode)
  }

  sweep(): void {
    for (const member of this.members.values()) {
      if (!this.active(member)) this.remove(member)
      else if (member.typingUntil && member.typingUntil <= this.now()) {
        member.typingUntil = 0
        this.typingChanged(member.roomCode)
      }
    }
    for (const [key, entry] of this.tokens) if (entry.until <= this.now()) { this.tokens.delete(key); entry.member.tokens.delete(key) }
    for (const chat of this.conversations.values()) this.pruneReceipts(chat)
  }

  async close(): Promise<void> {
    const members = [...this.members.values()]
    for (const member of members) { member.expiresAt = 0; if (member.socketId) this.onEnd(member.socketId, 'SESSION_ENDED') }
    this.members.clear(); this.tokens.clear(); this.conversations.clear(); this.lastPresence.clear()
    await Promise.all(members.filter((member) => !member.busy).map(this.cleanup))
  }

  private roomMembers(roomCode: string): Participant[] { return [...this.members.values()].filter((member) => member.roomCode === roomCode && this.active(member)) }
  private addToken(member: Participant, token: string): void { const key = hash(token); member.tokens.add(key); this.tokens.set(key, { member, until: Infinity }) }
  private clearEmptyConversation(roomCode: string): void {
    if (!this.roomMembers(roomCode).some((member) => member.socketId)) this.conversations.delete(roomCode)
  }
  private conversation(roomCode: string): Conversation {
    let chat = this.conversations.get(roomCode)
    if (!chat) { chat = { id: randomUUID(), cursor: 0, messages: [], receipts: new Map() }; this.conversations.set(roomCode, chat) }
    return chat
  }
  private prepareSequence(member: Participant, conversation: string): void {
    if (member.sequenceConversation !== conversation) { member.sequenceConversation = conversation; member.highWater = 0 }
  }
  private pruneReceipts(chat: Conversation): void {
    for (const [key, message] of chat.receipts) if (message.sentAt + 60_000 <= this.now()) chat.receipts.delete(key)
  }
  private typing(roomCode: string): Typist[] {
    return this.roomMembers(roomCode).filter((member) => member.socketId && member.typingUntil > this.now())
      .map((member) => ({ identity: member.identity, name: member.name, expiresAt: member.typingUntil }))
  }
  private typingChanged(roomCode: string): void { this.onTyping(roomCode, this.typing(roomCode)) }
}
