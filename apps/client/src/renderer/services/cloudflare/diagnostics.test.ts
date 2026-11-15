import { expect, it } from 'vitest'
import { MediaDiagnostics } from './diagnostics'
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
