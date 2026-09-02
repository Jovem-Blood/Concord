import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerClipboardHandlers } from './clipboard'

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
  writeText: vi.fn(),
}))

vi.mock('electron', () => ({
  clipboard: { writeText: electronMocks.writeText },
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}))

beforeEach(() => vi.clearAllMocks())

describe('clipboard IPC', () => {
  it('writes text only for the registered renderer', () => {
    const mainWindow = {
      isDestroyed: () => false,
      webContents: { id: 7 },
    } as unknown as BrowserWindow
    const dispose = registerClipboardHandlers(mainWindow)
    const handler = electronMocks.handle.mock.calls[0]![1]

    handler({ sender: { id: 7 } }, 'https://share.example.com/ABCD2345')

    expect(electronMocks.writeText).toHaveBeenCalledWith('https://share.example.com/ABCD2345')
    dispose()
    expect(electronMocks.removeHandler).toHaveBeenCalledWith('clipboard:write-text')
  })

  it('rejects writes from another renderer', () => {
    const mainWindow = {
      isDestroyed: () => false,
      webContents: { id: 7 },
    } as unknown as BrowserWindow
    registerClipboardHandlers(mainWindow)
    const handler = electronMocks.handle.mock.calls[0]![1]

    expect(() => handler({ sender: { id: 8 } }, 'private value')).toThrow('Invalid clipboard write request')
    expect(electronMocks.writeText).not.toHaveBeenCalled()
  })
})
