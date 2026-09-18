import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CaptureAPI } from '../../../shared/capture'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('capture provider', () => {
  it('uses the browser picker and treats system audio as optional', async () => {
    const stream = {} as MediaStream
    const getDisplayMedia = vi.fn().mockResolvedValue(stream)
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
    const { createCaptureProvider } = await import('./provider')
    const provider = createCaptureProvider()

    const result = await provider.capture({ includeSystemAudio: true, resolution: '720p' })

    expect(result).toBe(stream)
    expect(provider.capabilities).toMatchObject({ environment: 'web', systemAudio: 'optional' })
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: true,
      systemAudio: 'include',
      video: {
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    }))
  })

  it('keeps Electron source selection ahead of display capture', async () => {
    const calls: string[] = []
    const captureAPI: CaptureAPI = {
      listSources: vi.fn().mockResolvedValue([]),
      selectSource: vi.fn().mockImplementation(async () => void calls.push('select')),
      cancelSelection: vi.fn().mockResolvedValue(undefined),
    }
    const getDisplayMedia = vi.fn().mockImplementation(async () => {
      calls.push('capture')
      return {} as MediaStream
    })
    vi.stubGlobal('window', { captureAPI })
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia } })
    const { createCaptureProvider } = await import('./provider')
    const provider = createCaptureProvider()

    await provider.capture({
      source: { id: 'screen:1:0', name: 'Monitor', thumbnail: '', kind: 'screen' },
      includeSystemAudio: false,
      resolution: '1080p',
    })

    expect(calls).toEqual(['select', 'capture'])
    expect(provider.capabilities.environment).toBe('electron')
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      video: {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
    }))
  })
})
