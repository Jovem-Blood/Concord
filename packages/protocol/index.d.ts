export const PROTOCOL_VERSION: 3
export * from './telemetry.js'
export const SOCKET_PATH: '/v2/realtime'
export const RECOVERY_MS: number
export const ACK_MS: number
export const RETRY_MS: number
export const TOKEN_MS: number
export const RENEW_BEFORE_MS: number
export const TYPING_MS: number
export const MAX_MESSAGES: number
export const MAX_CONTENT_LENGTH: number
export const REACTION_EMOJIS: readonly ['👍', '❤️', '😂', '😮', '😢', '🎉']
export function validContent(content: unknown): content is string

export type Credentials = { participantToken: string; identity: string; expiresAt: number }
export type MediaSource = 'microphone' | 'screen-video' | 'screen-audio'
export type ParticipantPresence = { identity: string; name: string; connection: 'connected' | 'reconnecting'; voice: { available: boolean; muted?: boolean } }
export type PublishedTrack = { participantIdentity: string; participantName: string; sessionId: string; trackName: string; kind: 'audio' | 'video'; source: MediaSource }
export type Presence = { participants: ParticipantPresence[]; tracks: PublishedTrack[] }
export type ReactionEmoji = '👍' | '❤️' | '😂' | '😮' | '😢' | '🎉'
export type MessageReaction = { emoji: ReactionEmoji; senders: { id: string; name: string }[] }
export type ReplyReference = { id: string; senderName: string; content: string }
export type Message = { id: string; type: 'text'; content: string; sentAt: number; senderId: string; senderName: string; sequence: number; clientSequence: number; conversation: string; replyTo?: ReplyReference; reactions: MessageReaction[] }
export type Typist = { identity: string; name: string; expiresAt: number }
export type SyncRequest = { conversation: string; after: number }
export type SyncState = { presence: Presence; conversation: string; messages: Message[]; cursor: number; typing: Typist[]; serverTime: number; credentials: Credentials; nextClientSequence: number }
export type SendMessage = { id: string; content: string; conversation: string; clientSequence: number; replyToId?: string; traceparent?: string }
export type ReactMessage = { messageId: string; emoji: ReactionEmoji; conversation: string }
export type ErrorCode = 'UPDATE_REQUIRED' | 'SESSION_ENDED' | 'REPLACED' | 'CONVERSATION_RESET' | 'MESSAGE_EXPIRED' | 'INVALID_REQUEST' | 'RATE_LIMITED' | 'NOT_READY'
export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode }
export type Ack<T> = (result: Result<T>) => void
export interface ClientEvents {
  'session:sync': (request: SyncRequest, ack: Ack<SyncState>) => void
  'session:renew': (ack: Ack<Credentials>) => void
  'session:confirm': (token: string, ack: Ack<null>) => void
  'session:leave': (ack: Ack<null>) => void
  'chat:send': (message: SendMessage, ack: Ack<Message>) => void
  'chat:react': (reaction: ReactMessage, ack: Ack<Message>) => void
  'chat:typing': (value: { conversation: string; active: boolean }) => void
}
export interface ServerEvents {
  'room:presence': (presence: Presence) => void
  'chat:message': (message: Message) => void
  'chat:typing': (typists: Typist[]) => void
  'session:ended': (code: ErrorCode) => void
}
