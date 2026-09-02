import type { PublishedChannel, SfuResponse } from './types'

type Api = <T>(path: string, body?: unknown) => Promise<T>
type Subscription = { channel: RTCDataChannel; source: PublishedChannel }
export class ChatTransport {
  private bootstrap: RTCDataChannel | null = null
  private publisher: RTCDataChannel | null = null
  private subscriptions = new Map<string, Subscription>()
  private disposed = false
  constructor(private readonly pc: RTCPeerConnection, private readonly api: Api,
    private readonly receive: (data: unknown, source: PublishedChannel) => void,
    private readonly ready: (ready: boolean) => void) {}

  async establish(): Promise<void> {
    // Negotiated ID 0 reserves the server-events channel and adds SCTP to the offer.
    this.bootstrap = this.pc.createDataChannel('server-events', { negotiated: true, id: 0, ordered: true })
    await this.pc.setLocalDescription(await this.pc.createOffer())
    const result = await this.api<SfuResponse>('chat/establish', { sessionDescription: this.pc.localDescription!.toJSON() })
    if (this.disposed) return
    if (!result.sessionDescription || result.sessionDescription.type !== 'answer' || result.dataChannel?.errorCode ||
        result.dataChannel?.id !== 0) throw new Error('Invalid SCTP answer')
    await this.pc.setRemoteDescription(result.sessionDescription)
    const published = await this.api<SfuResponse>('chat/channels', { location: 'local' })
    if (this.disposed) return
    this.publisher = this.pc.createDataChannel('concord-chat', { negotiated: true, id: channelId(published), ordered: true })
    this.publisher.onopen = () => this.ready(true)
    this.publisher.onclose = this.publisher.onerror = () => this.ready(false)
    this.ready(this.publisher.readyState === 'open')
  }

  async synchronize(sources: PublishedChannel[]): Promise<void> {
    if (this.disposed || !this.publisher) return
    const wanted = new Set(sources.map((s) => s.sessionId))
    for (const [key, { channel }] of this.subscriptions) {
      if (wanted.has(key) && channel.readyState !== 'closed') continue
      this.release(channel)
      this.subscriptions.delete(key)
      const result = await this.api<SfuResponse>('chat/close', { ids: [channel.id] })
      if (result.dataChannels?.some((c) => c.errorCode)) throw new Error('Could not close chat subscription')
    }
    for (const source of sources) {
      if (this.subscriptions.has(source.sessionId)) continue
      const result = await this.api<SfuResponse>('chat/channels', { location: 'remote', sessionId: source.sessionId })
      if (this.disposed) return
      const channel = this.pc.createDataChannel('concord-chat', { negotiated: true, id: channelId(result), ordered: true })
      this.subscriptions.set(source.sessionId, { channel, source })
      channel.onmessage = (event) => { if (!this.disposed) this.receive(event.data, source) }
      channel.onopen = () => channel.send('ack')
      if (channel.readyState === 'open') channel.send('ack')
    }
  }
  send(data: string): boolean {
    if (!this.publisher || this.publisher.readyState !== 'open' || this.publisher.bufferedAmount > 64 * 1024) return false
    try { this.publisher.send(data); return true } catch { return false }
  }
  isReady(): boolean { return this.publisher?.readyState === 'open' }
  dispose(): void {
    this.disposed = true
    for (const { channel } of this.subscriptions.values()) this.release(channel)
    this.subscriptions.clear()
    if (this.publisher) this.release(this.publisher)
    if (this.bootstrap) this.release(this.bootstrap)
    this.publisher = this.bootstrap = null
    this.ready(false)
  }
  private release(channel: RTCDataChannel): void {
    channel.onmessage = channel.onopen = channel.onclose = channel.onerror = null
    channel.close()
  }
}
function channelId(result: SfuResponse): number {
  const channel = result.dataChannels?.[0]
  if (result.dataChannels?.length !== 1 || channel?.errorCode || !Number.isInteger(channel?.id) ||
      channel!.id! <= 0 || channel!.id! > 65534) throw new Error('Invalid data channel response')
  return channel!.id!
}
