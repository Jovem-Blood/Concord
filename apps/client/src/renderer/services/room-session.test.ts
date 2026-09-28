import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACK_MS, RECOVERY_MS, RETRY_MS, type Credentials, type Message, type Result, type SendMessage, type SyncState } from '@concord/protocol'
import type { Socket } from 'socket.io-client'
import type { ClientEvents, ServerEvents } from '@concord/protocol'
import { RoomSession, type MediaService } from './room-session'
import type { ChatSnapshot } from './room-chat'

type SendAck = (error: Error | null, result: Result<Message>) => void
const credentials: Credentials = { participantToken: 'a'.repeat(43), identity: 'local', expiresAt: 9_000_000 }
function state(conversation = 'one', messages: Message[] = []): SyncState {
  return { conversation, messages, cursor: messages.length, presence: { participants: [], tracks: [] }, typing: [], credentials,
    serverTime: Date.now(), nextClientSequence: 1 }
}
function accepted(input: SendMessage, sequence = 1): Message {
  return { ...input, sequence, type: 'text', sentAt: Date.now(), senderId: 'local', senderName: 'Local' }
}

class FakeSocket {
  connected = false
  auth: unknown
  listeners = new Map<string, ((...args: unknown[]) => void)[]>()
  snapshot = state()
  sync = vi.fn(async () => this.snapshot)
  attempts: SendMessage[] = []
  typing: { active: boolean }[] = []
  send: (input: SendMessage, ack: SendAck) => void = (input, ack) => ack(null, { ok: true, value: accepted(input) })
  io = { engine: { close: () => this.drop() }, on: vi.fn(), off: vi.fn() }
  get volatile() { return this }
  on(event: string, callback: (...args: unknown[]) => void) { this.listeners.set(event, [...this.listeners.get(event) ?? [], callback]); return this }
  dispatch(event: string, ...args: unknown[]) { for (const callback of this.listeners.get(event) ?? []) callback(...args) }
  connect() { this.connected = true; this.dispatch('connect'); return this }
  disconnect() { this.connected = false; return this }
  drop() { this.connected = false; this.dispatch('disconnect', 'transport close') }
  removeAllListeners() { this.listeners.clear(); return this }
  emit(event: string, ...args: unknown[]) {
    if (event === 'chat:typing') this.typing.push(args[0] as { active: boolean })
    return this
  }
  timeout(ms: number) {
    return {
      emitWithAck: async (event: string) => ({ ok: true, value: event === 'session:sync' ? await this.sync() : this.snapshot.credentials }),
      emit: (event: string, input: unknown, callback: SendAck) => {
        if (event !== 'chat:send') return this
        this.attempts.push(input as SendMessage)
        const timer = setTimeout(() => callback(new Error('Ack timeout'), { ok: false, code: 'NOT_READY' }), ms)
        this.send(input as SendMessage, (error, result) => { clearTimeout(timer); callback(error, result) })
        return this
      },
    }
  }
}

const sessions: RoomSession[] = []
afterEach(async () => { for (const session of sessions.splice(0)) await session.disconnect(); vi.unstubAllGlobals(); vi.useRealTimers() })
function fixture() {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  const socket = new FakeSocket()
  const fetcher = vi.fn(async () => new Response(JSON.stringify(credentials)))
  vi.stubGlobal('fetch', fetcher)
  const media: MediaService = {
    connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined), updateCredentials: vi.fn(),
    setSignalingAvailable: vi.fn(), updatePresence: vi.fn(), onConnection: vi.fn(), onSnapshot: vi.fn(),
    publishScreen: vi.fn(async () => undefined), unpublishScreen: vi.fn(async () => undefined),
    publishMicrophone: vi.fn(async () => undefined), unpublishMicrophone: vi.fn(async () => undefined),
    pauseShare: vi.fn(async () => undefined), resumeShare: vi.fn(async () => undefined),
  }
  const session = new RoomSession(media, () => socket as unknown as Socket<ServerEvents, ClientEvents>)
  sessions.push(session)
  const snapshots: ChatSnapshot[] = []
  const connection = vi.fn()
  session.onChat((snapshot) => snapshots.push(snapshot))
  session.onConnection(connection)
  const chat = () => snapshots[snapshots.length - 1]!
  return { session, socket, media, fetcher, chat, connection, join: () => session.join('ABCD2345', 'Local') }
}

describe('RoomSession controller', () => {
  it('waits for state synchronization before enabling send and never queues offline composition', async () => {
    const { session, socket, join, chat } = fixture()
    let complete!: (value: SyncState) => void
    socket.sync.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const joining = join()
    await vi.advanceTimersByTimeAsync(0)
    expect(session.sendChat('Not yet')).toBe(false)
    complete(state())
    await joining
    expect(chat().ready).toBe(true)
    socket.drop()
    expect(session.sendChat('Offline draft')).toBe(false)
    socket.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.attempts).toEqual([])
    expect(chat().ready).toBe(true)
  })

  it('retries an uncertain send with the same id and marks it sent once acknowledged', async () => {
    const { session, socket, join, chat } = fixture()
    await join()
    let calls = 0
    socket.send = (input, ack) => { if (++calls > 1) ack(null, { ok: true, value: accepted(input) }) }
    expect(session.sendChat('Hello')).toBe(true)
    expect(chat().messages[0]!.status).toBe('pending')
    await vi.advanceTimersByTimeAsync(ACK_MS)
    expect(socket.attempts).toHaveLength(2)
    expect(socket.attempts[0]).toEqual(socket.attempts[1])
    expect(chat().messages).toHaveLength(1)
    expect(chat().messages[0]!.status).toBe('sent')
  })

  it('shows failure at the retry deadline and manual resend reuses the original id', async () => {
    const { session, socket, join, chat } = fixture()
    await join()
    socket.send = () => undefined
    session.sendChat('Hello')
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    const failed = chat().messages[0]!
    expect(failed.status).toBe('failed')
    socket.send = (input, ack) => ack(null, { ok: true, value: accepted(input) })
    session.retryChat(failed.id)
    expect(chat().messages[0]!.status).toBe('sent')
    expect(socket.attempts[socket.attempts.length - 1]!.id).toBe(failed.id)
  })

  it('keeps media during recovery, then terminates it and offers rejoin at the deadline', async () => {
    const { socket, join, media, connection } = fixture()
    await join()
    vi.mocked(media.disconnect).mockClear()
    socket.drop()
    expect(media.setSignalingAvailable).toHaveBeenLastCalledWith(false)
    expect(media.disconnect).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(RECOVERY_MS)
    expect(media.disconnect).toHaveBeenCalledOnce()
    expect(connection).toHaveBeenLastCalledWith('disconnected', expect.stringContaining('Entre novamente'))
    socket.connect()
    expect(media.disconnect).toHaveBeenCalledOnce()
  })

  it('recovers accepted messages silently without replaying the outbox, and clears deleted generations', async () => {
    const { session, socket, join, chat } = fixture()
    await join()
    socket.send = () => undefined
    session.sendChat('Uncertain')
    const input = socket.attempts[0]!
    socket.drop()
    socket.snapshot = state('one', [accepted(input)])
    socket.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.attempts).toHaveLength(1)
    expect(chat().messages[0]!.status).toBe('sent')
    expect(chat().notification).toBe(0)
    session.sendChat('Not accepted')
    socket.drop()
    socket.snapshot = state('two')
    socket.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(chat().messages).toEqual([])
    expect(chat().drafts[0]!.content).toBe('Not accepted')
    expect(socket.attempts).toHaveLength(2)
    socket.dispatch('chat:message', accepted(input))
    await vi.advanceTimersByTimeAsync(0)
    expect(chat().messages).toEqual([])
  })

  it('buffers messages arriving between the history snapshot and synchronization acknowledgement', async () => {
    const { socket, join, chat } = fixture()
    let complete!: (value: SyncState) => void
    socket.sync.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const joining = join()
    await vi.advanceTimersByTimeAsync(0)
    const message = { ...accepted({ id: 'remote', clientSequence: 1, content: 'During sync', conversation: 'one' }), senderId: 'remote' }
    socket.dispatch('chat:message', message)
    complete(state())
    await joining
    expect(chat().messages).toHaveLength(1)
    expect(chat().notification).toBe(0)
  })

  it('throttles typing, expires idle typing, and never replays it across a reconnect', async () => {
    const { session, socket, join } = fixture()
    await join()
    session.setTyping(true); session.setTyping(true)
    expect(socket.typing).toEqual([{ conversation: 'one', active: true }])
    await vi.advanceTimersByTimeAsync(1000)
    session.setTyping(true)
    expect(socket.typing).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(socket.typing[socket.typing.length - 1]!.active).toBe(false)
    socket.drop(); session.setTyping(true); socket.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(socket.typing).toHaveLength(3)
  })

  it('sends unload delivery immediately, stops media, and ignores late callbacks', async () => {
    const { session, socket, join, media, chat } = fixture()
    await join()
    let late!: SendAck
    socket.send = (_input, ack) => { late = ack }
    session.sendChat('Leaving')
    const sendBeacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { sendBeacon })
    const leaving = session.disconnect(true)
    expect(sendBeacon).toHaveBeenCalledWith(expect.stringContaining('/v1/leave/beacon'), credentials.participantToken)
    expect(media.disconnect).toHaveBeenCalled()
    late(null, { ok: true, value: accepted(socket.attempts[0]!) })
    await leaving
    expect(chat().messages).toEqual([])
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    expect(socket.attempts).toHaveLength(1)
  })

  it('treats an API restart or protocol rejection as terminal instead of silently rejoining', async () => {
    const { socket, join, connection, fetcher } = fixture()
    await join()
    socket.drop()
    socket.dispatch('connect_error', Object.assign(new Error('Expired'), { data: { code: 'SESSION_ENDED' } }))
    expect(connection).toHaveBeenLastCalledWith('disconnected', expect.stringContaining('Entre novamente'))
    expect(fetcher).toHaveBeenCalledTimes(1) // A terminal server rejection never creates a replacement session.
  })

  it('checks elapsed wall time on wake even when browser timers were suspended', async () => {
    const { join, media, connection } = fixture()
    const windowEvents = new EventTarget()
    vi.stubGlobal('window', windowEvents)
    vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }))
    await join()
    vi.mocked(media.disconnect).mockClear()
    vi.setSystemTime(Date.now() + 46_000)
    windowEvents.dispatchEvent(new Event('pageshow'))
    expect(media.disconnect).toHaveBeenCalledOnce()
    expect(connection).toHaveBeenLastCalledWith('disconnected', expect.stringContaining('Entre novamente'))
  })

  it('does not let an older join response replace a newer room session', async () => {
    const { session, socket, fetcher } = fixture()
    let complete!: (value: Response) => void
    fetcher.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const first = session.join('ABCD2345', 'First').catch((error: Error) => error)
    await vi.advanceTimersByTimeAsync(0)
    await session.join('WXYZ2345', 'Second')
    complete(new Response(JSON.stringify({ ...credentials, participantToken: 'b'.repeat(43) })))
    expect(await first).toBeInstanceOf(Error)
    expect(socket.connected).toBe(true)
    expect(session.sendChat('Still in second room')).toBe(true)
  })

  it('preserves uncertain local messages as draft recovery when the recovery deadline expires', async () => {
    const { session, socket, join, chat } = fixture()
    await join()
    socket.send = () => undefined
    session.sendChat('Keep my text')
    socket.drop()
    await vi.advanceTimersByTimeAsync(RECOVERY_MS)
    expect(chat().messages).toEqual([])
    expect(chat().drafts[0]?.content).toBe('Keep my text')
  })
})
