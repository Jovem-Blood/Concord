import { clipboard, ipcMain, type BrowserWindow } from 'electron'

const MAX_CLIPBOARD_TEXT_LENGTH = 8_192

function isClipboardText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CLIPBOARD_TEXT_LENGTH
}

export function registerClipboardHandlers(mainWindow: BrowserWindow): () => void {
  const rendererId = mainWindow.webContents.id
  const isTrustedSender = (senderId: number) =>
    !mainWindow.isDestroyed() && senderId === rendererId

  ipcMain.handle('clipboard:write-text', (event, value: unknown) => {
    if (!isTrustedSender(event.sender.id) || !isClipboardText(value)) {
      throw new Error('Invalid clipboard write request')
    }

    clipboard.writeText(value)
  })

  return () => ipcMain.removeHandler('clipboard:write-text')
}
