import { describe, expect, it } from 'vitest'
import { displayCapturePermission, microphonePermission, trustedRendererUrl } from './permissions'
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

describe('desktop display capture permission', () => {
  const renderer = 'file:///C:/Concord/app/index.html'

  it('allows Electron 44 display requests only with a selected source', () => {
    expect(displayCapturePermission('media', true, renderer, renderer, [], true)).toBe(true)
    expect(displayCapturePermission('media', true, renderer, renderer, [], false)).toBe(false)
  })

  it('supports the dedicated display permission without allowing camera access', () => {
    expect(displayCapturePermission('display-capture', true, renderer, renderer, ['video'], true)).toBe(true)
    expect(displayCapturePermission('display-capture', true, renderer, renderer, ['video', 'audio'], true)).toBe(true)
    expect(displayCapturePermission('display-capture', true, renderer, renderer, ['video'], false)).toBe(false)
    expect(displayCapturePermission('media', true, renderer, renderer, ['video'], true)).toBe(false)
    expect(displayCapturePermission('media', true, renderer, renderer, ['audio', 'video'], true)).toBe(false)
    expect(displayCapturePermission('notifications', true, renderer, renderer, [], true)).toBe(false)
  })

  it('rejects subframes and untrusted documents even with a selected source', () => {
    expect(displayCapturePermission('media', false, renderer, renderer, [], true)).toBe(false)
    expect(displayCapturePermission('media', true, 'https://evil.test/', renderer, [], true)).toBe(false)
    expect(displayCapturePermission('media', true, `${renderer}.evil`, renderer, [], true)).toBe(false)
  })
})
