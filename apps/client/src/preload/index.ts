import { contextBridge, ipcRenderer } from 'electron'
import type { CaptureAPI, CaptureSelection, CaptureSourceDTO } from '../shared/capture'
import type { ClipboardAPI } from '../shared/clipboard'
import type { UpdateAPI, UpdateState } from '../shared/update'

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

const updateAPI: UpdateAPI = Object.freeze({
  getState: () => ipcRenderer.invoke('update:state') as Promise<UpdateState>,
  check: () => ipcRenderer.invoke('update:check') as Promise<UpdateState>,
  install: () => ipcRenderer.invoke('update:install') as Promise<void>,
  onState: (listener: (state: UpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => listener(state)
    ipcRenderer.on('update:state', handler)
    return () => { ipcRenderer.removeListener('update:state', handler) }
  },
})
contextBridge.exposeInMainWorld('updateAPI', updateAPI)
