import { io, type Socket } from 'socket.io-client'
import { ACK_MS, PROTOCOL_VERSION, RECOVERY_MS, RENEW_BEFORE_MS, RETRY_MS, SOCKET_PATH, TYPING_MS, validContent,
  type ClientEvents, type Credentials, type ErrorCode, type Message, type Presence, type Result, type SendMessage, type ServerEvents, type SyncState } from '@concord/protocol'
import type { CaptureResolution } from '../../shared/capture'
import { CloudflareRoomService } from './cloudflare/room'
import type { RoomSnapshot } from './cloudflare/types'
import { RoomChat, type ChatSnapshot } from './room-chat'
import { requestJoinToken, serverUrl } from './server'
import { logClient } from './telemetry'

type State = 'joining' | 'connected' | 'reconnecting' | 'disconnected'
type RoomSocket = Socket<ServerEvents, ClientEvents>
type Outgoing = { input: SendMessage; deadline: number; inFlight: boolean; timer?: ReturnType<typeof setTimeout> }
export type MediaService = Pick<CloudflareRoomService, 'connect' | 'disconnect' | 'updateCredentials' | 'setSignalingAvailable' | 'updatePresence' | 'onSnapshot' | 'onConnection' | 'publishScreen' | 'unpublishScreen' | 'publishMicrophone' | 'unpublishMicrophone' | 'pauseShare' | 'resumeShare'>

const explanations: Record<ErrorCode, string> = {
  UPDATE_REQUIRED: 'Atualize o Concord para entrar nesta sala.',
  SESSION_ENDED: 'A sessão terminou. Entre novamente para continuar.',
  REPLACED: 'Esta conexão foi substituída. Entre novamente para continuar.',
  CONVERSATION_RESET: 'A sala ficou sem conexões e o histórico foi apagado.',
  MESSAGE_EXPIRED: 'Esta mensagem não pode mais ser reenviada. Copie para o rascunho.',
  INVALID_REQUEST: 'Não foi possível concluir esta ação.', RATE_LIMITED: 'Aguarde um momento antes de enviar novamente.', NOT_READY: 'Reconectando à sala…',
}

// Owns the entire room lifecycle. Components and media never open their own room connections.
export class RoomSession {
  private socket: RoomSocket | null = null
  private credentials: Credentials | null = null
  private generation = 0
  private connectionGeneration = 0
  private state: State = 'disconnected'
  private name = ''
  private roomCode = ''
  private cursor = 0
  private conversation = ''
  private nextSequence = 1
  private loaded = false
  private syncing = false
  private bufferedMessages: Message[] = []
  private bufferedPresence?: Presence
  private deadline = 0
  private serverClockOffset = 0
  private lastHeartbeat = 0
  private heartbeatListener?: () => void
  private recoveryTimer?: ReturnType<typeof setTimeout>
  private renewTimer?: ReturnType<typeof setTimeout>
  private typingTimer?: ReturnType<typeof setTimeout>
  private remoteTypingTimer?: ReturnType<typeof setTimeout>
  private lastTyping = 0
  private typing = false
  private pending = new Map<string, Outgoing>()
  private joined?: { resolve: () => void; reject: (error: Error) => void }
  private connectionListener: (state: State, message?: string) => void = () => undefined
  private chatListener: (chat: ChatSnapshot) => void = () => undefined
  private chat = new RoomChat((snapshot) => this.chatListener(snapshot))
  private pageHidden = () => { if (document.hidden) this.setTyping(false); else this.wake() }
  private pageHide = () => { void this.disconnect(true) }
  private wake = () => {
    if (!this.credentials || !this.checkDeadline()) return
    // Browser timers can be frozen during sleep. Apply the server's heartbeat + recovery budget on wake.
    const elapsed = Date.now() - this.lastHeartbeat
    if (this.loaded && elapsed >= 15_000 + RECOVERY_MS) this.end('SESSION_ENDED')
    else if (this.loaded && elapsed >= 15_000 && this.socket?.connected) this.socket.io.engine?.close()
  }

  constructor(private readonly media: MediaService = new CloudflareRoomService(),
    private readonly createSocket: () => RoomSocket = () => io(serverUrl, {
      path: SOCKET_PATH, transports: ['websocket'], autoConnect: false, forceNew: true,
      reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000, randomizationFactor: 0.5,
      timeout: ACK_MS, closeOnBeforeunload: false,
      // No automatic packet buffering/retries: only our bounded, generation-scoped outbox may retry.
    })) {
    this.media.onConnection((state) => { if (state === 'disconnected' && this.credentials) this.end('SESSION_ENDED', false) })
  }

  onSnapshot(listener: (snapshot: RoomSnapshot) => void): void { this.media.onSnapshot(listener) }
  onConnection(listener: (state: State, message?: string) => void): void { this.connectionListener = listener }
  onChat(listener: (snapshot: ChatSnapshot) => void): void { this.chatListener = listener }

  async join(roomCode: string, name: string): Promise<void> {
    const drafts = this.roomCode === roomCode ? this.chat.snapshot.drafts : []
    const cleanup = this.disconnect()
    const generation = this.generation
    await cleanup
    if (generation !== this.generation) throw new Error('Entrada cancelada.')
    this.name = name
    this.roomCode = roomCode
    this.chat.restoreDrafts(drafts)
    this.connection('joining')
    let credentials: Credentials
    try { credentials = await requestJoinToken(roomCode, name) } catch (error) {
      if (generation === this.generation) this.connection('disconnected')
      throw error
    }
    if (generation !== this.generation) { this.sendLeave(credentials, false); throw new Error('Entrada cancelada.') }
    this.credentials = credentials
    await this.media.connect(credentials)
    if (generation !== this.generation) throw new Error('Entrada cancelada.')
    const socket = this.createSocket()
    this.socket = socket
    socket.auth = (callback) => callback({ protocol: PROTOCOL_VERSION, token: this.credentials?.participantToken })
    const joined = new Promise<void>((resolve, reject) => { this.joined = { resolve, reject } })
    const current = () => this.generation === generation && this.socket === socket
    this.lastHeartbeat = Date.now()
    this.heartbeatListener = () => { if (current()) this.lastHeartbeat = Date.now() }
    socket.io.on('ping', this.heartbeatListener)
    socket.on('connect', () => {
      if (!current() || !this.checkDeadline()) return
      this.connectionGeneration++
      void this.synchronize()
    })
    socket.on('disconnect', (reason) => {
      if (!current()) return
      this.connectionGeneration++
      // Regular emits avoid dropping packets during a momentary transport backpressure window.
      // Never let Socket.IO replay anything after a disconnect; our bounded outbox owns retries.
      socket.sendBuffer = []
      this.syncing = false
      this.bufferedMessages = []; this.bufferedPresence = undefined
      this.chat.setReady(false)
      this.media.setSignalingAvailable(false)
      this.clearTyping()
      for (const outgoing of this.pending.values()) outgoing.inFlight = false
      if (reason === 'io server disconnect') { this.end('SESSION_ENDED'); return }
      this.connection('reconnecting')
      this.startDeadline()
    })
    socket.on('connect_error', (error) => {
      if (!current()) return
      const code = (error as Error & { data?: { code?: ErrorCode } }).data?.code
      if (code === 'SESSION_ENDED' || code === 'UPDATE_REQUIRED' || code === 'REPLACED') this.end(code, false)
      else { this.connection('reconnecting'); this.startDeadline() }
    })
    socket.on('session:ended', (code) => { if (current()) this.end(code, false) })
    socket.on('room:presence', (presence) => {
      if (!current()) return
      if (this.syncing) this.bufferedPresence = presence
      else this.media.updatePresence(presence)
    })
    socket.on('chat:message', (message) => {
      if (!current()) return
      if (this.syncing) {
        if (this.bufferedMessages.length >= 500) socket.io.engine?.close()
        else this.bufferedMessages.push(message)
        return
      }
      if (this.state !== 'connected') return
      if (message.conversation !== this.conversation) return
      if (message.sequence > this.cursor + 1) { void this.synchronize(); return }
      this.cursor = Math.max(this.cursor, message.sequence)
      this.accept(message, true)
    })
    socket.on('chat:typing', (typing) => {
      if (!current() || this.state !== 'connected') return
      this.chat.setTyping(typing, this.credentials!.identity)
      clearTimeout(this.remoteTypingTimer)
      // Server expires typists too; local timeout covers a dropped volatile stop/expiry event.
      this.remoteTypingTimer = setTimeout(() => this.chat.setTyping([], this.credentials?.identity ?? ''), TYPING_MS)
    })
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.pageHide)
      window.addEventListener('pageshow', this.wake)
      window.addEventListener('online', this.wake)
      document.addEventListener('visibilitychange', this.pageHidden)
    }
    this.startDeadline()
    socket.connect()
    return joined
  }

  private async synchronize(): Promise<void> {
    const socket = this.socket
    if (!socket?.connected || this.syncing || !this.checkDeadline()) return
    this.syncing = true
    this.bufferedMessages = []; this.bufferedPresence = undefined
    this.chat.setReady(false)
    this.media.setSignalingAvailable(false)
    if (this.loaded) this.connection('reconnecting')
    const connection = this.connectionGeneration
    const generation = this.generation
    try {
      const result = await socket.timeout(ACK_MS).emitWithAck('session:sync', { conversation: this.conversation, after: this.cursor })
      if (!this.current(generation, connection)) return
      if (!result.ok) { this.end(result.code); return }
      this.applySync(result.value)
      this.lastHeartbeat = Date.now()
      if (this.bufferedPresence) this.media.updatePresence(this.bufferedPresence)
      for (const message of this.bufferedMessages) {
        if (message.conversation !== this.conversation) continue
        if (message.sequence > this.cursor + 1) throw new Error('Resynchronization required')
        this.cursor = Math.max(this.cursor, message.sequence)
        this.accept(message, false)
      }
      this.bufferedMessages = []; this.bufferedPresence = undefined
      this.deadline = 0; clearTimeout(this.recoveryTimer)
      this.syncing = false
      this.chat.setReady(true)
      this.media.setSignalingAvailable(true)
      this.connection('connected')
      this.joined?.resolve(); this.joined = undefined
      this.pump()
      this.scheduleRenewal()
    } catch {
      if (!this.current(generation, connection)) return
      this.syncing = false
      this.connection('reconnecting')
      this.startDeadline()
      // A transport can be connected without an operational namespace. Reconnect and re-authenticate.
      socket.io.engine?.close()
    }
  }

  private applySync(state: SyncState): void {
    this.serverClockOffset = state.serverTime - Date.now()
    const changed = this.chat.synchronize(state, this.credentials!.identity, !this.loaded)
    if (changed) {
      for (const outgoing of this.pending.values()) clearTimeout(outgoing.timer)
      this.pending.clear()
    } else {
      for (const message of state.messages) if (message.senderId === this.credentials!.identity) this.finishPending(message.id)
    }
    this.loaded = true
    this.conversation = state.conversation
    this.cursor = state.cursor
    this.nextSequence = changed ? state.nextClientSequence : Math.max(this.nextSequence, state.nextClientSequence)
    this.adoptCredentials(state.credentials)
    this.media.updatePresence(state.presence)
    if (state.typing.length) {
      clearTimeout(this.remoteTypingTimer)
      this.remoteTypingTimer = setTimeout(() => this.chat.setTyping([], this.credentials?.identity ?? ''), TYPING_MS)
    }
  }

  sendChat(content: string): boolean {
    if (!this.ready() || !validContent(content) || this.pending.size >= 20) return false
    const input: SendMessage = { id: crypto.randomUUID(), content, conversation: this.conversation, clientSequence: this.nextSequence++ }
    this.chat.pending({ ...input, type: 'text', senderId: this.credentials!.identity, senderName: this.name, sentAt: Date.now() })
    this.enqueueMessage(input)
    this.setTyping(false)
    return true
  }

  retryChat(id: string): void {
    const message = this.chat.snapshot.messages.find((item) => item.id === id && item.senderId === this.credentials?.identity)
    if (!this.ready() || !message || message.status !== 'failed' || message.conversation !== this.conversation || message.failure === 'MESSAGE_EXPIRED') return
    this.chat.status(id, 'pending')
    this.enqueueMessage({ id: message.id, content: message.content, conversation: message.conversation, clientSequence: message.clientSequence })
  }
  dismissDraft(id: string): void { this.chat.dismissDraft(id) }

  private enqueueMessage(input: SendMessage): void {
    const outgoing: Outgoing = { input, deadline: Date.now() + RETRY_MS, inFlight: false }
    outgoing.timer = setTimeout(() => {
      if (this.pending.get(input.id) !== outgoing) return
      this.pending.delete(input.id); this.chat.status(input.id, 'failed'); this.pump()
    }, RETRY_MS)
    this.pending.set(input.id, outgoing)
    this.pump()
  }

  private pump(): void {
    if (!this.ready()) return
    // Serialize the outbox so per-participant sequence numbers cannot overtake each other.
    const outgoing = this.pending.values().next().value as Outgoing | undefined
    if (!outgoing || outgoing.inFlight) return
    const { input } = outgoing
    if (Date.now() >= outgoing.deadline) {
      this.finishPending(input.id); this.chat.status(input.id, 'failed'); this.pump(); return
    }
    if (input.conversation !== this.conversation) { this.finishPending(input.id); return }
    outgoing.inFlight = true
    const generation = this.generation
    const connection = this.connectionGeneration
    this.socket!.timeout(Math.min(ACK_MS, outgoing.deadline - Date.now())).emit('chat:send', input, (error: Error | null, result: Result<Message>) => {
      if (!this.current(generation, connection) || this.pending.get(input.id) !== outgoing) return
      outgoing.inFlight = false
      if (error) { this.pump(); return }
      if (result.ok) { this.accept(result.value, false); this.finishPending(input.id) }
      else if (result.code === 'CONVERSATION_RESET') { void this.synchronize(); return }
      else { this.finishPending(input.id); this.chat.status(input.id, 'failed', result.code) }
      this.pump()
    })
  }

  private accept(message: Message, live: boolean): void {
    if (message.conversation !== this.conversation || !this.credentials) return
    this.chat.receive(message, this.credentials.identity, live)
    if (message.senderId === this.credentials.identity) this.finishPending(message.id)
    this.pump()
  }
  private finishPending(id: string): void { clearTimeout(this.pending.get(id)?.timer); this.pending.delete(id) }

  setChatOpen(open: boolean): void { this.chat.setOpen(open); if (!open) this.setTyping(false) }
  setTyping(active: boolean): void {
    clearTimeout(this.typingTimer)
    if (!this.ready()) { this.typing = false; return }
    if (!active || !this.typing || Date.now() - this.lastTyping >= 1000) {
      this.socket!.volatile.emit('chat:typing', { conversation: this.conversation, active })
      this.lastTyping = Date.now()
    }
    this.typing = active
    if (active) this.typingTimer = setTimeout(() => this.setTyping(false), TYPING_MS)
  }

  private scheduleRenewal(): void {
    clearTimeout(this.renewTimer)
    if (!this.credentials) return
    this.renewTimer = setTimeout(() => void this.renew(), Math.max(1000, this.credentials.expiresAt - (Date.now() + this.serverClockOffset) - RENEW_BEFORE_MS))
  }
  private async renew(): Promise<void> {
    if (!this.ready()) return // Reconnection sync provides the newest credentials and reschedules renewal.
    const generation = this.generation
    const connection = this.connectionGeneration
    try {
      const result = await this.socket!.timeout(ACK_MS).emitWithAck('session:renew')
      if (!this.current(generation, connection)) return
      if (!result.ok) { this.end(result.code); return }
      this.adoptCredentials(result.value)
      this.scheduleRenewal()
    } catch {
      if (this.current(generation, connection)) this.renewTimer = setTimeout(() => void this.renew(), ACK_MS)
    }
  }
  private adoptCredentials(credentials: Credentials): void {
    this.credentials = credentials
    this.media.updateCredentials(credentials)
    // If confirmation is lost, the next sync returns the same pending token. Old credentials stay valid until confirmation.
    this.socket?.volatile.timeout(ACK_MS).emit('session:confirm', credentials.participantToken, () => undefined)
  }

  private startDeadline(): void {
    if (this.deadline) return
    this.deadline = Date.now() + RECOVERY_MS
    this.recoveryTimer = setTimeout(() => this.checkDeadline(), RECOVERY_MS)
  }
  private checkDeadline(): boolean {
    if (this.deadline && Date.now() >= this.deadline) { this.end('SESSION_ENDED'); return false }
    return true
  }
  private current(generation: number, connection: number): boolean { return this.generation === generation && this.connectionGeneration === connection && Boolean(this.credentials) }
  private ready(): boolean { return this.state === 'connected' && !this.syncing && Boolean(this.socket?.connected && this.credentials) && this.checkDeadline() }
  private connection(state: State, message?: string): void { this.state = state; this.connectionListener(state, message) }
  private clearTyping(): void {
    clearTimeout(this.typingTimer); clearTimeout(this.remoteTypingTimer)
    this.typing = false; this.lastTyping = 0
  }

  private end(code: ErrorCode, notifyServer = code !== 'REPLACED'): void {
    const message = explanations[code] ?? explanations.SESSION_ENDED
    this.joined?.reject(new Error(message)); this.joined = undefined
    void this.disconnect(false, notifyServer, true)
    this.connection('disconnected', message)
  }

  async disconnect(unloading = false, notifyServer = true, recoverDrafts = false): Promise<void> {
    const credentials = this.credentials
    const socket = this.socket
    this.generation++; this.connectionGeneration++
    this.credentials = null; this.socket = null
    this.joined?.reject(new Error('Entrada cancelada.')); this.joined = undefined
    clearTimeout(this.recoveryTimer); clearTimeout(this.renewTimer); this.clearTyping()
    for (const outgoing of this.pending.values()) clearTimeout(outgoing.timer)
    this.pending.clear()
    this.deadline = 0; this.syncing = false; this.loaded = false; this.conversation = ''; this.cursor = 0; this.nextSequence = 1
    this.bufferedMessages = []; this.bufferedPresence = undefined
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.pageHide); window.removeEventListener('pageshow', this.wake)
      window.removeEventListener('online', this.wake); document.removeEventListener('visibilitychange', this.pageHidden)
    }
    if (notifyServer && socket?.connected) socket.volatile.emit('session:leave', () => undefined)
    if (this.heartbeatListener) socket?.io.off('ping', this.heartbeatListener)
    this.heartbeatListener = undefined
    socket?.removeAllListeners(); socket?.disconnect()
    const departure = notifyServer && credentials ? this.sendLeave(credentials, unloading) : Promise.resolve()
    this.chat.reset(recoverDrafts)
    this.connection('disconnected')
    await Promise.all([this.media.disconnect(), departure])
  }

  private sendLeave(credentials: Credentials, unloading: boolean): Promise<void> {
    let sent = false
    if (unloading && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try { sent = navigator.sendBeacon(`${serverUrl}/v1/leave/beacon`, credentials.participantToken) } catch { /* keepalive fallback */ }
    }
    if (sent) return Promise.resolve()
    return fetch(`${serverUrl}/v1/leave`, { method: 'POST', headers: { authorization: `Bearer ${credentials.participantToken}` },
      keepalive: true, signal: AbortSignal.timeout(ACK_MS) }).then(() => undefined).catch((error: unknown) => logClient('warn', 'room.leave.failed', { error }))
  }

  publishScreen(stream: MediaStream, resolution: CaptureResolution): Promise<void> {
    if (!this.ready()) { stream.getTracks().forEach((track) => track.stop()); return Promise.reject(new Error('Aguarde a conexão com a sala.')) }
    return this.media.publishScreen(stream, resolution)
  }
  unpublishScreen(): Promise<void> { return this.media.unpublishScreen() }
  publishMicrophone(track: MediaStreamTrack): Promise<void> {
    if (!this.ready()) { track.stop(); return Promise.reject(new Error('Aguarde a conexão com a sala.')) }
    return this.media.publishMicrophone(track)
  }
  unpublishMicrophone(): Promise<void> { return this.media.unpublishMicrophone() }
  pauseShare(key: string): Promise<void> { return this.media.pauseShare(key) }
  resumeShare(key: string): Promise<void> { return this.media.resumeShare(key) }
}
