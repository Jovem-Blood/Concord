import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureAPI, CaptureSelection, CaptureSourceDTO } from '../shared/capture'
import type { ClipboardAPI } from '../shared/clipboard'

const captureAPI: CaptureAPI = Object.freeze({
  listSources: () => ipcRenderer.invoke('capture:list-sources') as Promise<CaptureSourceDTO[]>,
  selectSource: (selection: CaptureSelection) =>
    ipcRenderer.invoke('capture:select-source', selection) as Promise<void>,
  cancelSelection: () => ipcRenderer.invoke('capture:cancel-selection') as Promise<void>,
})

const clipboardAPI: ClipboardAPI = Object.freeze({
  writeText: (value: string) => ipcRenderer.invoke('clipboard:write-text', value) as Promise<void>,
})

contextBridge.exposeInMainWorld('captureAPI', captureAPI)
contextBridge.exposeInMainWorld('clipboardAPI', clipboardAPI)
