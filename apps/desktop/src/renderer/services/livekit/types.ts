import type { RemoteAudioTrack, RemoteVideoTrack } from 'livekit-client'

export type ParticipantView = {
  identity: string
  name: string
  isLocal: boolean
}

export type RemoteShareView = {
  key: string
  participantIdentity: string
  participantName: string
  streamName: string
  videoTrack?: RemoteVideoTrack
  audioTrack?: RemoteAudioTrack
}

export type RoomSnapshot = {
  participants: ParticipantView[]
  shares: RemoteShareView[]
}
