export type AppErrorCode =
  | 'ROOM_TOKEN_FAILED'
  | 'ROOM_CONNECT_FAILED'
  | 'CAPTURE_CANCELLED'
  | 'CAPTURE_SOURCE_GONE'
  | 'CAPTURE_PERMISSION_DENIED'
  | 'TRACK_PUBLISH_FAILED'
  | 'TRACK_SUBSCRIBE_FAILED'
  | 'NETWORK_RECONNECTING'
  | 'NETWORK_DISCONNECTED'
  | 'UNKNOWN'

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message)
    this.name = 'AppError'
    this.cause = options?.cause
  }

  declare readonly cause?: unknown
}
