import type { CaptureResolution } from '../../../shared/capture'

export function screenEncodings(resolution: CaptureResolution): RTCRtpEncodingParameters[] {
  return [{ maxBitrate: resolution === '720p' ? 2_000_000 : 5_000_000, maxFramerate: 30 }]
}
