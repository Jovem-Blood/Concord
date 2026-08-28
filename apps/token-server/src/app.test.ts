import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import type { ServerConfig } from './config.js'

const config: ServerConfig = {
  host: '127.0.0.1',
  port: 0,
  livekitUrl: 'ws://localhost:7880',
  livekitApiKey: 'devkey',
  livekitApiSecret: 'secret',
  allowedOrigins: [],
}

const apps: Awaited<ReturnType<typeof buildApp>>[] = []
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())))

describe('POST /v1/join', () => {
  it('returns a token without exposing server secrets', async () => {
    const issuer = vi.fn().mockResolvedValue('signed.jwt.value')
    const app = await buildApp(config, issuer)
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/join',
      payload: { roomCode: 'ABCD2345', displayName: 'Thiago' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      serverUrl: 'ws://localhost:7880',
      participantToken: 'signed.jwt.value',
    })
    expect(response.body).not.toContain(config.livekitApiSecret)
    expect(issuer).toHaveBeenCalledWith({ roomCode: 'ABCD2345', displayName: 'Thiago' })
  })

  it('returns 400 for invalid input', async () => {
    const app = await buildApp(config, vi.fn())
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/join',
      payload: { roomCode: '1234', displayName: '' },
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns temporary TURN credentials when the provider is configured', async () => {
    const issuer = vi.fn().mockResolvedValue('signed.jwt.value')
    const turnProvider = vi.fn().mockResolvedValue([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: ['turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'temporary-user',
        credential: 'temporary-credential',
      },
    ])
    const app = await buildApp(config, issuer, turnProvider)
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/join',
      payload: { roomCode: 'ABCD2345', displayName: 'Thiago' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      serverUrl: 'ws://localhost:7880',
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
    expect(turnProvider).toHaveBeenCalledOnce()
  })

  it('does not issue a room response when TURN credential generation fails', async () => {
    const app = await buildApp(
      config,
      vi.fn().mockResolvedValue('signed.jwt.value'),
      vi.fn().mockRejectedValue(new Error('TURN unavailable')),
    )
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/join',
      payload: { roomCode: 'ABCD2345', displayName: 'Thiago' },
    })

    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      error: 'REQUEST_FAILED',
      message: 'The request could not be completed.',
    })
  })
})
