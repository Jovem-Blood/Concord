import { describe, expect, it } from 'vitest'
import { layerForTile, screenEncodings } from './quality'
describe('bounded video quality', () => {
  it.each(['720p', '1080p'] as const)('keeps %s as the maximum, with bounded lower layers', (resolution) => {
    const encodings = screenEncodings(resolution)
    expect(encodings.map(e => e.rid)).toEqual(['h', 'f'])
    expect(encodings.map(e => e.scaleResolutionDownBy)).toEqual([2, 1])
    expect(encodings.map(e => e.maxFramerate)).toEqual([30, 30])
    expect(encodings[1]!.maxBitrate).toBe(resolution === '720p' ? 2_000_000 : 5_000_000)
    expect(encodings.reduce((sum, e) => sum + e.maxBitrate!, 0)).toBe(resolution === '720p' ? 2_500_000 : 6_250_000)
  })
  it('prefers full quality for visible streams and restores it after hiding', () => {
    expect([false, true, false].map(layerForTile)).toEqual(['f', 'h', 'f'])
  })
})
