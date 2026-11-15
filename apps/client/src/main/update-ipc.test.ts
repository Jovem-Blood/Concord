import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoUpdates } from './updater'
import { registerUpdateHandlers } from './update-ipc'

const mocks = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: mocks }))
beforeEach(() => vi.clearAllMocks())

describe('update IPC', () => {
  it('authorizes only the window main frame, forwards state, and cleans up', () => {
    const webContents = { mainFrame: {}, send: vi.fn(), isDestroyed: () => false }
    const window = { webContents, isDestroyed: () => false } as unknown as BrowserWindow
    const unsubscribe = vi.fn()
    const updates = { getState: vi.fn(() => ({ status: 'idle' })), check: vi.fn(), install: vi.fn(), subscribe: vi.fn(() => unsubscribe) } as unknown as AutoUpdates
    const dispose = registerUpdateHandlers(window, updates)
    for (const [, handler] of mocks.handle.mock.calls) {
      expect(() => handler({ sender: {}, senderFrame: webContents.mainFrame })).toThrow('Invalid update request')
      expect(() => handler({ sender: webContents, senderFrame: {} })).toThrow('Invalid update request')
      handler({ sender: webContents, senderFrame: webContents.mainFrame })
    }
    expect(updates.getState).toHaveBeenCalledOnce()
    expect(updates.check).toHaveBeenCalledOnce()
    expect(updates.install).toHaveBeenCalledOnce()
    vi.mocked(updates.subscribe).mock.calls[0]![0]({ status: 'downloaded', currentVersion: '1.0.0', version: '1.1.0' })
    expect(webContents.send).toHaveBeenCalledWith('update:state', { status: 'downloaded', currentVersion: '1.0.0', version: '1.1.0' })
    dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(mocks.removeHandler).toHaveBeenCalledTimes(3)
  })
})
