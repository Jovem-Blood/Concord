import { app } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import { existsSync } from 'node:fs'
import path from 'node:path'

type UpdateClient = Pick<AppUpdater,
  'allowPrerelease' | 'autoDownload' | 'autoInstallOnAppQuit' | 'checkForUpdatesAndNotify' | 'logger' | 'on'>

type UpdateOptions = {
  isPackaged?: boolean
  platform?: NodeJS.Platform
  resourcesPath?: string
  fileExists?: (filePath: string) => boolean
  updater?: UpdateClient
}

export function supportsAutoUpdates(
  isPackaged: boolean,
  platform: NodeJS.Platform,
  updateConfigExists: boolean,
): boolean {
  return isPackaged && (platform === 'win32' || platform === 'linux') && updateConfigExists
}

export function startAutoUpdates(options: UpdateOptions = {}): boolean {
  const {
    isPackaged = app.isPackaged,
    platform = process.platform,
    resourcesPath = process.resourcesPath,
    fileExists = existsSync,
    updater = electronUpdater.autoUpdater,
  } = options
  const updateConfigExists = fileExists(path.join(resourcesPath, 'app-update.yml'))
  if (!supportsAutoUpdates(isPackaged, platform, updateConfigExists)) return false

  updater.allowPrerelease = false
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.logger = console
  updater.on('error', (error) => console.error('Automatic update failed:', error))
  void updater.checkForUpdatesAndNotify().catch((error: unknown) => {
    console.error('Could not check for updates:', error)
  })
  return true
}
