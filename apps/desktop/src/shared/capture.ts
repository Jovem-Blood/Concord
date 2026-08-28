export type CaptureSourceDTO = {
  id: string
  name: string
  thumbnail: string
  icon?: string
  kind: 'screen' | 'window'
}

export type CaptureSelection = {
  sourceId: string
  includeSystemAudio: boolean
}

export type CaptureProfile = 'smooth' | 'sharp'

export type CaptureAPI = {
  listSources: () => Promise<CaptureSourceDTO[]>
  selectSource: (selection: CaptureSelection) => Promise<void>
  cancelSelection: () => Promise<void>
}
