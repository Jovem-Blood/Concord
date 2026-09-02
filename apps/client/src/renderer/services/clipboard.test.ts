import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeClipboard } from './clipboard'

afterEach(() => vi.unstubAllGlobals())

describe('clipboard service', () => {
  it('uses the Electron bridge before the browser clipboard', async () => {
    const desktopWrite = vi.fn().mockResolvedValue(undefined)
    const browserWrite = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { clipboardAPI: { writeText: desktopWrite } })
    vi.stubGlobal('navigator', { clipboard: { writeText: browserWrite } })

    await writeClipboard('https://share.example.com/ABCD2345')

    expect(desktopWrite).toHaveBeenCalledWith('https://share.example.com/ABCD2345')
    expect(browserWrite).not.toHaveBeenCalled()
  })

  it('keeps the browser clipboard path for the web client', async () => {
    const browserWrite = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', {})
    vi.stubGlobal('navigator', { clipboard: { writeText: browserWrite } })

    await writeClipboard('https://share.example.com/ABCD2345')

    expect(browserWrite).toHaveBeenCalledWith('https://share.example.com/ABCD2345')
  })
})
