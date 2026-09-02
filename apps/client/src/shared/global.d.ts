import type { CaptureAPI } from './capture'
import type { ClipboardAPI } from './clipboard'

declare global {
  interface Window {
    captureAPI?: CaptureAPI
    clipboardAPI?: ClipboardAPI
  }
}

export {}
