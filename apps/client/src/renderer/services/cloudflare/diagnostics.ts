// Local, bounded diagnostics: never retain SDP, credentials, device names or IP addresses.
export type MediaEvent = { at: number; name: string; durationMs?: number; outcome?: string }
export class MediaDiagnostics {
  private events: MediaEvent[] = []
  record(name: string, durationMs?: number, outcome?: string): void {
    this.events.push({ at: Date.now(), name, ...(durationMs === undefined ? {} : { durationMs: Math.round(durationMs) }), ...(outcome ? { outcome } : {}) })
    if (this.events.length > 120) this.events.shift()
  }
  async snapshot(pc: RTCPeerConnection | null) {
    const tracks: Record<string, string | number>[] = []
    let transport: Record<string, number> = {}
    if (pc && pc.connectionState !== 'closed') {
      const stats = await pc.getStats()
      stats.forEach((stat) => {
        if (stat.type === 'inbound-rtp' || stat.type === 'outbound-rtp') {
          const keys = ['type', 'kind', 'mid', 'rid', 'bytesReceived', 'bytesSent', 'packetsLost', 'packetsReceived', 'jitter',
            'framesDecoded', 'framesEncoded', 'framesDropped', 'framesPerSecond', 'frameWidth', 'frameHeight',
            'freezeCount', 'totalFreezesDuration', 'qualityLimitationReason', 'totalEncodeTime', 'totalDecodeTime', 'totalAudioEnergy']
          tracks.push(Object.fromEntries(keys.filter((key) => typeof stat[key] === 'string' || typeof stat[key] === 'number').map((key) => [key, stat[key]])))
        }
        if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
          transport = Object.fromEntries(['currentRoundTripTime', 'availableOutgoingBitrate', 'bytesSent', 'bytesReceived']
            .filter((key) => typeof stat[key] === 'number').map((key) => [key, stat[key]]))
        }
      })
    }
    return { capturedAt: Date.now(), connection: pc?.connectionState ?? 'absent', signaling: pc?.signalingState ?? 'absent',
      transport, tracks, events: this.events.map((event) => ({ ...event })) }
  }
}
