import { app } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { UpdateState } from '../shared/update'

type UpdateClient = Pick<AppUpdater,
  'allowPrerelease' | 'autoDownload' | 'autoInstallOnAppQuit' | 'checkForUpdates' | 'quitAndInstall' | 'logger' | 'on' | 'removeListener'>

type UpdateOptions = {
  isPackaged?: boolean
  platform?: NodeJS.Platform
  resourcesPath?: string
  currentVersion?: string
  appImage?: string
  fileExists?: (filePath: string) => boolean
  updater?: UpdateClient
}

export function supportsAutoUpdates(isPackaged: boolean, platform: NodeJS.Platform, updateConfigExists: boolean): boolean {
  return isPackaged && (platform === 'win32' || platform === 'linux') && updateConfigExists
}

export function createAutoUpdates(options: UpdateOptions = {}) {
  const {
    isPackaged = app.isPackaged, platform = process.platform, resourcesPath = process.resourcesPath,
    currentVersion = app.getVersion(), appImage = process.env.APPIMAGE,
    fileExists = existsSync, updater = electronUpdater.autoUpdater,
  } = options
  const supported = supportsAutoUpdates(isPackaged, platform, fileExists(path.join(resourcesPath, 'app-update.yml')))
    && (platform !== 'linux' || Boolean(appImage))
  let state: UpdateState = { status: supported ? 'idle' : 'unsupported', currentVersion }
  const subscribers = new Set<(state: UpdateState) => void>()
  let pending: Promise<void> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  const getState = (): UpdateState => ({ ...state })
  const publish = (next: Omit<UpdateState, 'currentVersion'>) => {
    if (disposed) return
    state = { currentVersion, ...next }
    for (const listener of subscribers) listener(getState())
  }
  const failed = (error: unknown) => {
    console.error('[error] desktop.update.failed', error)
    publish({ status: 'error' })
  }
  const checking = () => publish({ status: 'checking' })
  const available = (info: { version: string }) => publish({ status: 'downloading', version: info.version, percent: 0 })
  const latest = () => publish({ status: 'up-to-date' })
  const progress = (info: { percent: number }) => {
    if (state.status === 'downloading' && Number.isFinite(info.percent)) {
      publish({ status: 'downloading', version: state.version, percent: Math.max(0, Math.min(100, info.percent)) })
    }
  }
  const downloaded = (info: { version: string }) => publish({ status: 'downloaded', version: info.version, percent: 100 })

  if (supported) {
    updater.allowPrerelease = false
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.logger = console
    updater.on('checking-for-update', checking)
    updater.on('update-available', available)
    updater.on('update-not-available', latest)
    updater.on('download-progress', progress)
    updater.on('update-downloaded', downloaded)
    updater.on('error', failed)
  }

  async function check(): Promise<UpdateState> {
    if (disposed || !supported || pending || ['downloading', 'downloaded', 'installing'].includes(state.status)) return getState()
    checking()
    // Defer the call so concurrent requests share the same in-flight operation.
    pending = Promise.resolve().then(async () => {
      const result = await updater.checkForUpdates()
      if (result?.downloadPromise) await result.downloadPromise
    }).catch(failed)
    try { await pending } finally { pending = undefined }
    return getState()
  }

  return {
    getState,
    check,
    subscribe(listener: (state: UpdateState) => void) {
      subscribers.add(listener)
      return () => { subscribers.delete(listener) }
    },
    start() {
      if (!supported || timer || disposed) return
      void check()
      timer = setInterval(() => { void check() }, 4 * 60 * 60 * 1000)
      timer.unref()
    },
    install() {
      if (disposed || state.status !== 'downloaded') throw new Error('Update is not ready')
      publish({ status: 'installing', version: state.version })
      // Let the IPC reply reach the renderer before closing its window.
      setImmediate(() => {
        if (disposed) return
        try { updater.quitAndInstall(false, true) } catch (error) { failed(error) }
      })
    },
    dispose() {
      disposed = true
      if (timer) clearInterval(timer)
      subscribers.clear()
      if (!supported) return
      updater.removeListener('checking-for-update', checking)
      updater.removeListener('update-available', available)
      updater.removeListener('update-not-available', latest)
      updater.removeListener('download-progress', progress)
      updater.removeListener('update-downloaded', downloaded)
      updater.removeListener('error', failed)
    },
  }
}

export type AutoUpdates = ReturnType<typeof createAutoUpdates>
