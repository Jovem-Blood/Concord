const ICE_GATHERING_TIMEOUT_MS = 10_000

export function waitForIceGathering(pc: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Session closed', 'AbortError'))
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout)
      pc.removeEventListener('icegatheringstatechange', check)
      pc.removeEventListener('connectionstatechange', check)
      signal.removeEventListener('abort', abort)
      if (error) reject(error); else resolve()
    }
    const check = () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        finish(new Error('WebRTC connection closed while gathering ICE candidates'))
      } else if (pc.iceGatheringState === 'complete') finish()
    }
    const abort = () => finish(new DOMException('Session closed', 'AbortError'))
    const timeout = setTimeout(() => {
      // A slow STUN/TURN server must not block usable candidates from other routes.
      const hasCandidate = pc.localDescription?.sdp.split(/\r?\n/).some((line) => line.startsWith('a=candidate:'))
      finish(hasCandidate ? undefined : new DOMException('WebRTC ICE gathering timed out without candidates', 'TimeoutError'))
    }, ICE_GATHERING_TIMEOUT_MS)
    pc.addEventListener('icegatheringstatechange', check)
    pc.addEventListener('connectionstatechange', check)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort(); else check()
  })
}
