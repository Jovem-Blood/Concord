import { afterEach, describe, expect, it, vi } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import { SOCKET_PATH, type ClientEvents, type ServerEvents } from '@concord/protocol'
import { buildApp } from './app.js'
import { RoomSession, type MediaService } from '../../client/src/renderer/services/room-session'
import type { ChatSnapshot } from '../../client/src/renderer/services/room-chat'

const apps: Awaited<ReturnType<typeof buildApp>>[] = []
const sessions: RoomSession[] = []
afterEach(async () => {
  for (const session of sessions.splice(0)) await session.disconnect()
  await Promise.all(apps.splice(0).map((app) => app.close()))
  vi.unstubAllGlobals()
})

async function fixture() {
  const app = await buildApp({ host: '127.0.0.1', port: 0, allowedOrigins: [], cloudflareSfu: { appId: 'test', appSecret: 'test' } },
    { createSession: vi.fn(), request: vi.fn() })
  apps.push(app)
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => realFetch(`${address}${new URL(input).pathname}`, init))
  async function participant(name: string) {
    const socket: Socket<ServerEvents, ClientEvents> = io(address, { path: SOCKET_PATH, transports: ['websocket'], autoConnect: false, forceNew: true, reconnection: false })
    const media: MediaService = {
      connect: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined), updateCredentials: vi.fn(), setSignalingAvailable: vi.fn(),
      updatePresence: vi.fn(), onConnection: vi.fn(), onSnapshot: vi.fn(), publishScreen: vi.fn(), unpublishScreen: vi.fn(),
      publishMicrophone: vi.fn(), unpublishMicrophone: vi.fn(), pauseShare: vi.fn(), resumeShare: vi.fn(),
    }
    const session = new RoomSession(media, () => socket)
    sessions.push(session)
    let chat!: ChatSnapshot
    let state = ''
    session.onChat((snapshot) => { chat = snapshot })
    session.onConnection((value) => { state = value })
    await session.join('ABCD2345', name)
    return { session, socket, media, chat: () => chat, state: () => state }
  }
  return { app, participant, address }
}

describe('real Socket.IO room sessions', () => {
  it('delivers immediately, restores history for late joiners, and exposes actual typing events', async () => {
    const { participant } = await fixture()
    const alice = await participant('Alice')
    const bob = await participant('Bob')
    expect(alice.socket.io.engine.transport.name).toBe('websocket')
    alice.session.sendChat('Hello Bob')
    await vi.waitFor(() => expect(bob.chat().messages[0]?.content).toBe('Hello Bob'))
    await vi.waitFor(() => expect(alice.chat().messages[0]?.status).toBe('sent'))
    expect(bob.chat()).toMatchObject({ unread: 1, notification: 1 })
    const carol = await participant('Carol')
    expect(carol.chat().messages).toHaveLength(1)
    expect(carol.chat()).toMatchObject({ unread: 0, notification: 0 })
    bob.session.setTyping(true)
    await vi.waitFor(() => expect(alice.chat().typing.map((item) => item.name)).toEqual(['Bob']))
    expect(bob.chat().typing).toEqual([])
    bob.session.setTyping(false)
    await vi.waitFor(() => expect(alice.chat().typing).toEqual([]))
  })

  it('recovers a transport drop without stopping media and catches up silently', async () => {
    const { participant } = await fixture()
    const alice = await participant('Alice')
    const bob = await participant('Bob')
    vi.mocked(bob.media.disconnect).mockClear()
    bob.socket.io.engine.close()
    await vi.waitFor(() => expect(bob.state()).toBe('reconnecting'))
    await vi.waitFor(() => expect(vi.mocked(alice.media.updatePresence).mock.calls.some(([presence]) =>
      presence.participants.some((member) => member.name === 'Bob' && member.connection === 'reconnecting'))).toBe(true))
    expect(bob.session.sendChat('Offline draft')).toBe(false)
    alice.session.sendChat('While you were away')
    await vi.waitFor(() => expect(alice.chat().messages[0]?.status).toBe('sent'))
    bob.socket.connect()
    await vi.waitFor(() => expect(bob.state()).toBe('connected'))
    expect(bob.chat().messages[0]?.content).toBe('While you were away')
    expect(bob.chat()).toMatchObject({ unread: 1, notification: 0 })
    expect(bob.media.disconnect).not.toHaveBeenCalled()
  })

  it('does not let the replaced client revoke its replacement session', async () => {
    const { participant, address } = await fixture()
    const alice = await participant('Alice')
    const credentials = vi.mocked(alice.media.updateCredentials).mock.calls[0]![0]
    const replacement: Socket<ServerEvents, ClientEvents> = io(address, { path: SOCKET_PATH, transports: ['websocket'], forceNew: true, reconnection: false,
      auth: { protocol: 2, token: credentials.participantToken } })
    try {
      await new Promise<void>((resolve, reject) => { replacement.once('connect', resolve); replacement.once('connect_error', reject) })
      await vi.waitFor(() => expect(alice.state()).toBe('disconnected'))
      const sync = await replacement.timeout(1500).emitWithAck('session:sync', { conversation: '', after: 0 })
      expect(sync.ok).toBe(true)
      expect(replacement.connected).toBe(true)
    } finally { replacement.disconnect() }
  })

  it('clears history on the last transport disconnect while recovering the same identity', async () => {
    const { participant, address } = await fixture()
    const alice = await participant('Alice')
    alice.session.sendChat('Temporary conversation')
    await vi.waitFor(() => expect(alice.chat().messages[0]?.status).toBe('sent'))
    const previous = alice.chat().conversation
    const credentials = vi.mocked(alice.media.updateCredentials).mock.calls[0]![0]
    alice.socket.io.engine.close()
    await vi.waitFor(async () => expect((await fetch(`${address}/v1/ice-servers`, {
      headers: { authorization: `Bearer ${credentials.participantToken}` },
    })).status).toBe(409))
    alice.socket.connect()
    await vi.waitFor(() => expect(alice.state()).toBe('connected'))
    expect(alice.chat().conversation).not.toBe(previous)
    expect(alice.chat().messages).toEqual([])
    const renewed = vi.mocked(alice.media.updateCredentials).mock.calls
    expect(renewed[renewed.length - 1]![0].identity).toBe(credentials.identity)
  })
})
