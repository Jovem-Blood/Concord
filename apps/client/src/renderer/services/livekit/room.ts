import { Room, RoomEvent, Track, RemoteVideoTrack, ScreenSharePresets, AudioPresets,
  type LocalTrackPublication, type RemoteParticipant } from 'livekit-client'
import type { Credentials, Presence } from '@concord/protocol'
import type { CaptureResolution } from '../../../shared/capture'
import type { RoomSnapshot, RemoteShareView } from '../cloudflare/types'
import { serverUrl } from '../server'

type Connection = 'connected' | 'reconnecting' | 'disconnected'

// LiveKit owns negotiation, congestion control, subscription quality and recovery.
// Concord owns capture UI, room authorization, chat and local playback controls.
export class LiveKitRoomService {
  private room: Room | null = null
  private controller?: AbortController
  private credentials: Credentials | null = null
  private presence: Presence = { participants: [], tracks: [] }
  private screen: MediaStream | null = null
  private microphone: MediaStreamTrack | null = null
  private screenGeneration = 0
  private snapshotListener: (snapshot: RoomSnapshot) => void = () => undefined
  private connectionListener: (state: Connection) => void = () => undefined

  constructor(private readonly createRoom = () => new Room({
    adaptiveStream: false,
    dynacast: false,
    disconnectOnPageLeave: true,
    publishDefaults: { simulcast: false, videoCodec: 'vp8', stopMicTrackOnMute: false },
  })) {}

  onSnapshot(listener: (snapshot: RoomSnapshot) => void): void { this.snapshotListener = listener }
  onConnection(listener: (state: Connection) => void): void { this.connectionListener = listener }
  updateCredentials(credentials: Credentials): void { this.credentials = credentials }
  // LiveKit has its own signaling/reconnection. A temporary chat outage must not
  // tear down healthy audio/video; RoomSession still enforces its expiry deadline.
  setSignalingAvailable(available: boolean): void { void available }
  updatePresence(presence: Presence): void { this.presence = presence; this.emitSnapshot() }

  async connect(credentials: Credentials): Promise<void> {
    await this.disconnect()
    this.credentials = credentials
    const controller = new AbortController()
    this.controller = controller
    const room = this.createRoom()
    this.room = room
    const refresh = () => { if (this.room === room) this.emitSnapshot() }
    room.on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackPublished, refresh).on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.TrackSubscribed, refresh).on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh).on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh).on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, refresh)
      .on(RoomEvent.Reconnecting, () => { if (this.room === room) this.connectionListener('reconnecting') })
      .on(RoomEvent.Reconnected, () => { if (this.room === room) { this.connectionListener('connected'); refresh() } })
      .on(RoomEvent.Disconnected, () => { if (this.room === room) this.connectionListener('disconnected') })
    try {
      const response = await fetch(`${serverUrl}/v1/livekit/token`, {
        method: 'POST', headers: { authorization: `Bearer ${credentials.participantToken}` },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })
      if (!response.ok) throw new Error(`Não foi possível autorizar a mídia LiveKit (${response.status}).`)
      const grant = await response.json() as { url?: string; token?: string }
      if (!grant.url || !grant.token) throw new Error('Resposta de mídia inválida.')
      if (this.room !== room) throw new DOMException('Entrada cancelada.', 'AbortError')
      await room.connect(grant.url, grant.token)
      if (this.room !== room) { await room.disconnect(); throw new DOMException('Entrada cancelada.', 'AbortError') }
      this.connectionListener('connected')
      this.emitSnapshot()
    } catch (error) {
      if (this.room === room) await this.disconnect()
      throw error
    }
  }

  async disconnect(): Promise<void> {
    this.controller?.abort(); this.controller = undefined
    const room = this.room
    this.room = null; this.credentials = null
    this.screenGeneration++
    this.screen?.getTracks().forEach(track => track.stop()); this.screen = null
    this.microphone?.stop(); this.microphone = null
    this.presence = { participants: [], tracks: [] }
    room?.removeAllListeners()
    await room?.disconnect()
    this.emitSnapshot()
  }

  async publishScreen(stream: MediaStream, resolution: CaptureResolution): Promise<void> {
    await this.unpublishScreen()
    const room = this.room
    if (!room) { stream.getTracks().forEach(track => track.stop()); throw new Error('Entre na sala antes de compartilhar.') }
    const generation = ++this.screenGeneration
    this.screen = stream
    const published: LocalTrackPublication[] = []
    try {
      for (const track of stream.getTracks()) {
        if (generation !== this.screenGeneration || this.room !== room) throw new DOMException('Compartilhamento cancelado.', 'AbortError')
        const video = track.kind === 'video'
        track.contentHint = video ? 'motion' : 'music'
        const publication = await room.localParticipant.publishTrack(track, {
          source: video ? Track.Source.ScreenShare : Track.Source.ScreenShareAudio,
          name: video ? 'screen' : 'screen-audio', stream: 'screen',
          ...(video ? {
            simulcast: false, videoCodec: 'vp8' as const,
            screenShareEncoding: (resolution === '720p' ? ScreenSharePresets.h720fps30 : ScreenSharePresets.h1080fps30).encoding,
            degradationPreference: 'maintain-framerate' as const,
          } : { audioPreset: AudioPresets.musicHighQualityStereo }),
        })
        published.push(publication)
      }
      if (generation !== this.screenGeneration || this.room !== room) throw new DOMException('Compartilhamento cancelado.', 'AbortError')
    } catch (error) {
      for (const publication of published) if (publication.track) await room.localParticipant.unpublishTrack(publication.track).catch(() => undefined)
      stream.getTracks().forEach(track => track.stop())
      if (this.screen === stream) this.screen = null
      throw error
    }
    this.emitSnapshot()
  }

  async unpublishScreen(): Promise<void> {
    this.screenGeneration++
    const stream = this.screen; this.screen = null
    const room = this.room
    if (!stream) return
    stream.getTracks().forEach(track => track.stop())
    if (room) await Promise.all(stream.getTracks().map(track => room.localParticipant.unpublishTrack(track)))
    this.emitSnapshot()
  }

  async publishMicrophone(track: MediaStreamTrack): Promise<void> {
    await this.unpublishMicrophone()
    const room = this.room
    if (!room) { track.stop(); throw new Error('Entre na sala antes de ativar o microfone.') }
    this.microphone = track
    try {
      await room.localParticipant.publishTrack(track, { source: Track.Source.Microphone, name: 'microphone', audioPreset: AudioPresets.speech })
      if (this.room !== room || this.microphone !== track) {
        await room.localParticipant.unpublishTrack(track); track.stop()
        throw new DOMException('Microfone cancelado.', 'AbortError')
      }
    } catch (error) { track.stop(); if (this.microphone === track) this.microphone = null; throw error }
    this.emitSnapshot()
  }
  async unpublishMicrophone(): Promise<void> {
    const track = this.microphone; this.microphone = null
    if (!track) return
    track.stop()
    await this.room?.localParticipant.unpublishTrack(track)
    this.emitSnapshot()
  }

  private shareParticipant(key: string): RemoteParticipant | undefined {
    return [...(this.room?.remoteParticipants.values() ?? [])].find(p => `livekit:${p.identity}` === key)
  }
  async pauseShare(key: string): Promise<void> {
    for (const publication of this.shareParticipant(key)?.trackPublications.values() ?? []) {
      if ([Track.Source.ScreenShare, Track.Source.ScreenShareAudio].includes(publication.source)) publication.setSubscribed(false)
    }
  }
  async resumeShare(key: string): Promise<void> {
    for (const publication of this.shareParticipant(key)?.trackPublications.values() ?? []) {
      if ([Track.Source.ScreenShare, Track.Source.ScreenShareAudio].includes(publication.source)) publication.setSubscribed(true)
    }
  }

  private emitSnapshot(): void {
    const room = this.room
    const snapshot: RoomSnapshot = { participants: [], shares: [], remoteVoiceTracks: [] }
    for (const member of this.presence.participants) {
      const isLocal = member.identity === this.credentials?.identity
      const participant = isLocal ? room?.localParticipant : room?.remoteParticipants.get(member.identity)
      const microphone = participant?.getTrackPublication(Track.Source.Microphone)
      snapshot.participants.push({ ...member, isLocal, voice: {
        available: Boolean(microphone), speaking: participant?.isSpeaking ?? false,
        muted: member.voice.muted ?? microphone?.isMuted ?? true,
      } })
      if (isLocal || !participant) continue
      const video = participant.getTrackPublication(Track.Source.ScreenShare)
      const audio = participant.getTrackPublication(Track.Source.ScreenShareAudio)
      if (video || audio) {
        const share: RemoteShareView = { key: `livekit:${member.identity}`, participantIdentity: member.identity,
          participantName: member.name, streamName: 'screen', videoTrack: video?.track?.mediaStreamTrack, audioTrack: audio?.track?.mediaStreamTrack }
        if (video?.track instanceof RemoteVideoTrack) share.livekitVideo = video.track
        snapshot.shares.push(share)
      }
      if (microphone?.track) snapshot.remoteVoiceTracks.push({ key: microphone.trackSid, participantIdentity: member.identity,
        participantName: member.name, track: microphone.track.mediaStreamTrack })
    }
    this.snapshotListener(snapshot)
  }

  async getDiagnostics() {
    const room = this.room
    const tracks: Record<string, unknown>[] = []
    for (const participant of room ? [room.localParticipant, ...room.remoteParticipants.values()] : []) {
      for (const publication of participant.trackPublications.values()) {
        const stats = await publication.track?.getRTCStatsReport()
        stats?.forEach(stat => {
          if (!['inbound-rtp', 'outbound-rtp'].includes(stat.type)) return
          const keys = ['type', 'kind', 'rid', 'bytesSent', 'bytesReceived', 'packetsLost', 'packetsReceived', 'jitter',
            'framesEncoded', 'framesDecoded', 'framesDropped', 'framesPerSecond', 'frameWidth', 'frameHeight',
            'freezeCount', 'totalFreezesDuration', 'qualityLimitationReason']
          tracks.push({ source: publication.source, ...Object.fromEntries(keys.filter(key =>
            typeof stat[key] === 'string' || typeof stat[key] === 'number').map(key => [key, stat[key]])) })
        })
      }
    }
    return { provider: 'livekit', capturedAt: Date.now(), connection: room?.state ?? 'disconnected', tracks }
  }
}
