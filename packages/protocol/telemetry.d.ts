export const CLIENT_OPERATIONS: readonly string[]
export const CLIENT_OUTCOMES: readonly string[]
export const CLIENT_REASONS: readonly string[]
export type ClientOperationName = 'room.join' | 'room.recover' | 'chat.send' | 'microphone.activate' |
  'microphone.publish' | 'screen.capture' | 'screen.publish' | 'media.prepare' | 'media.subscribe' |
  'media.recover' | 'sfu.signal' | 'client.exception'
export type ClientOutcome = 'success' | 'error' | 'cancelled' | 'denied'
export type ClientSpan = { name: ClientOperationName; traceparent: string; parent?: string;
  startedAt: number; durationMs: number; outcome: ClientOutcome }
export type ClientEvent = { level: 'error' | 'warn' | 'info' | 'debug'; event: string; clientId: string;
  platform: 'web' | 'desktop'; version?: string; code?: string; reason?: string; attempt?: number;
  stack?: string; span?: ClientSpan }
export function validTraceparent(value: unknown): value is string
export function diagnosticStack(stack: unknown): string | undefined
export function validClientEvent(value: unknown): value is ClientEvent
