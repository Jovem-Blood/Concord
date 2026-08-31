export class SpeechGate {
  private loudFrames = 0
  private lastLoud = -Infinity
  private active = false
  update(rms: number, now: number): boolean {
    if (rms >= (this.active ? 0.015 : 0.025)) {
      this.lastLoud = now
      this.loudFrames++
      if (this.loudFrames >= 2) this.active = true
    } else {
      this.loudFrames = 0
      if (now - this.lastLoud >= 350) this.active = false
    }
    return this.active
  }
}

// Audio is analyzed locally and is never routed to a speaker or recognition service.
export class SpeakingMonitor {
  private context: AudioContext | null = null
  private entries = new Map<string, { track: MediaStreamTrack; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; data: Float32Array<ArrayBuffer>; gate: SpeechGate; speaking: boolean }>()
  private timer: ReturnType<typeof setInterval> | undefined
  constructor(private readonly changed: (id: string, speaking: boolean) => void) {}
  resume(): void {
    try { this.context ??= new AudioContext(); void this.context.resume().catch(() => undefined) } catch { /* Meter is optional. */ }
  }
  setTracks(tracks: { id: string; track: MediaStreamTrack }[]): void {
    for (const [id, entry] of this.entries) {
      if (tracks.some((item) => item.id === id && item.track === entry.track && item.track.readyState === 'live')) continue
      entry.source.disconnect(); entry.analyser.disconnect(); this.entries.delete(id); this.changed(id, false)
    }
    if (!tracks.length) { this.stop(); return }
    if (!this.context) this.resume()
    if (!this.context) return
    for (const { id, track } of tracks) {
      if (this.entries.has(id) || track.readyState !== 'live') continue
      const source = this.context.createMediaStreamSource(new MediaStream([track]))
      const analyser = this.context.createAnalyser()
      analyser.fftSize = 1024
      source.connect(analyser)
      this.entries.set(id, { track, source, analyser, data: new Float32Array(1024), gate: new SpeechGate(), speaking: false })
    }
    this.timer ??= setInterval(() => {
      for (const [id, entry] of this.entries) {
        entry.analyser.getFloatTimeDomainData(entry.data)
        const rms = Math.sqrt(entry.data.reduce((sum, value) => sum + value * value, 0) / entry.data.length)
        const speaking = entry.track.enabled && entry.track.readyState === 'live' && !entry.track.muted &&
          this.context?.state === 'running' && entry.gate.update(rms, performance.now())
        if (Boolean(speaking) !== entry.speaking) { entry.speaking = Boolean(speaking); this.changed(id, entry.speaking) }
      }
    }, 80)
  }
  stop(): void {
    clearInterval(this.timer); this.timer = undefined
    for (const [id, entry] of this.entries) { entry.source.disconnect(); entry.analyser.disconnect(); this.changed(id, false) }
    this.entries.clear()
    void this.context?.close().catch(() => undefined); this.context = null
  }
}
