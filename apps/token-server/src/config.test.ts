import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const requiredEnvironment = {
  NODE_ENV: 'production',
  LIVEKIT_URL: 'wss://livekit.example.com',
  LIVEKIT_API_KEY: 'api-key',
  LIVEKIT_API_SECRET: 'api-secret-with-at-least-thirty-two-characters',
}

describe('TURN configuration', () => {
  it('loads Cloudflare TURN when both credentials are configured', () => {
    const config = loadConfig({
      ...requiredEnvironment,
      CLOUDFLARE_TURN_KEY_ID: 'key-id',
      CLOUDFLARE_TURN_API_TOKEN: 'api-token',
      CLOUDFLARE_TURN_TTL_SECONDS: '3600',
    })

    expect(config.cloudflareTurn).toEqual({
      keyId: 'key-id',
      apiToken: 'api-token',
      ttlSeconds: 3600,
    })
  })

  it('allows local development without Cloudflare TURN', () => {
    expect(loadConfig(requiredEnvironment).cloudflareTurn).toBeUndefined()
  })

  it('rejects incomplete credentials', () => {
    expect(() => loadConfig({
      ...requiredEnvironment,
      CLOUDFLARE_TURN_KEY_ID: 'key-id',
    })).toThrow('must be configured together')
  })

  it('rejects a TTL above Cloudflare maximum', () => {
    expect(() => loadConfig({
      ...requiredEnvironment,
      CLOUDFLARE_TURN_KEY_ID: 'key-id',
      CLOUDFLARE_TURN_API_TOKEN: 'api-token',
      CLOUDFLARE_TURN_TTL_SECONDS: '172801',
    })).toThrow('must be between 1 and 172800')
  })
})
