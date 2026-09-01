import { EventEmitter } from 'node:events'
import type { BrowserWindow, Session } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerCaptureHandlers } from './capture'

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
}))

vi.mock('electron', () => ({
  desktopCapturer: { getSources: vi.fn() },
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}))

describe('capture handler cleanup', () => {
  it('does not access destroyed web contents when the window closes', () => {
    let destroyed = false
    const renderer = { id: 7, mainFrame: {} }
    const mainWindow = new EventEmitter() as EventEmitter & {
      isDestroyed(): boolean
      readonly webContents: typeof renderer
    }
    mainWindow.isDestroyed = () => destroyed
    Object.defineProperty(mainWindow, 'webContents', {
      get: () => {
        if (destroyed) throw new TypeError('Object has been destroyed')
        return renderer
      },
    })

    const appSession = { setDisplayMediaRequestHandler: vi.fn() }
    const dispose = registerCaptureHandlers(
      mainWindow as unknown as BrowserWindow,
      appSession as unknown as Session,
    )

    destroyed = true
    expect(() => mainWindow.emit('closed')).not.toThrow()
    expect(() => dispose()).not.toThrow()
    expect(appSession.setDisplayMediaRequestHandler).toHaveBeenLastCalledWith(null)
  })
})
