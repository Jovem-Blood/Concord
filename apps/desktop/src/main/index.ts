import { app, BrowserWindow, session } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerCaptureHandlers } from './capture'
import { microphonePermission, trustedRendererUrl } from './permissions'
import { startAutoUpdates } from './updater'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

let mainWindow: BrowserWindow | null = null
let disposeCaptureHandlers: (() => void) | null = null

function isTrustedRendererUrl(url: string): boolean {
  return trustedRendererUrl(url, rendererUrl())
}
function rendererUrl(): string {
  return MAIN_WINDOW_VITE_DEV_SERVER_URL || pathToFileURL(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)).href
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    show: false,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(__dirname, '../../assets/icon.png'),
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })

  const appSession = mainWindow.webContents.session
  disposeCaptureHandlers = registerCaptureHandlers(mainWindow, appSession)

  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(webContents === mainWindow?.webContents && microphonePermission(permission,
      details.isMainFrame, details.requestingUrl, rendererUrl(), 'mediaTypes' in details ? details.mediaTypes ?? [] : []))
  })

  appSession.setPermissionCheckHandler((webContents, permission, _origin, details) =>
    webContents === mainWindow?.webContents && microphonePermission(permission,
      details.isMainFrame, details.requestingUrl ?? '', rendererUrl(), [details.mediaType ?? 'unknown']))

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    disposeCaptureHandlers?.()
    disposeCaptureHandlers = null
    mainWindow = null
  })

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    )
  }
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' http://localhost:* ws://localhost:* https: wss:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
        ],
      },
    })
  })

  createMainWindow()
  startAutoUpdates()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
