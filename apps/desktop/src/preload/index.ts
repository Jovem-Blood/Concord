import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureAPI, CaptureSelection, CaptureSourceDTO } from '../shared/capture'

const captureAPI: CaptureAPI = Object.freeze({
  listSources: () => ipcRenderer.invoke('capture:list-sources') as Promise<CaptureSourceDTO[]>,
  selectSource: (selection: CaptureSelection) =>
    ipcRenderer.invoke('capture:select-source', selection) as Promise<void>,
  cancelSelection: () => ipcRenderer.invoke('capture:cancel-selection') as Promise<void>,
})

contextBridge.exposeInMainWorld('captureAPI', captureAPI)
