import {
  AudioPresets,
  LocalTrackPublication,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteVideoTrack,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
} from 'livekit-client'
import { AppError } from '../../../shared/errors'
import type { CaptureProfile } from '../../../shared/capture'
import type { ParticipantView, RemoteShareView, RoomSnapshot } from './types'

type ConnectionListener = (state: 'connected' | 'reconnecting' | 'disconnected') => void
type SnapshotListener = (snapshot: RoomSnapshot) => void

export class LiveKitRoomService {
  private room: Room | null = null
  private snapshotListener: SnapshotListener | null = null
  private connectionListener: ConnectionListener | null = null
  private readonly shares = new Map<string, RemoteShareView>()
  private videoPublication: LocalTrackPublication | null = null
  private audioPublication: LocalTrackPublication | null = null

  onSnapshot(listener: SnapshotListener): void {
    this.snapshotListener = listener
  }

  onConnection(listener: ConnectionListener): void {
    this.connectionListener = listener
  }

  async connect(serverUrl: string, token: string): Promise<void> {
    await this.disconnect()

    const room = new Room({ adaptiveStream: true, dynacast: true })
    this.room = room

    room
      .on(RoomEvent.ParticipantConnected, () => this.emitSnapshot())
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        this.removeParticipantShares(participant.identity)
        this.emitSnapshot()
      })
      .on(RoomEvent.ParticipantNameChanged, () => this.emitSnapshot())
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) =>
        this.handleTrackSubscribed(track, publication, participant),
      )
      .on(RoomEvent.TrackUnsubscribed, (track, publication, participant) =>
        this.handleTrackUnsubscribed(track, publication, participant),
      )
      .on(RoomEvent.Reconnecting, () => this.connectionListener?.('reconnecting'))
      .on(RoomEvent.Reconnected, () => this.connectionListener?.('connected'))
      .on(RoomEvent.Disconnected, () => {
        this.clearRemoteShares()
        this.connectionListener?.('disconnected')
        this.emitSnapshot()
      })

    try {
      await room.connect(serverUrl, token)
      this.connectionListener?.('connected')
      this.emitSnapshot()
    } catch (error) {
      await this.disconnect()
      throw new AppError('ROOM_CONNECT_FAILED', 'Não foi possível conectar à sala.', { cause: error })
    }
  }

  async publishScreen(stream: MediaStream, profile: CaptureProfile): Promise<void> {
    const room = this.requireConnectedRoom()
    const videoTrack = stream.getVideoTracks()[0]
    const audioTrack = stream.getAudioTracks()[0]
    if (!videoTrack) throw new AppError('CAPTURE_SOURCE_GONE', 'A fonte selecionada não está mais disponível.')

    const streamName = `screen:${room.localParticipant.identity}`

    try {
      this.videoPublication = await room.localParticipant.publishTrack(videoTrack, {
        source: Track.Source.ScreenShare,
        stream: streamName,
        simulcast: true,
        videoEncoding:
          profile === 'smooth'
            ? ScreenSharePresets.h1080fps30.encoding
            : ScreenSharePresets.h1080fps15.encoding,
      })

      if (audioTrack) {
        this.audioPublication = await room.localParticipant.publishTrack(audioTrack, {
          source: Track.Source.ScreenShareAudio,
          stream: streamName,
          forceStereo: true,
          audioPreset: AudioPresets.musicHighQualityStereo,
        })
      }
    } catch (error) {
      await this.unpublishScreen()
      throw new AppError('TRACK_PUBLISH_FAILED', 'A captura iniciou, mas não pôde ser transmitida.', {
        cause: error,
      })
    }
  }

  async unpublishScreen(): Promise<void> {
    const room = this.room
    const publications = [this.videoPublication, this.audioPublication]
    this.videoPublication = null
    this.audioPublication = null

    if (!room) return
    await Promise.allSettled(
      publications.map(async (publication) => {
        if (publication?.track) await room.localParticipant.unpublishTrack(publication.track, true)
      }),
    )
  }

  async disconnect(): Promise<void> {
    const room = this.room
    await this.unpublishScreen()
    this.room = null
    this.clearRemoteShares()
    if (room) await room.disconnect()
    this.emitSnapshot()
  }

  private requireConnectedRoom(): Room {
    if (!this.room) throw new AppError('NETWORK_DISCONNECTED', 'Você não está conectado a uma sala.')
    return this.room
  }

  private handleTrackSubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void {
    if (publication.source !== Track.Source.ScreenShare && publication.source !== Track.Source.ScreenShareAudio) return

    const streamName = track.mediaStream?.id ?? track.mediaStreamID ?? `screen:${participant.identity}`
    const key = `${participant.identity}:${streamName}`
    const current: RemoteShareView = this.shares.get(key) ?? {
      key,
      participantIdentity: participant.identity,
      participantName: participant.name || participant.identity,
      streamName,
    }

    if (track instanceof RemoteVideoTrack) current.videoTrack = track
    if (track instanceof RemoteAudioTrack) current.audioTrack = track
    this.shares.set(key, current)
    this.emitSnapshot()
  }

  private handleTrackUnsubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void {
    track.detach().forEach((element) => element.remove())
    const streamName = track.mediaStream?.id ?? track.mediaStreamID ?? `screen:${participant.identity}`
    const key = `${participant.identity}:${streamName}`
    const share = this.shares.get(key)
    if (!share) return

    if (track.kind === Track.Kind.Video) delete share.videoTrack
    if (track.kind === Track.Kind.Audio) delete share.audioTrack
    if (!share.videoTrack && !share.audioTrack) this.shares.delete(key)
    this.emitSnapshot()
  }

  private removeParticipantShares(identity: string): void {
    for (const [key, share] of this.shares) {
      if (share.participantIdentity !== identity) continue
      share.videoTrack?.detach().forEach((element) => element.remove())
      share.audioTrack?.detach().forEach((element) => element.remove())
      this.shares.delete(key)
    }
  }

  private clearRemoteShares(): void {
    for (const share of this.shares.values()) {
      share.videoTrack?.detach().forEach((element) => element.remove())
      share.audioTrack?.detach().forEach((element) => element.remove())
    }
    this.shares.clear()
  }

  private emitSnapshot(): void {
    const participants: ParticipantView[] = []
    if (this.room) {
      participants.push({
        identity: this.room.localParticipant.identity,
        name: this.room.localParticipant.name || this.room.localParticipant.identity,
        isLocal: true,
      })
      for (const participant of this.room.remoteParticipants.values()) {
        participants.push({
          identity: participant.identity,
          name: participant.name || participant.identity,
          isLocal: false,
        })
      }
    }

    this.snapshotListener?.({
      participants,
      shares: Array.from(this.shares.values()),
    })
  }
}
