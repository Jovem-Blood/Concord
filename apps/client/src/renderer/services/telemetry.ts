import { AppError } from '../../shared/errors'
import { serverUrl } from './server'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'
type ClientEvent = {
  level: LogLevel
  event: string
  clientId: string
  platform: 'web' | 'desktop'
  code?: string
  reason?: string
  attempt?: number
}

const clientId = crypto.randomUUID()
const browser = typeof window !== 'undefined'
const platform = browser && window.captureAPI ? 'desktop' : 'web'
const levels: LogLevel[] = ['error', 'warn', 'info', 'debug']
const configuredLevel = String(import.meta.env.VITE_LOG_LEVEL ?? 'info') as LogLevel
const consoleLevel = levels.includes(configuredLevel) ? configuredLevel : 'info'
const pending: ClientEvent[] = []
let sending = false
let retryTimer: ReturnType<typeof setTimeout> | undefined

function reasonFor(error: unknown): string {
  const known = new Set(['AbortError', 'NetworkError', 'NotAllowedError', 'NotFoundError', 'NotReadableError',
    'SecurityError', 'InvalidStateError', 'OperationError', 'TimeoutError', 'TypeError', 'RangeError',
    'SyntaxError', 'ReferenceError', 'Error'])
  if (error instanceof DOMException) return known.has(error.name) ? error.name : 'DOMException'
  if (error instanceof Error) {
    if (error.name === 'SignalingError') return error.message.match(/\b[1-5]\d\d\b/)?.[0] ?? 'HTTP_ERROR'
    if (error instanceof AppError && error.cause) return reasonFor(error.cause)
    return known.has(error.name) ? error.name : 'Error'
  }
  return 'UnknownError'
}

async function flush(): Promise<void> {
  if (!browser || sending || !pending.length || !navigator.onLine) return
  sending = true
  try {
    while (pending.length) {
      const response = await fetch(`${serverUrl}/v1/client-events`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pending[0]), signal: AbortSignal.timeout(5000),
      })
      if (response.status === 400) { pending.shift(); continue }
      if (!response.ok) break
      pending.shift()
    }
  } catch {
    // An offline report remains queued until the API is reachable again.
  } finally {
    sending = false
    if (pending.length && navigator.onLine) {
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => { void flush() }, 15_000)
    }
  }
}

if (browser) window.addEventListener('online', () => { void flush() })

export function logClient(level: LogLevel, event: string, options: { error?: unknown; code?: string; attempt?: number } = {}): void {
  const reason = options.error === undefined ? undefined : reasonFor(options.error)
  const entry: ClientEvent = { level, event, clientId, platform,
    ...(options.code ? { code: options.code } : {}), ...(reason ? { reason } : {}),
    ...(options.attempt !== undefined ? { attempt: Math.min(1000, options.attempt) } : {}) }
  if (levels.indexOf(level) <= levels.indexOf(consoleLevel)) {
    const method = level === 'debug' ? 'debug' : level === 'info' ? 'info' : level === 'warn' ? 'warn' : 'error'
    console[method](`[${level}] ${event}`, { code: options.code, reason, attempt: options.attempt, error: options.error })
  }
  if (level === 'debug' && consoleLevel !== 'debug') return
  if (pending.length >= 20) pending.shift()
  pending.push(entry)
  void flush()
}
