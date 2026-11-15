export type UpdateStatus = 'unsupported' | 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'downloaded' | 'installing' | 'error'

export type UpdateState = {
  status: UpdateStatus
  currentVersion: string
  version?: string
  percent?: number
}

export interface UpdateAPI {
  getState(): Promise<UpdateState>
  check(): Promise<UpdateState>
  install(): Promise<void>
  onState(listener: (state: UpdateState) => void): () => void
}
