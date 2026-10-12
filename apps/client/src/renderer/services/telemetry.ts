import { AppError } from '../../shared/errors'
import { serverUrl } from './server'
import { diagnosticStack, type ClientEvent, type ClientOperationName, type ClientOutcome, type ClientSpan } from '@concord/protocol'
import packageMetadata from '../../../package.json'

export type LogLevel = 'error' | 'warn' | 'info' | 'debug'
export type ClientOperation = { traceparent?: string; end: (error?: unknown, outcome?: ClientOutcome) => void }

const clientId = crypto.randomUUID()
const browser = typeof window !== 'undefined'
const platform = browser && window.captureAPI ? 'desktop' : 'web'
const levels: LogLevel[] = ['error', 'warn', 'info', 'debug']
const configuredLevel = String(import.meta.env.VITE_LOG_LEVEL ?? 'info') as LogLevel
const consoleLevel = levels.includes(configuredLevel) ? configuredLevel : 'info'
const pending: ClientEvent[] = []
let sending = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
let flushTimer: ReturnType<typeof setTimeout> | undefined
let telemetryEnabled = false
let tracesEnabled = false
let sampleRatio = 0
let serverClockOffset = 0
let configRequested = false

export async function initializeClientTelemetry(): Promise<void> {
  if (!browser) return
  configRequested = true
  try {
    const response = await fetch(`${serverUrl}/v1/telemetry`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!response.ok) return
    const config = await response.json() as { enabled?: boolean; traces?: boolean; sampleRatio?: number; serverTime?: number }
    telemetryEnabled = config.enabled === true
    tracesEnabled = config.traces === true
    sampleRatio = typeof config.sampleRatio === 'number' && config.sampleRatio >= 0 && config.sampleRatio <= 1 ? config.sampleRatio : 1
    serverClockOffset = typeof config.serverTime === 'number' && Number.isFinite(config.serverTime) ? config.serverTime - Date.now() : 0
  } catch { /* Older/offline servers retain the original classified reporting behavior. */ }
}

function spanFor(name: ClientOperationName, parent?: string): ClientSpan {
  const traceId = parent?.slice(3, 35) ?? crypto.randomUUID().replace(/-/g, '')
  const sampled = parent ? parent.endsWith('01') : tracesEnabled && Number.parseInt(traceId.slice(-8), 16) / 0x1_0000_0000 < sampleRatio
  return { name, traceparent: `00-${traceId}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}-${sampled ? '01' : '00'}`,
    ...(parent ? { parent } : {}), startedAt: Date.now() + serverClockOffset, durationMs: 0, outcome: 'success' }
}

export function startClientOperation(name: ClientOperationName, parent?: string): ClientOperation {
  if (!telemetryEnabled) return { end: () => undefined }
  const span = spanFor(name, parent)
  const started = performance.now()
  let ended = false
  return { traceparent: span.traceparent, end(error, outcome) {
    if (ended) return
    ended = true
    span.durationMs = Math.max(0, Math.min(300_000, performance.now() - started))
    span.outcome = outcome ?? errorOutcome(error)
    logClient(span.outcome === 'error' ? 'error' : 'info', `${name}.completed`, { error, span })
  } }
}

function errorOutcome(error: unknown): ClientOutcome {
  if (error === undefined) return 'success'
  const reason = reasonFor(error)
  if (reason === 'AbortError' || (error instanceof AppError && error.code === 'CAPTURE_CANCELLED')) return 'cancelled'
  if (reason === 'NotAllowedError' || reason === 'SecurityError' ||
    (error instanceof AppError && error.code === 'CAPTURE_PERMISSION_DENIED')) return 'denied'
  return 'error'
}

export async function traceClientOperation<T>(name: ClientOperationName, action: (operation: ClientOperation) => Promise<T>, parent?: string): Promise<T> {
  const operation = startClientOperation(name, parent)
  try { const result = await action(operation); operation.end(); return result }
  catch (error) { operation.end(error); throw error }
}

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
  clearTimeout(flushTimer); flushTimer = undefined
  clearTimeout(retryTimer); retryTimer = undefined
  sending = true
  try {
    while (pending.length) {
      const batch = pending.slice(0, 20)
      const response = await fetch(`${serverUrl}/v1/client-events`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch.length === 1 ? batch[0] : batch), signal: AbortSignal.timeout(5000),
      })
      if (!response.ok && response.status !== 400) break
      for (const sent of batch) {
        const index = pending.indexOf(sent)
        if (index !== -1) pending.splice(index, 1)
      }
    }
  } catch {
    // An offline report remains queued until the API is reachable again.
  } finally {
    sending = false
    if (pending.length && navigator.onLine) {
      clearTimeout(retryTimer)
      retryTimer = setTimeout(() => { retryTimer = undefined; void flush() }, 15_000)
    }
  }
}

function scheduleFlush(): void {
  if (!browser || sending || flushTimer || retryTimer || !navigator.onLine) return
  flushTimer = setTimeout(() => { flushTimer = undefined; void flush() }, 250)
}

if (browser) {
  window.addEventListener('online', () => { if (configRequested) void initializeClientTelemetry(); void flush() })
  window.addEventListener('pagehide', () => {
    if (pending.length && navigator.sendBeacon) {
      // Keep the bounded queue intact if the browser declines the beacon.
      const batch = pending.slice(0, 20)
      try { navigator.sendBeacon(`${serverUrl}/v1/client-events`, new Blob([JSON.stringify(batch)], { type: 'application/json' })) }
      catch { /* Closing the page must not depend on telemetry delivery. */ }
    }
  })
}

export function logClient(level: LogLevel, event: string, options: { error?: unknown; code?: string; attempt?: number; span?: ClientSpan } = {}): void {
  const reason = options.error === undefined ? undefined : reasonFor(options.error)
  const code = options.code ?? (options.error instanceof AppError ? options.error.code : undefined)
  const cause = options.error instanceof AppError ? options.error.cause : undefined
  const stack = telemetryEnabled && options.error instanceof Error ? diagnosticStack(
    options.error instanceof AppError && options.error.cause instanceof Error ? options.error.cause.stack : options.error.stack) : undefined
  const outcome = errorOutcome(options.error)
  const upstreamLevel = outcome === 'denied' || outcome === 'cancelled' ? 'info' : level
  const span = options.span ?? (telemetryEnabled && outcome === 'error' ?
    { ...spanFor('client.exception'), outcome: 'error' as const } : undefined)
  const entry: ClientEvent = { level: upstreamLevel, event, clientId, platform, version: packageMetadata.version,
    ...(code ? { code } : {}), ...(reason ? { reason } : {}),
    ...(stack ? { stack } : {}), ...(span ? { span } : {}),
    ...(options.attempt !== undefined ? { attempt: Math.min(1000, options.attempt) } : {}) }
  if (levels.indexOf(level) <= levels.indexOf(consoleLevel)) {
    const method = level === 'debug' ? 'debug' : level === 'info' ? 'info' : level === 'warn' ? 'warn' : 'error'
    // Expose the underlying failure locally; upstream reports remain classified only.
    console[method](`[${level}] ${event}`, { code, reason, attempt: options.attempt, error: options.error,
      ...(options.error instanceof Error ? { errorMessage: options.error.message } : {}),
      ...(cause === undefined ? {} : { cause,
        ...(cause instanceof Error ? { causeMessage: cause.message } : {}) }) })
  }
  if (level === 'debug' && consoleLevel !== 'debug') return
  if (pending.length >= 40) {
    const expendable = pending.findIndex((report) => report.level === 'info' || report.level === 'debug')
    if (expendable === -1 && (entry.level === 'info' || entry.level === 'debug')) return
    pending.splice(Math.max(0, expendable), 1)
  }
  pending.push(entry)
  scheduleFlush()
}
