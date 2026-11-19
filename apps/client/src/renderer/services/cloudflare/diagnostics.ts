// Bounded statistics shared by the local export and automatic media reports.
const rtpFields = ['type', 'kind', 'timestamp', 'mid', 'rid', 'bytesReceived', 'bytesSent', 'packetsLost', 'packetsSent',
  'packetsReceived', 'fractionLost', 'roundTripTime', 'jitter', 'framesReceived', 'framesDecoded', 'framesEncoded',
  'framesDropped', 'framesPerSecond', 'frameWidth', 'frameHeight', 'freezeCount', 'totalFreezesDuration',
  'qualityLimitationReason', 'totalEncodeTime', 'totalDecodeTime', 'totalAudioEnergy']

function fields(stat: Record<string, unknown>, keys: string[]): Record<string, string | number> {
  const result: Record<string, string | number> = {}
  for (const key of keys) {
    const value = stat[key]
    if (typeof value === 'number' || typeof value === 'string') result[key] = value
  }
  return result
}

export function summarizeRtcStats(stats?: RTCStatsReport) {
  const tracks: Record<string, string | number>[] = []
  let selectedPair: Record<string, unknown> | undefined
  let nominatedPair: Record<string, unknown> | undefined
  stats?.forEach(stat => {
    if (['inbound-rtp', 'outbound-rtp', 'remote-inbound-rtp'].includes(stat.type)) {
      const track = fields(stat, rtpFields)
      if (stat.type === 'remote-inbound-rtp') {
        const mid = stats.get(stat.localId)?.mid
        if (typeof mid === 'string') track.mid = mid
      }
      tracks.push(track)
    } else if (stat.type === 'media-source' && stat.kind === 'video') {
      tracks.push(fields(stat, ['type', 'kind', 'timestamp', 'width', 'height', 'frames', 'framesPerSecond']))
    } else if (stat.type === 'transport' && stat.selectedCandidatePairId) {
      selectedPair = stats.get(stat.selectedCandidatePairId)
    } else if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
      nominatedPair = stat
    }
  })
  const transport = fields(selectedPair ?? nominatedPair ?? {}, ['currentRoundTripTime', 'availableOutgoingBitrate', 'bytesSent', 'bytesReceived'])
  return { tracks, transport }
}

export type MediaEvent = { at: number; name: string; durationMs?: number; outcome?: string }
export class MediaDiagnostics {
  private events: MediaEvent[] = []
  record(name: string, durationMs?: number, outcome?: string): void {
    this.events.push({ at: Date.now(), name, ...(durationMs === undefined ? {} : { durationMs: Math.round(durationMs) }), ...(outcome ? { outcome } : {}) })
    if (this.events.length > 120) this.events.shift()
  }
  async snapshot(pc: RTCPeerConnection | null) {
    const stats = pc && pc.connectionState !== 'closed' ? await pc.getStats() : undefined
    return { provider: 'cloudflare', capturedAt: Date.now(), connection: pc?.connectionState ?? 'absent', signaling: pc?.signalingState ?? 'absent',
      ...summarizeRtcStats(stats), events: this.events.map((event) => ({ ...event })) }
  }
}
