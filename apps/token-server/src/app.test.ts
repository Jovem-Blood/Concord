import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import type { ServerConfig } from './config.js'
import type { SfuClient, SfuTrack } from './sfu.js'

const config: ServerConfig = {
  host: '127.0.0.1', port: 0, cloudflareSfu: { appId: 'test-app', appSecret: 'private-secret' }, allowedOrigins: [],
}
const apps: Awaited<ReturnType<typeof buildApp>>[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(apps.splice(0).map((app) => app.close()))
})
async function fixture(turn?: () => Promise<{ urls: string[] }[]>) {
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
  const app = await buildApp(config, sfu, turn)
  apps.push(app)
  async function join(roomCode = 'ABCD2345', displayName = 'Thiago') {
    const response = await app.inject({ method: 'POST', url: '/v1/join', payload: { roomCode, displayName } })
    expect(response.statusCode).toBe(200)
    const data = response.json()
    return { data, headers: { authorization: `Bearer ${data.participantToken}` } }
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
  return { app, sfu, join, publish }
}

describe('Cloudflare room signaling', () => {
  it('issues opaque credentials, STUN and presence without creating idle SFU sessions', async () => {
    const { app, sfu, join } = await fixture()
    const { data, headers } = await join()
    expect(data).toMatchObject({ identity: expect.any(String), participantToken: expect.any(String), iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] })
    expect(JSON.stringify(data)).not.toContain('private-secret')
    expect(data.expiresAt).toBeGreaterThan(Date.now())
    expect(sfu.createSession).not.toHaveBeenCalled()
    const room = await app.inject({ method: 'GET', url: '/v1/room', headers })
    expect(room.json().participants).toEqual([{ identity: data.identity, name: 'Thiago', voice: { available: false } }])
    expect(room.headers['cache-control']).toBe('no-store')
  })

  it('rejects invalid input and unauthorized signaling before touching the SFU', async () => {
    const { app, sfu } = await fixture()
    expect((await app.inject({ method: 'POST', url: '/v1/join', payload: { roomCode: '1234', displayName: '' } })).statusCode).toBe(400)
    for (const url of ['/v1/session', '/v1/tracks', '/v1/renegotiate', '/v1/tracks/close', '/v1/leave']) {
      expect((await app.inject({ method: 'POST', url, headers: { authorization: 'Bearer forged' } })).statusCode).toBe(401)
    }
    expect(sfu.request).not.toHaveBeenCalled()
  })

  it('generates TURN credentials without exposing the permanent token', async () => {
    const turn = vi.fn(async () => [{ urls: ['turns:turn.cloudflare.com:443'], username: 'temporary', credential: 'temporary-secret' }])
    const { join } = await fixture(turn)
    const { data } = await join()
    expect(data.iceServers[0].credential).toBe('temporary-secret')
    expect(turn).toHaveBeenCalledOnce()
  })

  it('fails closed when TURN is unavailable', async () => {
    const { app } = await fixture(vi.fn().mockRejectedValue(new Error('private upstream details')))
    const result = await app.inject({ method: 'POST', url: '/v1/join', payload: { roomCode: 'ABCD2345', displayName: 'A' } })
    expect(result.statusCode).toBe(500)
    expect(result.body).not.toContain('private upstream details')
  })

  it('isolates participants and subscriptions between rooms', async () => {
    const { app, join, publish, sfu } = await fixture()
    const a = await join()
    const b = await join('WXYZ2345', 'B')
    const sessionId = await publish(a.headers)
    const room = await app.inject({ method: 'GET', url: '/v1/room', headers: b.headers })
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
    const { app, join, publish, sfu } = await fixture()
    const a = await join()
    await publish(a.headers)
    expect((await app.inject({ method: 'POST', url: '/v1/tracks/close', headers: a.headers, payload: { mids: ['unknown'] } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/v1/tracks/close', headers: a.headers, payload: { mids: ['0'] } })).statusCode).toBe(200)
    expect(sfu.request).toHaveBeenLastCalledWith('session-1', 'tracks/close', { tracks: [{ mid: '0' }], force: true })
    expect((await app.inject({ method: 'GET', url: '/v1/room', headers: a.headers })).json().tracks).toEqual([])
    await app.inject({ method: 'POST', url: '/v1/leave', headers: a.headers })
    expect((await app.inject({ method: 'GET', url: '/v1/room', headers: a.headers })).statusCode).toBe(401)
  })

  it('does not advertise per-track failures returned with HTTP 200', async () => {
    const { app, join, sfu } = await fixture()
    const a = await join()
    await app.inject({ method: 'POST', url: '/v1/session', headers: a.headers })
    vi.mocked(sfu.request).mockResolvedValueOnce({ tracks: [{ mid: '0', trackName: 'screen', errorCode: 'track_error' }] })
    await app.inject({ method: 'POST', url: '/v1/tracks', headers: a.headers, payload: {
      sessionDescription: { type: 'offer', sdp: 'sdp' }, tracks: [{ location: 'local', mid: '0', trackName: 'screen', kind: 'video', source: 'screen-video' }],
    } })
    expect((await app.inject({ method: 'GET', url: '/v1/room', headers: a.headers })).json().tracks).toEqual([])
  })

  it('resets a media session and removes stale publications during recovery', async () => {
    const { app, join, publish, sfu } = await fixture()
    const a = await join()
    await publish(a.headers)
    const result = await app.inject({ method: 'POST', url: '/v1/session', headers: a.headers })
    expect(result.json().sessionId).toBe('session-2')
    expect(sfu.request).toHaveBeenCalledWith('session-1', 'tracks/close', { tracks: [{ mid: '0' }], force: true })
    expect((await app.inject({ method: 'GET', url: '/v1/room', headers: a.headers })).json().tracks).toEqual([])
  })

  it('expires inactive presence and absolute token lifetime even with heartbeats', async () => {
    const { app, join } = await fixture()
    const a = await join()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 121_000)
    expect((await app.inject({ method: 'GET', url: '/v1/room', headers: a.headers })).statusCode).toBe(401)
    const b = await join()
    vi.setSystemTime(b.data.expiresAt + 1)
    expect((await app.inject({ method: 'GET', url: '/v1/room', headers: b.headers })).statusCode).toBe(401)
  })

  it('allows regular presence polling beyond the join rate limit', async () => {
    const { app, join } = await fixture()
    const { headers } = await join()
    for (let i = 0; i < 65; i++) expect((await app.inject({ method: 'GET', url: '/v1/room', headers })).statusCode).toBe(200)
  })

  it('validates media source compatibility and permits microphone with screen audio', async () => {
    const { app, join } = await fixture()
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
    expect((await app.inject({ method: 'GET', url: '/v1/room', headers: a.headers })).json()).toMatchObject({
      participants: [{ voice: { available: true } }],
      tracks: expect.arrayContaining([expect.objectContaining({ source: 'microphone' }), expect.objectContaining({ source: 'screen-audio' })]),
    })
    expect((await publish([{ location: 'local', mid: '3', trackName: 'voice-2', kind: 'audio', source: 'microphone' }])).statusCode).toBe(400)
  })

  it('authorizes room-scoped chat channels and never accepts message content', async () => {
    const { app, join, sfu } = await fixture()
    const alice = await join('ABCD2345', 'Alice')
    const bob = await join('ABCD2345', 'Bob')
    const outsider = await join('WXYZ2345', 'Outsider')
    for (const user of [alice, bob, outsider]) {
      await app.inject({ method: 'POST', url: '/v1/session', headers: user.headers })
      expect((await app.inject({ method: 'POST', url: '/v1/chat/establish', headers: user.headers, payload: {
        sessionDescription: { type: 'offer', sdp: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel' },
      } })).statusCode).toBe(200)
    }
    expect((await app.inject({ method: 'POST', url: '/v1/chat/channels', headers: alice.headers, payload: {
      location: 'local', dataChannelName: 'forged', content: '<b>secret</b>', participantIdentity: 'forged',
    } })).statusCode).toBe(200)
    const aliceSession = (await app.inject({ method: 'GET', url: '/v1/room', headers: bob.headers })).json().channels[0].sessionId
    expect((await app.inject({ method: 'POST', url: '/v1/chat/channels', headers: bob.headers,
      payload: { location: 'remote', sessionId: aliceSession, canReply: true } })).statusCode).toBe(200)
    expect(sfu.request).toHaveBeenLastCalledWith('session-2', 'datachannels/new', { dataChannels: [{
      location: 'remote', dataChannelName: 'concord-chat', ordered: true, sessionId: aliceSession, waitForAck: true, canReply: false,
    }] })
    expect((await app.inject({ method: 'POST', url: '/v1/chat/channels', headers: outsider.headers,
      payload: { location: 'remote', sessionId: aliceSession } })).statusCode).toBe(403)
    expect(JSON.stringify((await app.inject({ method: 'GET', url: '/v1/room', headers: bob.headers })).json())).not.toContain('secret')
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
