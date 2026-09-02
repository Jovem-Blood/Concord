export type RoomState =
  | 'idle'
  | 'joining'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error'

export type ShareState =
  | 'idle'
  | 'selecting'
  | 'starting'
  | 'sharing'
  | 'stopping'
  | 'error'

const roomTransitions: Record<RoomState, readonly RoomState[]> = {
  idle: ['joining'],
  joining: ['connected', 'disconnected', 'error', 'idle'],
  connected: ['reconnecting', 'disconnected', 'error', 'idle'],
  reconnecting: ['connected', 'disconnected', 'error'],
  disconnected: ['joining', 'idle'],
  error: ['joining', 'idle'],
}

const shareTransitions: Record<ShareState, readonly ShareState[]> = {
  idle: ['selecting'],
  selecting: ['starting', 'idle', 'error'],
  starting: ['sharing', 'stopping', 'idle', 'error'],
  sharing: ['stopping', 'error'],
  stopping: ['idle', 'error'],
  error: ['idle', 'selecting', 'stopping'],
}

export function transitionRoom(current: RoomState, next: RoomState): RoomState {
  if (!roomTransitions[current].includes(next)) throw new Error(`Invalid room transition: ${current} -> ${next}`)
  return next
}

export function transitionShare(current: ShareState, next: ShareState): ShareState {
  if (!shareTransitions[current].includes(next)) throw new Error(`Invalid share transition: ${current} -> ${next}`)
  return next
}
