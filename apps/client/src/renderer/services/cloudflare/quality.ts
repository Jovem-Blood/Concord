import type { CaptureResolution } from '../../../shared/capture'
export type VideoLayer = 'f' | 'h' | 'q'
export function screenEncodings(resolution: CaptureResolution): RTCRtpEncodingParameters[] {
  // LiveKit ScreenSharePresets (30 fps) and its default half-resolution layer:
  // https://github.com/livekit/client-sdk-js/blob/main/src/room/track/options.ts
  // https://github.com/livekit/client-sdk-js/blob/main/src/room/participant/publishUtils.ts
  const maxBitrate = resolution === '720p' ? 2_000_000 : 5_000_000
  // Encoder order is low to high, as in LiveKit. RID names separately retain
  // Cloudflare's alphabetical preference: f (full) before h (half).
  return [
    { rid: 'h', scaleResolutionDownBy: 2, maxBitrate: maxBitrate / 4, maxFramerate: 30 },
    { rid: 'f', scaleResolutionDownBy: 1, maxBitrate, maxFramerate: 30 },
  ]
}
export function layerForTile(hidden: boolean): VideoLayer {
  // Tile size does not measure available bandwidth. Prefer the selected capture
  // quality whenever visible; the SFU retains bandwidth-based fallback.
  return hidden ? 'h' : 'f'
}
