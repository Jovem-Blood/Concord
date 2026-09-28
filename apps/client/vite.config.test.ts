import { describe, expect, it } from 'vitest'
import rendererConfig from './vite.renderer.config'
import webConfig from './vite.web.config'

describe('renderer asset policy', () => {
  it('keeps media as same-origin files allowed by the CSP', () => {
    expect(webConfig.build?.assetsInlineLimit).toBe(0)
    expect(rendererConfig.build?.assetsInlineLimit).toBe(0)
  })
})
