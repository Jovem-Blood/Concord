import { expect, it } from 'vitest'
import { screenEncodings } from './quality'
it.each(['720p', '1080p'] as const)('publishes one encoding without RIDs for %s', resolution => {
  expect(screenEncodings(resolution)).toEqual([{ maxBitrate: resolution === '720p' ? 2_000_000 : 5_000_000, maxFramerate: 30 }])
})
