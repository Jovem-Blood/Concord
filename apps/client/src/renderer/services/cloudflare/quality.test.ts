import { describe, expect, it } from 'vitest'
import { layerForTile, screenEncodings } from './quality'
describe('bounded video quality', () => {
  it.each(['720p', '1080p'] as const)('keeps %s as the maximum, with bounded lower layers', (resolution) => {
    const encodings = screenEncodings(resolution)
    expect(encodings.map(e => e.rid)).toEqual(['f', 'h', 'q'])
    expect(encodings.map(e => e.scaleResolutionDownBy)).toEqual([1, 2, 4])
    expect(encodings[0]!.maxBitrate).toBe(resolution === '720p' ? 3_000_000 : 5_000_000)
    expect(encodings.reduce((sum, e) => sum + e.maxBitrate!, 0)).toBeLessThanOrEqual(resolution === '720p' ? 3_950_000 : 6_450_000)
  })
  it('reduces hidden and small tiles', () => {
    expect(layerForTile(1920, true)).toBe('q')
    expect(layerForTile(300, false)).toBe('q')
    expect(layerForTile(640, false)).toBe('h')
    expect(layerForTile(1280, false)).toBe('f')
  })
})
