import { EventEmitter } from 'node:events'
import type { BrowserWindow, Session } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCaptureHandlers } from './capture'

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn(),
  getSources: vi.fn(),
}))

vi.mock('electron', () => ({
  desktopCapturer: { getSources: electronMocks.getSources },
  ipcMain: {
    handle: electronMocks.handle,
    removeHandler: electronMocks.removeHandler,
  },
}))

beforeEach(() => vi.clearAllMocks())

describe('capture handler cleanup', () => {
  it('does not access destroyed web contents when the window closes', () => {
    let destroyed = false
    const renderer = { id: 7, mainFrame: { processId: 42, routingId: 9 } }
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

  it('accepts an equivalent top-level frame from the registered renderer', async () => {
    const renderer = { id: 7, mainFrame: { processId: 42, routingId: 9 } }
    const mainWindow = new EventEmitter() as EventEmitter & {
      isDestroyed(): boolean
      readonly webContents: typeof renderer
    }
    mainWindow.isDestroyed = () => false
    Object.defineProperty(mainWindow, 'webContents', { value: renderer })
    const appSession = { setDisplayMediaRequestHandler: vi.fn() }
    const source = { id: 'screen:1:0' }
    electronMocks.getSources.mockResolvedValue([source])

    const dispose = registerCaptureHandlers(
      mainWindow as unknown as BrowserWindow,
      appSession as unknown as Session,
    )
    const selectHandler = electronMocks.handle.mock.calls.find(([channel]) =>
      channel === 'capture:select-source')![1]
    selectHandler({ sender: { id: 7 } }, { sourceId: source.id, includeSystemAudio: false })
    const displayHandler = appSession.setDisplayMediaRequestHandler.mock.calls[0]![0]
    const callback = vi.fn()

    await displayHandler({
      frame: { parent: null, processId: 42, routingId: 9 },
    }, callback)

    expect(callback).toHaveBeenCalledWith({ video: source })
    dispose()
  })
})
