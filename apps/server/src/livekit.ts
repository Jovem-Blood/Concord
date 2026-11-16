import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk'
import type { ServerConfig } from './config.js'

export function createLiveKit(config: NonNullable<ServerConfig['livekit']>) {
  const client = new RoomServiceClient(config.url.replace(/^ws/, 'http'), config.apiKey, config.apiSecret)
  return {
    async token(roomCode: string, identity: string, name: string) {
      const token = new AccessToken(config.apiKey, config.apiSecret, { identity, name, ttl: '10m' })
      token.addGrant({ room: `concord-${roomCode}`, roomJoin: true, canSubscribe: true, canPublish: true,
        canPublishData: false, canUpdateOwnMetadata: false,
        canPublishSources: [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] })
      return { url: config.url, token: await token.toJwt() }
    },
    async remove(roomCode: string, identity: string) {
      try { await client.removeParticipant(`concord-${roomCode}`, identity) }
      catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'not_found')) throw error
      }
    },
  }
}
