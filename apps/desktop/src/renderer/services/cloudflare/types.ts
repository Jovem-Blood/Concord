export type ParticipantView = { identity: string; name: string; isLocal: boolean }
export type RemoteShareView = {
  key: string
  participantIdentity: string
  participantName: string
  streamName: string
  videoTrack?: MediaStreamTrack
  audioTrack?: MediaStreamTrack
}
export type RoomSnapshot = { participants: ParticipantView[]; shares: RemoteShareView[] }
export type PublishedTrack = {
  participantIdentity: string
  participantName: string
  sessionId: string
  trackName: string
  kind: 'audio' | 'video'
}
export type RoomPresence = {
  participants: { identity: string; name: string }[]
  tracks: PublishedTrack[]
}
export type SfuResponse = {
  sessionId?: string
  sessionDescription?: RTCSessionDescriptionInit
  requiresImmediateRenegotiation?: boolean
  tracks?: { mid?: string; trackName?: string; sessionId?: string; errorCode?: string }[]
}
