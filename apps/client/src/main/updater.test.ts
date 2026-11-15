import { EventEmitter } from 'node:events'
import type { AppUpdater } from 'electron-updater'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAutoUpdates, supportsAutoUpdates } from './updater'

vi.mock('electron', () => ({ app: { isPackaged: false, getVersion: () => '1.1.0' } }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }))
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach((dispose) => dispose()); vi.useRealTimers(); vi.restoreAllMocks() })
function setup(overrides = {}) {
  const emitter = new EventEmitter()
  const client = Object.assign(emitter, {
    checkForUpdates: vi.fn().mockImplementation(async () => { emitter.emit('update-not-available'); return null }),
    quitAndInstall: vi.fn(),
  })
  const updates = createAutoUpdates({
    isPackaged: true, platform: 'win32', resourcesPath: '/app/resources', fileExists: () => true,
    updater: client as unknown as AppUpdater, ...overrides,
  })
  cleanups.push(updates.dispose)
  return { updates, client }
}

describe('automatic updates', () => {
  it('supports packaged Windows and Linux only with metadata', () => {
    expect(supportsAutoUpdates(true, 'win32', true)).toBe(true)
    expect(supportsAutoUpdates(true, 'linux', true)).toBe(true)
    expect(supportsAutoUpdates(true, 'darwin', true)).toBe(false)
    expect(supportsAutoUpdates(false, 'win32', true)).toBe(false)
    expect(supportsAutoUpdates(true, 'win32', false)).toBe(false)
  })
  it.each([{ isPackaged: false }, { fileExists: () => false }, { platform: 'linux', appImage: '' }])('does not check unsupported builds: %o', async (options) => {
    const { updates, client } = setup(options)
    updates.start()
    expect((await updates.check()).status).toBe('unsupported')
    expect(client.checkForUpdates).not.toHaveBeenCalled()
    expect(() => updates.install()).toThrow('Update is not ready')
  })
  it('checks at startup and every four hours, without duplicate timers', async () => {
    vi.useFakeTimers()
    const { updates, client } = setup()
    updates.start()
    updates.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(client).toMatchObject({ allowPrerelease: false, autoDownload: true, autoInstallOnAppQuit: true })
    expect(client.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(updates.getState().status).toBe('up-to-date')
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(client.checkForUpdates).toHaveBeenCalledTimes(2)
    updates.dispose()
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
    expect(client.checkForUpdates).toHaveBeenCalledTimes(2)
  })
  it('streams progress, preserves downloaded state, and installs only on request', async () => {
    vi.useFakeTimers()
    const { updates, client } = setup()
    const observer = vi.fn()
    const unsubscribe = updates.subscribe(observer)
    client.emit('update-available', { version: '1.2.0' })
    client.emit('download-progress', { percent: 42.5 })
    expect(updates.getState()).toEqual({ status: 'downloading', currentVersion: '1.1.0', version: '1.2.0', percent: 42.5 })
    await updates.check()
    expect(client.checkForUpdates).not.toHaveBeenCalled()
    client.emit('update-downloaded', { version: '1.2.0' })
    await updates.check()
    expect(updates.getState().status).toBe('downloaded')
    expect(client.quitAndInstall).not.toHaveBeenCalled()
    unsubscribe()
    const count = observer.mock.calls.length
    updates.install()
    expect(updates.getState().status).toBe('installing')
    expect(() => updates.install()).toThrow('Update is not ready')
    await vi.advanceTimersByTimeAsync(0)
    expect(client.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
    expect(observer).toHaveBeenCalledTimes(count)
  })
  it('deduplicates simultaneous checks', async () => {
    const { updates, client } = setup()
    const first = updates.check()
    const second = updates.check()
    await Promise.all([first, second])
    expect(client.checkForUpdates).toHaveBeenCalledTimes(1)
  })
  it('surfaces failed downloads and allows retry without leaking errors to the UI', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { updates, client } = setup()
    client.checkForUpdates.mockImplementationOnce(async () => ({ downloadPromise: Promise.reject(new Error('private URL')) }))
    expect((await updates.check()).status).toBe('error')
    expect(JSON.stringify(updates.getState())).not.toContain('private URL')
    expect((await updates.check()).status).toBe('up-to-date')
    expect(client.checkForUpdates).toHaveBeenCalledTimes(2)
  })
  it('surfaces synchronous check failures and installer failures', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { updates, client } = setup()
    client.checkForUpdates.mockImplementationOnce(() => { throw new Error('offline') })
    expect((await updates.check()).status).toBe('error')
    client.emit('update-downloaded', { version: '1.2.0' })
    client.quitAndInstall.mockImplementationOnce(() => { throw new Error('installer failed') })
    updates.install()
    await vi.advanceTimersByTimeAsync(0)
    expect(updates.getState().status).toBe('error')
  })
  it('accepts AppImage, bounds progress, and removes listeners on disposal', () => {
    const { updates, client } = setup({ platform: 'linux', appImage: '/app/Concord.AppImage' })
    client.emit('update-available', { version: '1.2.0' })
    client.emit('download-progress', { percent: 120 })
    expect(updates.getState().percent).toBe(100)
    client.emit('download-progress', { percent: Number.NaN })
    expect(updates.getState().percent).toBe(100)
    updates.dispose()
    expect(client.eventNames()).toEqual([])
  })
})
