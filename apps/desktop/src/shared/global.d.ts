import type { CaptureAPI } from './capture'

declare global {
  interface Window {
    captureAPI?: CaptureAPI
  }
}

export {}
