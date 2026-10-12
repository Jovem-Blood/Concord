import { randomUUID } from 'node:crypto'
import { diagnosticStack, type ClientEvent } from '@concord/protocol'

declare const __CONCORD_SERVER_URL__: string
const baseUrl = __CONCORD_SERVER_URL__.replace(/\/$/, '')
const clientId = randomUUID()
const pending: ClientEvent[] = []
let enabled = false
let version = '1.0.0'
let sending = false
let retryTimer: ReturnType<typeof setTimeout> | undefined

export async function initializeDesktopTelemetry(appVersion: string): Promise<void> {
  version = appVersion
  try {
    const response = await fetch(`${baseUrl}/v1/telemetry`, { signal: AbortSignal.timeout(1500) })
    if (response.ok) enabled = (await response.json() as { enabled?: boolean }).enabled === true
  } catch { /* Observability is optional. */ }
  if (enabled) await flush()
  else pending.length = 0
}

async function flush(): Promise<void> {
  if (!enabled || sending || !pending.length) return
  sending = true
  const batch = pending.slice(0, 20)
  try {
    const response = await fetch(`${baseUrl}/v1/client-events`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch), signal: AbortSignal.timeout(1500) })
    if (response.ok || response.status === 400) {
      for (const sent of batch) { const index = pending.indexOf(sent); if (index !== -1) pending.splice(index, 1) }
    }
  } catch { /* Retry while the main process is alive. */ }
  finally {
    sending = false
    clearTimeout(retryTimer)
    if (pending.length) {
      retryTimer = setTimeout(() => { void flush() }, 15_000)
      retryTimer.unref()
    }
  }
}

export async function reportDesktopError(event: string, error?: unknown, code?: string): Promise<void> {
  const stack = error instanceof Error ? diagnosticStack(error.stack) : undefined
  if (pending.length >= 20) pending.shift()
  pending.push({ level: 'error', event, clientId, platform: 'desktop', version, reason: 'Error',
    ...(stack ? { stack } : {}), ...(code ? { code } : {}) })
  await flush()
}
