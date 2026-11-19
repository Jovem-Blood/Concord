// Both ends project onto this schema. Only counters, enumerated states and numeric
// MIDs can enter the automatic report, even when the input is an arbitrary object.
const trackNumbers = ['timestamp', 'bytesReceived', 'bytesSent', 'packetsLost', 'packetsSent',
  'packetsReceived', 'fractionLost', 'roundTripTime', 'jitter', 'framesReceived', 'framesDecoded',
  'framesEncoded', 'framesDropped', 'framesPerSecond', 'frameWidth', 'frameHeight', 'freezeCount',
  'totalFreezesDuration', 'totalEncodeTime', 'totalDecodeTime', 'totalAudioEnergy', 'width', 'height', 'frames']
const transportNumbers = ['currentRoundTripTime', 'availableOutgoingBitrate', 'bytesSent', 'bytesReceived']
const eventNames = ['queue.wait', 'peer.dispose', 'screen.publish', 'microphone.publish', 'media.prepare',
  'media.subscribe', 'media.recover', 'signal.ice-servers', 'signal.session', 'signal.media/prepare',
  'signal.tracks', 'signal.renegotiate', 'signal.tracks/close']
const connectionStates = ['absent', 'new', 'connecting', 'connected', 'reconnecting', 'signalReconnecting',
  'disconnected', 'failed', 'closed']
const signalingStates = ['stable', 'absent', 'closed', 'have-local-offer', 'have-remote-offer', 'have-local-pranswer', 'have-remote-pranswer']

function numbers(value, keys) {
  return Object.fromEntries(keys.filter(key => Number.isFinite(value?.[key])).map(key => [key, value[key]]))
}

export function compactMediaSample(value) {
  if (!value || !['cloudflare', 'livekit'].includes(value.provider) || !Number.isSafeInteger(value.capturedAt) ||
      !Array.isArray(value.tracks)) return undefined
  const tracks = []
  // Keep video first when large rooms produce more rows than fit in one report.
  for (const kind of ['video', 'audio']) {
    for (const row of value.tracks) {
      if (tracks.length >= 48) break
      if (row?.kind !== kind || !['media-source', 'inbound-rtp', 'outbound-rtp', 'remote-inbound-rtp'].includes(row.type)) continue
      const track = { kind, type: row.type, ...numbers(row, trackNumbers) }
      if (typeof row.mid === 'string' && /^\d{1,6}$/.test(row.mid)) track.mid = row.mid
      if (['none', 'cpu', 'bandwidth', 'other'].includes(row.qualityLimitationReason)) track.qualityLimitationReason = row.qualityLimitationReason
      if (['screen_share', 'screen_share_audio', 'microphone', 'camera'].includes(row.source)) track.source = row.source
      tracks.push(track)
    }
  }
  const transport = value.provider === 'cloudflare' ? numbers(value.transport, transportNumbers) :
    Object.fromEntries(['publisher', 'subscriber'].filter(key => value.transport?.[key]).map(key => [key, numbers(value.transport[key], transportNumbers)]))
  const sample = { provider: value.provider, capturedAt: value.capturedAt, tracks, transport }
  if (['share-change', 'healthcheck'].includes(value.trigger)) sample.trigger = value.trigger
  if (connectionStates.includes(value.connection)) sample.connection = value.connection
  if (signalingStates.includes(value.signaling)) sample.signaling = value.signaling
  if (Array.isArray(value.events)) {
    sample.events = value.events.slice(-24).filter(event => eventNames.includes(event?.name) && Number.isSafeInteger(event.at))
      .map(event => ({ name: event.name, ...numbers(event, ['at', 'durationMs']),
        ...(['success', 'error'].includes(event.outcome) ? { outcome: event.outcome } : {}) }))
  }
  return sample
}
