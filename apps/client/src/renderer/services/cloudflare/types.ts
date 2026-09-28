import type { Presence } from '@concord/protocol'

export type MediaSource = 'microphone' | 'screen-video' | 'screen-audio'
export type VoiceState = { joined: boolean; muted: boolean; deafened: boolean; microphoneAvailable: boolean }
export type ParticipantView = { identity: string; name: string; isLocal: boolean; connection?: 'connected' | 'reconnecting'; voice: { available: boolean; speaking?: boolean; muted?: boolean } }
export type RemoteVoiceTrack = { key: string; participantIdentity: string; participantName: string; track: MediaStreamTrack }
export type RemoteShareView = {
  key: string
  participantIdentity: string
  participantName: string
  streamName: string
  videoTrack?: MediaStreamTrack
  audioTrack?: MediaStreamTrack
}
export type RoomSnapshot = { participants: ParticipantView[]; shares: RemoteShareView[]; remoteVoiceTracks: RemoteVoiceTrack[] }
export type PublishedTrack = {
  participantIdentity: string
  participantName: string
  sessionId: string
  trackName: string
  kind: 'audio' | 'video'
  source: MediaSource
}
export type RoomPresence = Presence
export type SfuResponse = {
  sessionId?: string
  sessionDescription?: RTCSessionDescriptionInit
  requiresImmediateRenegotiation?: boolean
  tracks?: { mid?: string; trackName?: string; sessionId?: string; errorCode?: string }[]
  dataChannel?: { id?: number; errorCode?: string }
  dataChannels?: { id?: number; errorCode?: string }[]
}
