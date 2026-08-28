import { describe, expect, it, vi } from 'vitest'
import { createCloudflareTurnCredentialsProvider } from './turn.js'

const config = {
  keyId: 'turn-key-id',
  apiToken: 'turn-api-token',
  ttlSeconds: 7200,
}

describe('Cloudflare TURN credentials', () => {
  it('requests and validates temporary ICE servers without exposing the API token', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      iceServers: [
        { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
        {
          urls: [
            'turn:turn.cloudflare.com:3478?transport=udp',
            'turn:turn.cloudflare.com:53?transport=udp',
            'turns:turn.cloudflare.com:443?transport=tcp',
          ],
          username: 'temporary-user',
          credential: 'temporary-credential',
        },
      ],
    }), { status: 201, headers: { 'content-type': 'application/json' } }))
    const provider = createCloudflareTurnCredentialsProvider(config, fetcher as unknown as typeof fetch)

    await expect(provider()).resolves.toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      {
        urls: [
          'turn:turn.cloudflare.com:3478?transport=udp',
          'turns:turn.cloudflare.com:443?transport=tcp',
        ],
        username: 'temporary-user',
        credential: 'temporary-credential',
      },
    ])

    expect(fetcher).toHaveBeenCalledWith(
      'https://rtc.live.cloudflare.com/v1/turn/keys/turn-key-id/credentials/generate-ice-servers',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Bearer turn-api-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ttl: 7200 }),
      }),
    )
  })

  it('reports the status without including the Cloudflare response body', async () => {
    const fetcher = vi.fn(async () => new Response('sensitive provider response', { status: 401 }))
    const provider = createCloudflareTurnCredentialsProvider(config, fetcher as unknown as typeof fetch)

    await expect(provider()).rejects.toThrow('Cloudflare TURN credential request failed with status 401')
  })

  it('rejects responses without relay credentials', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
    }), { status: 201 }))
    const provider = createCloudflareTurnCredentialsProvider(config, fetcher as unknown as typeof fetch)

    await expect(provider()).rejects.toThrow('did not include relay credentials')
  })
})
