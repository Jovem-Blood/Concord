import { afterEach, expect, it, vi } from 'vitest'
import { TokenVerifier } from 'livekit-server-sdk'
import { PROTOCOL_VERSION } from '@concord/protocol'
import { createLiveKit } from './livekit.js'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = { url: 'wss://test.livekit.cloud', apiKey: 'test-key', apiSecret: 'test-secret-at-least-thirty-two-characters' }
const apps: Awaited<ReturnType<typeof buildApp>>[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })

it('issues a short-lived token limited to the server-selected room, identity and media sources', async () => {
  const gateway = createLiveKit(config)
  const result = await gateway.token('ABCD2345', 'identity', 'Alice')
  const decoded = await new TokenVerifier(config.apiKey, config.apiSecret).verify(result.token)
  expect(result.url).toBe(config.url)
  expect(decoded.sub).toBe('identity')
  expect(decoded.name).toBe('Alice')
  expect(decoded.video).toMatchObject({ room: 'concord-ABCD2345', roomJoin: true, canPublish: true,
    canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false,
    canPublishSources: ['microphone', 'screen_share', 'screen_share_audio'] })
  expect(decoded.exp! - decoded.nbf!).toBeLessThanOrEqual(600)
})

it('requires Concord authorization and ignores caller-supplied LiveKit identity/room', async () => {
  const gateway = { token: vi.fn(async () => ({ url: config.url, token: 'scoped-jwt' })), remove: vi.fn(async () => undefined) }
  const app = await buildApp({ host: '127.0.0.1', port: 0, allowedOrigins: [], livekit: config }, undefined, undefined, gateway)
  apps.push(app)
  expect((await app.inject({ method: 'POST', url: '/v1/livekit/token' })).statusCode).toBe(401)
  const joined = (await app.inject({ method: 'POST', url: '/v1/join', payload: {
    protocol: PROTOCOL_VERSION, roomCode: 'ABCD2345', displayName: 'Alice',
  } })).json()
  const headers = { authorization: `Bearer ${joined.participantToken}` }
  const result = await app.inject({ method: 'POST', url: '/v1/livekit/token', headers, payload: { roomCode: 'OTHER234', identity: 'someone-else' } })
  expect(result.statusCode).toBe(200)
  expect(result.headers['cache-control']).toBe('no-store')
  expect(gateway.token).toHaveBeenCalledWith('ABCD2345', joined.identity, 'Alice')
  expect((await app.inject('/health')).json().mediaProvider).toBe('livekit')
  await app.inject({ method: 'POST', url: '/v1/leave', headers })
  expect(gateway.remove).toHaveBeenCalledWith('ABCD2345', joined.identity)
  expect((await app.inject({ method: 'POST', url: '/v1/livekit/token', headers })).statusCode).toBe(401)
})

it('starts with LiveKit credentials alone and rejects incomplete configuration', () => {
  const environment = { LIVEKIT_URL: config.url, LIVEKIT_API_KEY: config.apiKey, LIVEKIT_API_SECRET: config.apiSecret }
  expect(loadConfig(environment).livekit).toEqual(config)
  expect(loadConfig(environment).cloudflareSfu).toBeUndefined()
  expect(() => loadConfig({ LIVEKIT_URL: config.url })).toThrow('required together')
  expect(() => loadConfig({ ...environment, LIVEKIT_URL: 'https://test.livekit.cloud' })).toThrow('ws://')
})
