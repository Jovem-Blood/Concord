import { expect, it } from 'vitest'
import { MediaDiagnostics, summarizeRtcStats } from './diagnostics'
it('bounds event retention and excludes network identifiers from exported stats', async () => {
  const diagnostics = new MediaDiagnostics()
  for (let i = 0; i < 150; i++) diagnostics.record('queue.wait', i)
  const stats = new Map([
    ['rtp', { type: 'inbound-rtp', kind: 'video', bytesReceived: 1234, framesDecoded: 20, ip: 'private-address', trackIdentifier: 'private-track' }],
    ['candidate', { type: 'local-candidate', address: 'private-address' }],
  ])
  const result = await diagnostics.snapshot({ connectionState: 'connected', signalingState: 'stable', getStats: async () => stats } as unknown as RTCPeerConnection)
  expect(result.events).toHaveLength(120)
  expect(result.tracks[0]).toEqual({ type: 'inbound-rtp', kind: 'video', bytesReceived: 1234, framesDecoded: 20 })
  expect(JSON.stringify(result)).not.toContain('private')
})

it('exports observed video source and RTP feedback with the selected ICE path', () => {
  const stats = new Map<string, object>([
    ['source', { type: 'media-source', kind: 'video', width: 1280, height: 720, frames: 45, framesPerSecond: 23, trackIdentifier: 'private' }],
    ['out', { type: 'outbound-rtp', kind: 'video', mid: '2', framesEncoded: 40, framesPerSecond: 20, qualityLimitationReason: 'cpu' }],
    ['feedback', { type: 'remote-inbound-rtp', kind: 'video', localId: 'out', roundTripTime: 0.08, packetsLost: 0 }],
    ['in', { type: 'inbound-rtp', kind: 'video', framesReceived: 39, framesDecoded: 37, framesDropped: 2, freezeCount: 1 }],
    ['ice', { type: 'transport', selectedCandidatePairId: 'active' }],
    ['active', { type: 'candidate-pair', currentRoundTripTime: 0.07, localCandidateId: 'private' }],
    ['old', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.42 }],
  ])
  expect(summarizeRtcStats(stats)).toEqual({
    tracks: [
      { type: 'media-source', kind: 'video', width: 1280, height: 720, frames: 45, framesPerSecond: 23 },
      { type: 'outbound-rtp', kind: 'video', mid: '2', framesEncoded: 40, framesPerSecond: 20, qualityLimitationReason: 'cpu' },
      { type: 'remote-inbound-rtp', kind: 'video', mid: '2', roundTripTime: 0.08, packetsLost: 0 },
      { type: 'inbound-rtp', kind: 'video', framesReceived: 39, framesDecoded: 37, framesDropped: 2, freezeCount: 1 },
    ],
    transport: { currentRoundTripTime: 0.07 },
  })
})
