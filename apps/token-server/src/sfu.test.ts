import { describe, expect, it, vi } from 'vitest'
import { createSfuClient } from './sfu.js'

describe('Cloudflare SFU transport', () => {
  it('keeps authentication server-side and uses the documented HTTP methods', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessionId: 'session-id' }), { status: 201 }))
    const sfu = createSfuClient({ appId: 'app-id', appSecret: 'private-secret' }, fetcher)
    await sfu.createSession()
    expect(fetcher).toHaveBeenLastCalledWith('https://rtc.live.cloudflare.com/v1/apps/app-id/sessions/new', expect.objectContaining({
      method: 'POST', headers: { authorization: 'Bearer private-secret', 'content-type': 'application/json' },
    }))
    for (const operation of ['tracks/new', 'renegotiate', 'tracks/close'] as const) {
      await sfu.request('session/id', operation, { tracks: [] })
      expect(fetcher).toHaveBeenLastCalledWith(`https://rtc.live.cloudflare.com/v1/apps/app-id/sessions/session%2Fid/${operation}`, expect.objectContaining({
        method: operation === 'tracks/new' ? 'POST' : 'PUT', body: '{"tracks":[]}',
      }))
    }
  })

  it('rejects API and HTTP failures without exposing response bodies', async () => {
    for (const response of [new Response('sensitive-upstream-body', { status: 503 }), new Response('{"errorCode":"session_error","errorDescription":"sensitive-upstream-body"}')]) {
      const sfu = createSfuClient({ appId: 'app', appSecret: 'private-secret' }, vi.fn(async () => response))
      await expect(sfu.createSession()).rejects.toThrow(/Cloudflare SFU/)
    }
  })
})
