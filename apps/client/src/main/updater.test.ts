import type { AppUpdater } from 'electron-updater'
import { describe, expect, it, vi } from 'vitest'
import { startAutoUpdates, supportsAutoUpdates } from './updater'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }))

describe('automatic updates', () => {
  it('runs only for packaged NSIS and AppImage builds with update metadata', () => {
    expect(supportsAutoUpdates(true, 'win32', true)).toBe(true)
    expect(supportsAutoUpdates(true, 'linux', true)).toBe(true)
    expect(supportsAutoUpdates(true, 'darwin', true)).toBe(false)
    expect(supportsAutoUpdates(false, 'win32', true)).toBe(false)
    expect(supportsAutoUpdates(true, 'win32', false)).toBe(false)
  })

  it('configures and starts the updater when metadata exists', () => {
    const updater = {
      on: vi.fn(),
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue(null),
    } as unknown as AppUpdater

    expect(startAutoUpdates({
      isPackaged: true,
      platform: 'linux',
      resourcesPath: '/app/resources',
      fileExists: (filePath) => filePath.endsWith('app-update.yml'),
      updater,
    })).toBe(true)
    expect(updater.allowPrerelease).toBe(false)
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledOnce()
  })

  it('does not start in a portable ZIP without update metadata', () => {
    const updater = { checkForUpdatesAndNotify: vi.fn() } as unknown as AppUpdater

    expect(startAutoUpdates({
      isPackaged: true,
      platform: 'win32',
      resourcesPath: 'C:\\Concord',
      fileExists: () => false,
      updater,
    })).toBe(false)
    expect(updater.checkForUpdatesAndNotify).not.toHaveBeenCalled()
  })
})
