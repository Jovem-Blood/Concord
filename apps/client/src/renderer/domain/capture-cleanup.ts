const stoppedStreams = new WeakSet<MediaStream>()

export function stopMediaStream(stream: MediaStream | null): void {
  if (!stream || stoppedStreams.has(stream)) return
  stoppedStreams.add(stream)

  for (const track of stream.getTracks()) {
    track.onended = null
    track.stop()
  }
}
