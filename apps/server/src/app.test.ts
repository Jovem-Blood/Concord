import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import type { ServerConfig } from './config.js'
import type { SfuClient, SfuTrack } from './sfu.js'
import { io, type Socket } from 'socket.io-client'
import { PROTOCOL_VERSION, SOCKET_PATH, type ClientEvents, type ServerEvents, type SyncState } from '@concord/protocol'

const config: ServerConfig = {
  host: '127.0.0.1', port: 0, cloudflareSfu: { appId: 'test-app', appSecret: 'private-secret' }, allowedOrigins: [],
}
const apps: Awaited<ReturnType<typeof buildApp>>[] = []
const sockets: Socket<ServerEvents, ClientEvents>[] = []
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect()
  vi.useRealTimers()
  await Promise.all(apps.splice(0).map((app) => app.close()))
})
async function fixture() {
  let sessionNumber = 0
  const sfu: SfuClient = {
    createSession: vi.fn(async () => ({ sessionId: `session-${++sessionNumber}` })),
    request: vi.fn(async (_session, operation, body) => {
      const tracks = (body as { tracks?: SfuTrack[] }).tracks
      const dataChannels = (body as { dataChannels?: { location: 'local' | 'remote'; sessionId?: string; dataChannelName: string }[] }).dataChannels
      return { tracks: tracks?.map((t, i) => ({ ...t, mid: t.mid ?? `remote-${i}` })),
        dataChannels: dataChannels?.map((channel, i) => ({ ...channel, id: i + 1 })),
        ...(operation === 'datachannels/establish' ? { dataChannel: { id: 0 }, sessionDescription: { type: 'answer' as const, sdp: 'answer-sdp' } } : {}),
        ...(operation === 'tracks/new' ? { sessionDescription: { type: 'answer' as const, sdp: 'answer-sdp' } } : {}) }
    }),
  }
  const app = await buildApp(config, sfu)
  apps.push(app)
  const url = await app.listen({ host: '127.0.0.1', port: 0 })
  const clients = new Map<string, Socket<ServerEvents, ClientEvents>>()
  async function room(headers: { authorization: string }) {
    const socket = clients.get(headers.authorization)!
    const result = await socket.timeout(1500).emitWithAck('session:sync', { conversation: '', after: 0 })
    if (!result.ok) throw new Error(result.code)
    return { json: () => result.value.presence, headers: { 'cache-control': 'no-store' } }
  }
  async function join(roomCode = 'ABCD2345', displayName = 'Thiago') {
    const response = await app.inject({ method: 'POST', url: '/v1/join', payload: { roomCode, displayName, protocol: PROTOCOL_VERSION } })
    expect(response.statusCode).toBe(200)
    const data = response.json()
    const socket: Socket<ServerEvents, ClientEvents> = io(url, { path: SOCKET_PATH, transports: ['websocket'], forceNew: true, reconnection: false,
      auth: { token: data.participantToken, protocol: PROTOCOL_VERSION } })
    sockets.push(socket)
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject) })
    const headers = { authorization: `Bearer ${data.participantToken}` }
    clients.set(headers.authorization, socket)
    await room(headers)
    return { data, headers, socket }
  }
  async function publish(headers: { authorization: string }) {
    const session = await app.inject({ method: 'POST', url: '/v1/session', headers })
    const response = await app.inject({ method: 'POST', url: '/v1/tracks', headers, payload: {
      sessionDescription: { type: 'offer', sdp: 'offer-sdp' },
      tracks: [{ location: 'local', mid: '0', trackName: 'screen', kind: 'video', source: 'screen-video' }],
    } })
    expect(response.statusCode).toBe(200)
    return session.json().sessionId as string
  }
  return { app, sfu, join, publish, room, url }
}

describe('Cloudflare room signaling', () => {
  it('shares bounded room history with late joiners and removes it only when the room empties', async () => {
    const { app, join } = await fixture()
    const alice = await join('ABCD2345', 'Alice')
    const sync = async (socket: Socket<ServerEvents, ClientEvents>, conversation = '', after = 0): Promise<SyncState> => {
      const result = await socket.timeout(1500).emitWithAck('session:sync', { conversation, after })
      if (!result.ok) throw new Error(result.code)
      return result.value
    }
    const initial = await sync(alice.socket)
    const send = () => alice.socket.timeout(1500).emitWithAck('chat:send', { id: 'first', content: 'Hello', conversation: initial.conversation, clientSequence: 1 })
    const sent = await send()
    expect(sent).toMatchObject({ ok: true, value: { senderId: alice.data.identity, senderName: 'Alice', sequence: 1 } })
    expect(await send()).toEqual(sent)
    const bob = await join('ABCD2345', 'Bob')
    const other = await join('WXYZ2345', 'Other')
    expect((await sync(bob.socket)).messages).toHaveLength(1)
    expect((await sync(bob.socket, initial.conversation, 1)).messages).toEqual([])
    expect((await sync(other.socket)).messages).toEqual([])
    await app.inject({ method: 'POST', url: '/v1/leave', headers: alice.headers })
    const returning = await join()
    expect((await sync(returning.socket)).messages).toHaveLength(1)
    await app.inject({ method: 'POST', url: '/v1/leave', headers: returning.headers })
    await app.inject({ method: 'POST', url: '/v1/leave/beacon', headers: { 'content-type': 'text/plain' }, payload: bob.data.participantToken })
    const fresh = await join()
    const reset = await sync(fresh.socket)
    expect(reset.messages).toEqual([])
    expect(reset.conversation).not.toBe(initial.conversation)
  })

  it('rejects old clients and retired polling/datachannel APIs with an update response', async () => {
    const { app } = await fixture()
    expect((await app.inject({ method: 'POST', url: '/v1/join', payload: { roomCode: 'ABCD2345', displayName: 'Old' } })).statusCode).toBe(426)
    for (const url of ['/v1/room', '/v1/chat/messages', '/v1/chat/establish', '/v1/chat/channels']) {
      expect((await app.inject({ method: 'POST', url })).statusCode).toBe(426)
    }
  })

  it('accepts unload beacons and immediately removes presence and credentials', async () => {
    const { app, join, publish, room: getRoom } = await fixture()
    const departing = await join()
    const viewer = await join()
    await publish(departing.headers)
    const response = await app.inject({ method: 'POST', url: '/v1/leave/beacon', headers: { 'content-type': 'text/plain;charset=UTF-8' }, payload: departing.data.participantToken })
    expect(response.statusCode).toBe(200)
    const room = await getRoom(viewer.headers)
    expect(room.json().participants.map((p: { identity: string }) => p.identity)).toEqual([viewer.data.identity])
    expect(room.json().tracks).toEqual([])
    expect((await app.inject({ method: 'GET', url: '/v1/ice-servers', headers: departing.headers })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/v1/leave/beacon', headers: { 'content-type': 'text/plain' }, payload: 'forged' })).statusCode).toBe(401)
  })

  it('allows leaving during an in-flight SFU operation and cleans up its eventual session', async () => {
    const { app, sfu, join, room: getRoom } = await fixture()
    const departing = await join()
    const viewer = await join()
    let complete!: (value: { sessionId: string }) => void
    let started!: () => void
    const pending = new Promise<void>((resolve) => { started = resolve })
    vi.mocked(sfu.createSession).mockImplementationOnce(() => {
      started()
      return new Promise((resolve) => { complete = resolve })
    })
    const operation = app.inject({ method: 'POST', url: '/v1/session', headers: departing.headers }).then((response) => response)
    await pending
    expect((await app.inject({ method: 'POST', url: '/v1/leave', headers: departing.headers })).statusCode).toBe(200)
    const room = await getRoom(viewer.headers)
    expect(room.json().participants).toHaveLength(1)
    complete({ sessionId: 'late-session' })
    await operation
    expect((await app.inject({ method: 'GET', url: '/v1/ice-servers', headers: departing.headers })).statusCode).toBe(401)
  })

  it('accepts bounded anonymous client diagnostics without storing arbitrary content', async () => {
    const { app } = await fixture()
    const payload = { level: 'warn', event: 'room.reconnecting', clientId: '12345678-1234-1234-1234-123456789abc',
      platform: 'web', reason: 'NetworkError', attempt: 2 }
    expect((await app.inject({ method: 'POST', url: '/v1/client-events', payload })).statusCode).toBe(204)
    expect((await app.inject({ method: 'POST', url: '/v1/client-events', payload: { ...payload, reason: 'Bearer secret' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/v1/client-events', payload: { ...payload, level: 'fatal' } })).statusCode).toBe(400)
  })

  it('issues opaque credentials and presence without creating idle SFU sessions', async () => {
    const { sfu, join, room: getRoom } = await fixture()
    const { data, headers } = await join()
    expect(data).toMatchObject({ identity: expect.any(String), participantToken: expect.any(String) })
    expect(JSON.stringify(data)).not.toContain('private-secret')
    expect(data.expiresAt).toBeGreaterThan(Date.now())
    expect(sfu.createSession).not.toHaveBeenCalled()
    const room = await getRoom(headers)
    expect(room.json().participants).toEqual([{ identity: data.identity, name: 'Thiago', connection: 'connected', voice: { available: false } }])
    expect(room.headers['cache-control']).toBe('no-store')
  })

  it('rejects invalid input and unauthorized signaling before touching the SFU', async () => {
    const { app, sfu } = await fixture()
    expect((await app.inject({ method: 'POST', url: '/v1/join', payload: { roomCode: '1234', displayName: '', protocol: PROTOCOL_VERSION } })).statusCode).toBe(400)
    for (const url of ['/v1/session', '/v1/tracks', '/v1/renegotiate', '/v1/tracks/close', '/v1/leave']) {
      expect((await app.inject({ method: 'POST', url, headers: { authorization: 'Bearer forged' } })).statusCode).toBe(401)
    }
    expect(sfu.request).not.toHaveBeenCalled()
  })

  it('isolates participants and subscriptions between rooms', async () => {
    const { app, join, publish, sfu, room: getRoom } = await fixture()
    const a = await join()
    const b = await join('WXYZ2345', 'B')
    const sessionId = await publish(a.headers)
    const room = await getRoom(b.headers)
    expect(room.json().participants).toHaveLength(1)
    expect(room.json().tracks).toEqual([])
    await app.inject({ method: 'POST', url: '/v1/session', headers: b.headers })
    const calls = vi.mocked(sfu.request).mock.calls.length
    const pull = await app.inject({ method: 'POST', url: '/v1/tracks', headers: b.headers, payload: { tracks: [{ location: 'remote', sessionId, trackName: 'screen' }] } })
    expect(pull.statusCode).toBe(403)
    expect(vi.mocked(sfu.request).mock.calls).toHaveLength(calls)
  })

  it('allows only published tracks from the same room and binds operations to the caller session', async () => {
    const { app, join, publish, sfu } = await fixture()
    const a = await join()
    const b = await join('ABCD2345', 'B')
    const sessionId = await publish(a.headers)
    await app.inject({ method: 'POST', url: '/v1/session', headers: b.headers })
    const response = await app.inject({ method: 'POST', url: '/v1/tracks', headers: b.headers, payload: {
      sessionId, autoDiscover: true, tracks: [{ location: 'remote', sessionId, trackName: 'screen' }],
    } })
    expect(response.statusCode).toBe(200)
    expect(sfu.request).toHaveBeenLastCalledWith('session-2', 'tracks/new', {
      tracks: [{ location: 'remote', sessionId, trackName: 'screen', kind: 'video' }],
    })
    const unknown = await app.inject({ method: 'POST', url: '/v1/tracks', headers: b.headers, payload: {
      tracks: [{ location: 'remote', sessionId, trackName: 'unpublished' }],
    } })
    expect(unknown.statusCode).toBe(403)
  })

  it('closes only caller-owned mids, withdraws publications and revokes leave tokens', async () => {
    const { app, join, publish, sfu, room } = await fixture()
    const a = await join()
    await publish(a.headers)
    expect((await app.inject({ method: 'POST', url: '/v1/tracks/close', headers: a.headers, payload: { mids: ['unknown'] } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/v1/tracks/close', headers: a.headers, payload: { mids: ['0'] } })).statusCode).toBe(200)
    expect(sfu.request).toHaveBeenLastCalledWith('session-1', 'tracks/close', { tracks: [{ mid: '0' }], force: true })
    expect((await room(a.headers)).json().tracks).toEqual([])
    await app.inject({ method: 'POST', url: '/v1/leave', headers: a.headers })
    expect((await app.inject({ method: 'GET', url: '/v1/ice-servers', headers: a.headers })).statusCode).toBe(401)
  })

  it('does not advertise per-track failures returned with HTTP 200', async () => {
    const { app, join, sfu, room } = await fixture()
    const a = await join()
    await app.inject({ method: 'POST', url: '/v1/session', headers: a.headers })
    vi.mocked(sfu.request).mockResolvedValueOnce({ tracks: [{ mid: '0', trackName: 'screen', errorCode: 'track_error' }] })
    await app.inject({ method: 'POST', url: '/v1/tracks', headers: a.headers, payload: {
      sessionDescription: { type: 'offer', sdp: 'sdp' }, tracks: [{ location: 'local', mid: '0', trackName: 'screen', kind: 'video', source: 'screen-video' }],
    } })
    expect((await room(a.headers)).json().tracks).toEqual([])
  })

  it('resets a media session and removes stale publications during recovery', async () => {
    const { app, join, publish, sfu, room } = await fixture()
    const a = await join()
    await publish(a.headers)
    const result = await app.inject({ method: 'POST', url: '/v1/session', headers: a.headers })
    expect(result.json().sessionId).toBe('session-2')
    expect(sfu.request).toHaveBeenCalledWith('session-1', 'tracks/close', { tracks: [{ mid: '0' }], force: true })
    expect((await room(a.headers)).json().tracks).toEqual([])
  })

  it('rejects expired credentials even when a transport remains open', async () => {
    const { app, join } = await fixture()
    const a = await join()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(a.data.expiresAt + 1)
    expect((await app.inject({ method: 'GET', url: '/v1/ice-servers', headers: a.headers })).statusCode).toBe(401)
  })

  it('validates media source compatibility and permits microphone with screen audio', async () => {
    const { app, join, room } = await fixture()
    const a = await join()
    await app.inject({ method: 'POST', url: '/v1/session', headers: a.headers })
    const publish = (tracks: unknown[]) => app.inject({ method: 'POST', url: '/v1/tracks', headers: a.headers, payload: {
      sessionDescription: { type: 'offer', sdp: 'offer-sdp' }, tracks,
    } })
    expect((await publish([{ location: 'local', mid: '0', trackName: 'bad', kind: 'video', source: 'microphone' }])).statusCode).toBe(400)
    const ok = await publish([
      { location: 'local', mid: '0', trackName: 'voice', kind: 'audio', source: 'microphone' },
      { location: 'local', mid: '1', trackName: 'screen', kind: 'video', source: 'screen-video' },
      { location: 'local', mid: '2', trackName: 'system', kind: 'audio', source: 'screen-audio' },
    ])
    expect(ok.statusCode).toBe(200)
    expect((await room(a.headers)).json()).toMatchObject({
      participants: [{ voice: { available: true } }],
      tracks: expect.arrayContaining([expect.objectContaining({ source: 'microphone' }), expect.objectContaining({ source: 'screen-audio' })]),
    })
    expect((await publish([{ location: 'local', mid: '3', trackName: 'voice-2', kind: 'audio', source: 'microphone' }])).statusCode).toBe(400)
  })

  it('serializes concurrent session mutations', async () => {
    const { app, join, sfu } = await fixture()
    const a = await join()
    let release!: (value: { sessionId: string }) => void
    vi.mocked(sfu.createSession).mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const first = app.inject({ method: 'POST', url: '/v1/session', headers: a.headers })
    const pending = first.then((response) => response.statusCode)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    expect((await app.inject({ method: 'POST', url: '/v1/session', headers: a.headers })).statusCode).toBe(409)
    release({ sessionId: 'session-delayed' })
    expect(await pending).toBe(200)
  })
})
