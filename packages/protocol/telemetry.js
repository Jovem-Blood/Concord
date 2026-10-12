// The client sends a deliberately small diagnostic schema, never arbitrary OTLP.
export const CLIENT_OPERATIONS = ['room.join', 'room.recover', 'chat.send', 'microphone.activate',
  'microphone.publish', 'screen.capture', 'screen.publish', 'media.prepare', 'media.subscribe',
  'media.recover', 'sfu.signal', 'client.exception']
export const CLIENT_OUTCOMES = ['success', 'error', 'cancelled', 'denied']
export const CLIENT_REASONS = ['HTTP_ERROR', 'UnknownError', 'DOMException', 'AbortError', 'NetworkError',
  'NotAllowedError', 'NotFoundError', 'NotReadableError', 'SecurityError', 'InvalidStateError', 'OperationError',
  'TimeoutError', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'Error']

export function validTraceparent(value) {
  return typeof value === 'string' && /^00-(?!0{32}-)[a-f0-9]{32}-(?!0{16}-)[a-f0-9]{16}-0[01]$/.test(value)
}

// Discard exception messages, absolute paths, URL hosts/query strings and anonymous/eval frames.
// Only bounded source basenames and positions survive; source maps can resolve these offline.
export function diagnosticStack(stack) {
  if (typeof stack !== 'string') return undefined
  const frames = stack.slice(0, 16_384).split('\n').slice(1, 25).flatMap((line) => {
    const match = line.match(/(?:^|[ /\\(])([a-zA-Z0-9_.-]{1,100}\.(?:m?js|ts|vue))(?::(\d{1,7}):(\d{1,7}))\)?\s*$/)
    return match ? [`at ${match[1]}:${match[2]}:${match[3]}`] : []
  }).slice(0, 12)
  return frames.length ? frames.join('\n') : undefined
}

export function validClientEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const body = value
  if (!['error', 'warn', 'info', 'debug'].includes(body.level) ||
    typeof body.event !== 'string' || !/^[a-z][a-z0-9_.-]{2,63}$/.test(body.event) ||
    typeof body.clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.clientId) ||
    !['web', 'desktop'].includes(body.platform) ||
    (body.code !== undefined && (typeof body.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(body.code))) ||
    (body.reason !== undefined && (typeof body.reason !== 'string' || (!CLIENT_REASONS.includes(body.reason) && !/^[1-5]\d\d$/.test(body.reason)))) ||
    (body.attempt !== undefined && (!Number.isInteger(body.attempt) || body.attempt < 0 || body.attempt > 1000)) ||
    (body.version !== undefined && (typeof body.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]{1,32})?$/.test(body.version))) ||
    (body.stack !== undefined && (typeof body.stack !== 'string' || body.stack.length > 1600 ||
      !/^at [a-zA-Z0-9_.-]{1,100}\.(?:m?js|ts|vue):\d{1,7}:\d{1,7}(?:\nat [a-zA-Z0-9_.-]{1,100}\.(?:m?js|ts|vue):\d{1,7}:\d{1,7}){0,11}$/.test(body.stack)))) return false
  if (body.span !== undefined) {
    const span = body.span
    if (!span || typeof span !== 'object' || Array.isArray(span) || !CLIENT_OPERATIONS.includes(span.name) ||
      !validTraceparent(span.traceparent) || (span.parent !== undefined &&
        (!validTraceparent(span.parent) || span.parent.slice(3, 35) !== span.traceparent.slice(3, 35))) ||
      !CLIENT_OUTCOMES.includes(span.outcome) || !Number.isFinite(span.startedAt) ||
      span.startedAt < Date.now() - 3_600_000 || span.startedAt > Date.now() + 300_000 ||
      !Number.isFinite(span.durationMs) || span.durationMs < 0 || span.durationMs > 300_000) return false
  }
  return true
}
