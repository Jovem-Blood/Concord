import { describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'

const requiredEnvironment = {
  NODE_ENV: 'production',
  CLOUDFLARE_SFU_APP_ID: 'app-id',
  CLOUDFLARE_SFU_APP_SECRET: 'app-secret',
}

describe('server configuration', () => {
  it('requires SFU credentials even in development', () => {
    expect(() => loadConfig({})).toThrow('CLOUDFLARE_SFU_APP_ID')
    expect(() => loadConfig({ CLOUDFLARE_SFU_APP_ID: 'app' })).toThrow('CLOUDFLARE_SFU_APP_SECRET')
    expect(loadConfig(requiredEnvironment).cloudflareSfu).toEqual({ appId: 'app-id', appSecret: 'app-secret' })
  })
})
