import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { AutoUpdates } from './updater'

export function registerUpdateHandlers(window: BrowserWindow, updates: AutoUpdates): () => void {
  function authorize(event: IpcMainInvokeEvent) {
    if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Invalid update request')
    }
  }
  ipcMain.handle('update:state', (event) => { authorize(event); return updates.getState() })
  ipcMain.handle('update:check', (event) => { authorize(event); return updates.check() })
  ipcMain.handle('update:install', (event) => { authorize(event); updates.install() })
  const unsubscribe = updates.subscribe((state) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('update:state', state)
  })
  return () => {
    unsubscribe()
    for (const channel of ['update:state', 'update:check', 'update:install']) ipcMain.removeHandler(channel)
  }
}
