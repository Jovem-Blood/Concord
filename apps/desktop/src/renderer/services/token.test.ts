import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestJoinToken } from './token'

afterEach(() => vi.unstubAllGlobals())

describe('requestJoinToken', () => {
  it('accepts temporary ICE servers from the token server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      serverUrl: 'wss://livekit.example.com',
      participantToken: 'signed.jwt.value',
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        {
          urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
          username: 'temporary-user',
          credential: 'temporary-credential',
        },
      ],
    }), { status: 200 })))

    await expect(requestJoinToken('ABCD2345', 'Thiago')).resolves.toEqual({
      serverUrl: 'wss://livekit.example.com',
      participantToken: 'signed.jwt.value',
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478'] },
        {
          urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
          username: 'temporary-user',
          credential: 'temporary-credential',
        },
      ],
    })
  })

  it('rejects malformed ICE server data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      serverUrl: 'wss://livekit.example.com',
      participantToken: 'signed.jwt.value',
      iceServers: [{ urls: [42] }],
    }), { status: 200 })))

    await expect(requestJoinToken('ABCD2345', 'Thiago')).rejects.toMatchObject({
      code: 'ROOM_TOKEN_FAILED',
    })
  })
})
