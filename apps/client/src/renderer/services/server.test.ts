import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestJoinToken } from './server'

afterEach(() => vi.unstubAllGlobals())

describe('requestJoinToken', () => {
  it('accepts room credentials from the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      identity: 'participant-id',
      expiresAt: 4102444800000,
      participantToken: 'signed.jwt.value',
    }), { status: 200 })))

    await expect(requestJoinToken('ABCD2345', 'Thiago')).resolves.toMatchObject({
      identity: 'participant-id',
      expiresAt: 4102444800000,
      participantToken: 'signed.jwt.value',
    })
  })

  it('does not reject server credentials using the unsynchronized client clock', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      identity: 'participant-id',
      expiresAt: 1,
      participantToken: 'signed.jwt.value',
    }), { status: 200 })))

    await expect(requestJoinToken('ABCD2345', 'Thiago')).resolves.toMatchObject({ expiresAt: 1 })
  })

  it('rejects malformed room credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      identity: 'participant-id',
      expiresAt: 0,
      participantToken: 'signed.jwt.value',
    }), { status: 200 })))

    await expect(requestJoinToken('ABCD2345', 'Thiago')).rejects.toMatchObject({
      code: 'ROOM_TOKEN_FAILED',
    })
  })
})
