import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const requiredEnvironment = {
  NODE_ENV: 'production',
  CLOUDFLARE_SFU_APP_ID: 'app-id',
  CLOUDFLARE_SFU_APP_SECRET: 'app-secret',
}

describe('server configuration', () => {
  it('selects Cloudflare explicitly even when LiveKit credentials remain configured', () => {
    const config = loadConfig({ ...requiredEnvironment, MEDIA_PROVIDER: 'cloudflare', LIVEKIT_URL: 'unused' })
    expect(config.cloudflareSfu).toBeDefined()
    expect(config.livekit).toBeUndefined()
  })
  it('validates the selected provider and its required credentials', () => {
    expect(() => loadConfig({ ...requiredEnvironment, MEDIA_PROVIDER: 'invalid' })).toThrow('MEDIA_PROVIDER')
    expect(() => loadConfig({ ...requiredEnvironment, MEDIA_PROVIDER: 'livekit' })).toThrow('LIVEKIT_URL')
    expect(() => loadConfig({ MEDIA_PROVIDER: 'cloudflare', LIVEKIT_API_KEY: 'unused' })).toThrow('CLOUDFLARE_SFU')
  })
  it('requires SFU credentials even in development', () => {
    expect(() => loadConfig({})).toThrow('CLOUDFLARE_SFU_APP_ID')
    expect(() => loadConfig({ CLOUDFLARE_SFU_APP_ID: 'app' })).toThrow('CLOUDFLARE_SFU_APP_SECRET')
    expect(loadConfig(requiredEnvironment).cloudflareSfu).toEqual({ appId: 'app-id', appSecret: 'app-secret' })
  })
})
