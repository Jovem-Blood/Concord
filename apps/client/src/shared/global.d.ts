import type { CaptureAPI } from './capture'
import type { ClipboardAPI } from './clipboard'
import type { UpdateAPI } from './update'

declare global {
  interface Window {
    captureAPI?: CaptureAPI
    clipboardAPI?: ClipboardAPI
    updateAPI?: UpdateAPI
  }
}

export {}
