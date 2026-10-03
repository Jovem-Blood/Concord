import { EventEmitter } from 'node:events'
import type { BrowserWindow, Session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasPendingCaptureSelection, registerCaptureHandlers } from './capture'

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
afterEach(() => vi.useRealTimers())

function captureFixture() {
  const renderer = { id: 7, mainFrame: { parent: null, processId: 42, routingId: 9 } }
  const mainWindow = new EventEmitter() as EventEmitter & {
    isDestroyed(): boolean
    readonly webContents: typeof renderer
  }
  mainWindow.isDestroyed = () => false
  Object.defineProperty(mainWindow, 'webContents', { value: renderer })
  const appSession = { setDisplayMediaRequestHandler: vi.fn() }
  const window = mainWindow as unknown as BrowserWindow
  const dispose = registerCaptureHandlers(window, appSession as unknown as Session)
  const select = () => {
    const handler = electronMocks.handle.mock.calls.find(([channel]) => channel === 'capture:select-source')![1]
    handler({ sender: { id: 7 } }, { sourceId: 'screen:1:0', includeSystemAudio: false })
  }
  const display = appSession.setDisplayMediaRequestHandler.mock.calls[0]![0]
  electronMocks.getSources.mockResolvedValue([{ id: 'screen:1:0' }])
  return { renderer, mainWindow, window, dispose, select, display }
}

describe('display capture authorization', () => {
  it('accepts the loaded main frame when navigation replaced the initial frame', async () => {
    const fixture = captureFixture()
    fixture.renderer.mainFrame = { parent: null, processId: 81, routingId: 20 }
    expect(hasPendingCaptureSelection(fixture.window)).toBe(false)
    fixture.select()
    expect(hasPendingCaptureSelection(fixture.window)).toBe(true)
    const callback = vi.fn()
    await fixture.display({ frame: { ...fixture.renderer.mainFrame } }, callback)
    expect(callback).toHaveBeenCalledWith({ video: { id: 'screen:1:0' } })
    expect(hasPendingCaptureSelection(fixture.window)).toBe(false)
    fixture.dispose()
  })

  it('rejects a selection made before the frame was replaced', async () => {
    const fixture = captureFixture()
    fixture.select()
    fixture.renderer.mainFrame = { parent: null, processId: 81, routingId: 20 }
    expect(hasPendingCaptureSelection(fixture.window)).toBe(false)
    const callback = vi.fn()
    await fixture.display({ frame: { ...fixture.renderer.mainFrame } }, callback)
    expect(callback).toHaveBeenCalledWith({})
    expect(electronMocks.getSources).not.toHaveBeenCalled()
    fixture.dispose()
  })

  it('rejects expired selections at the permission and capture stages', async () => {
    vi.useFakeTimers()
    const fixture = captureFixture()
    fixture.select()
    vi.advanceTimersByTime(10_000)
    expect(hasPendingCaptureSelection(fixture.window)).toBe(false)
    const callback = vi.fn()
    await fixture.display({ frame: { ...fixture.renderer.mainFrame } }, callback)
    expect(callback).toHaveBeenCalledWith({})
    fixture.dispose()
  })

  it('rejects subframes, other renderers, and reuse of a consumed selection', async () => {
    const fixture = captureFixture()
    for (const frame of [
      { ...fixture.renderer.mainFrame, parent: {} },
      { ...fixture.renderer.mainFrame, processId: 99 },
    ]) {
      fixture.select()
      const callback = vi.fn()
      await fixture.display({ frame }, callback)
      expect(callback).toHaveBeenCalledWith({})
    }
    fixture.select()
    await fixture.display({ frame: { ...fixture.renderer.mainFrame } }, vi.fn())
    const callback = vi.fn()
    await fixture.display({ frame: { ...fixture.renderer.mainFrame } }, callback)
    expect(callback).toHaveBeenCalledWith({})
    fixture.dispose()
  })
})

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
