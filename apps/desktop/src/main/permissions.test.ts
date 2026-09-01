import { describe, expect, it } from 'vitest'
import { microphonePermission, trustedRendererUrl } from './permissions'
describe('desktop microphone permission', () => {
  const renderer = 'file:///C:/Concord/app/index.html'
  it('accepts only the exact renderer main frame and audio-only requests', () => {
    expect(trustedRendererUrl(renderer, renderer)).toBe(true)
    expect(trustedRendererUrl('file:///C:/Concord/app/index.html.evil', renderer)).toBe(false)
    expect(microphonePermission('media', true, renderer, renderer, ['audio'])).toBe(true)
    expect(microphonePermission('media', true, renderer, renderer, ['audio', 'video'])).toBe(false)
    expect(microphonePermission('media', false, renderer, renderer, ['audio'])).toBe(false)
    expect(microphonePermission('media', true, 'https://evil.test/', renderer, ['audio'])).toBe(false)
  })
})
