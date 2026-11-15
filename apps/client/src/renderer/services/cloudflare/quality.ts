import type { CaptureResolution } from '../../../shared/capture'
export type VideoLayer = 'f' | 'h' | 'q'
export function screenEncodings(resolution: CaptureResolution): RTCRtpEncodingParameters[] {
  return [
    { rid: 'f', scaleResolutionDownBy: 1, maxBitrate: resolution === '720p' ? 3_000_000 : 5_000_000, maxFramerate: 30 },
    { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: resolution === '720p' ? 750_000 : 1_250_000, maxFramerate: 20 },
    { rid: 'q', scaleResolutionDownBy: 4, maxBitrate: 200_000, maxFramerate: 10 },
  ]
}
export function layerForTile(width: number, hidden: boolean): VideoLayer {
  return hidden || width <= 320 ? 'q' : width <= 720 ? 'h' : 'f'
}
