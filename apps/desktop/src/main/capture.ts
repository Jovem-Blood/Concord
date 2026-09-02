import { desktopCapturer, ipcMain, type BrowserWindow, type Session, type WebFrameMain } from 'electron'
import type { CaptureSelection, CaptureSourceDTO } from '../shared/capture'

const SELECTION_TTL_MS = 10_000
const MAX_SOURCE_ID_LENGTH = 512

type PendingSelection = CaptureSelection & { expiresAt: number }
type FrameIdentity = Pick<WebFrameMain, 'processId' | 'routingId'>

const pendingSelections = new Map<number, PendingSelection>()

function isMainFrameForRenderer(frame: WebFrameMain | null, rendererFrame: FrameIdentity): boolean {
  if (!frame || frame.parent !== null) return false
  return frame.processId === rendererFrame.processId && frame.routingId === rendererFrame.routingId
}

function isCaptureSelection(value: unknown): value is CaptureSelection {
  if (!value || typeof value !== 'object') return false

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.sourceId === 'string' &&
    candidate.sourceId.length > 0 &&
    candidate.sourceId.length <= MAX_SOURCE_ID_LENGTH &&
    /^(screen|window):/.test(candidate.sourceId) &&
    typeof candidate.includeSystemAudio === 'boolean'
  )
}

async function loadSources(): Promise<CaptureSourceDTO[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  })

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
    icon: source.appIcon?.isEmpty() ? undefined : source.appIcon?.toDataURL(),
    kind: source.id.startsWith('screen:') ? 'screen' : 'window',
  }))
}

export function registerCaptureHandlers(mainWindow: BrowserWindow, appSession: Session): () => void {
  const renderer = mainWindow.webContents
  const rendererId = renderer.id
  const rendererFrame = {
    processId: renderer.mainFrame.processId,
    routingId: renderer.mainFrame.routingId,
  }
  const isTrustedSender = (senderId: number) =>
    !mainWindow.isDestroyed() && senderId === rendererId

  ipcMain.handle('capture:list-sources', async (event) => {
    if (!isTrustedSender(event.sender.id)) throw new Error('Untrusted capture source request')
    return loadSources()
  })

  ipcMain.handle('capture:select-source', (event, value: unknown) => {
    if (!isTrustedSender(event.sender.id) || !isCaptureSelection(value)) {
      throw new Error('Invalid capture selection')
    }

    pendingSelections.set(event.sender.id, {
      ...value,
      expiresAt: Date.now() + SELECTION_TTL_MS,
    })
  })

  ipcMain.handle('capture:cancel-selection', (event) => {
    if (isTrustedSender(event.sender.id)) pendingSelections.delete(event.sender.id)
  })

  appSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const selection = pendingSelections.get(rendererId)
    pendingSelections.delete(rendererId)

    const isExpectedFrame = isMainFrameForRenderer(request.frame, rendererFrame)
    if (!selection || selection.expiresAt < Date.now() || !isExpectedFrame) {
      callback({})
      return
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 0, height: 0 },
      })
      const source = sources.find((candidate) => candidate.id === selection.sourceId)

      if (!source) {
        callback({})
        return
      }

      callback({
        video: source,
        ...(selection.includeSystemAudio ? { audio: 'loopback' as const } : {}),
      })
    } catch {
      callback({})
    }
  })

  const cleanup = () => pendingSelections.delete(rendererId)
  mainWindow.on('closed', cleanup)

  return () => {
    mainWindow.off('closed', cleanup)
    cleanup()
    ipcMain.removeHandler('capture:list-sources')
    ipcMain.removeHandler('capture:select-source')
    ipcMain.removeHandler('capture:cancel-selection')
    appSession.setDisplayMediaRequestHandler(null)
  }
}
