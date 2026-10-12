import { afterEach, expect, it, vi } from 'vitest'
import type { ClientEvent } from '@concord/protocol'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
async function fixture(enabled = true) {
  vi.resetModules()
  const listeners = new Map<string, () => void>()
  const network = { onLine: false }
  const reports: ClientEvent[] = []
  vi.stubGlobal('window', { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback) })
  vi.stubGlobal('navigator', network)
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/telemetry')) return new Response(JSON.stringify({ enabled, traces: enabled, sampleRatio: 1 }))
    const body = JSON.parse(init!.body as string) as ClientEvent | ClientEvent[]
    reports.push(...Array.isArray(body) ? body : [body])
    return new Response(null, { status: 204 })
  })
  vi.stubGlobal('fetch', fetcher)
  for (const method of ['info', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => undefined)
  const telemetry = await import('./telemetry')
  await telemetry.initializeClientTelemetry()
  return { ...telemetry, reports, fetcher, online() { network.onLine = true; listeners.get('online')?.() } }
}

it('correlates nested operations, reports sanitized exceptions and ends each operation once', async () => {
  const telemetry = await fixture()
  const root = telemetry.startClientOperation('microphone.activate')
  const child = telemetry.startClientOperation('microphone.publish', root.traceparent)
  const error = new TypeError('Private name, room ABCD2345; Bearer secret')
  error.stack = 'TypeError: Private name\n at publish (https://private.example/assets/index-123.js:20:3)'
  child.end(error); child.end(error); root.end(error)
  expect(telemetry.reports).toHaveLength(0)
  telemetry.online()
  await vi.waitFor(() => expect(telemetry.reports).toHaveLength(2))
  expect(telemetry.reports[0]).toMatchObject({ reason: 'TypeError', stack: 'at index-123.js:20:3',
    span: { name: 'microphone.publish', parent: root.traceparent, outcome: 'error' } })
  expect(telemetry.reports[0]!.span!.traceparent.slice(3, 35)).toBe(root.traceparent!.slice(3, 35))
  const serialized = JSON.stringify(telemetry.reports)
  for (const secret of ['Private', 'ABCD2345', 'Bearer', 'private.example']) expect(serialized).not.toContain(secret)
})

it('separates permission denial and cancellation from technical errors', async () => {
  const telemetry = await fixture()
  telemetry.startClientOperation('screen.capture').end(new DOMException('Permission denied', 'NotAllowedError'))
  telemetry.startClientOperation('screen.capture').end(new DOMException('Cancelled', 'AbortError'))
  telemetry.online()
  await vi.waitFor(() => expect(telemetry.reports).toHaveLength(2))
  expect(telemetry.reports.map((report) => report.span!.outcome)).toEqual(['denied', 'cancelled'])
  expect(telemetry.reports.every((report) => report.level === 'info')).toBe(true)
})

it('does not add operation reporting or trace headers when the host disables observability', async () => {
  const telemetry = await fixture(false)
  const operation = telemetry.startClientOperation('chat.send')
  expect(operation.traceparent).toBeUndefined()
  operation.end(new Error('Failed'))
  telemetry.online()
  await Promise.resolve()
  expect(telemetry.reports).toHaveLength(0)
})

it('bounds the offline queue and drains it in batches', async () => {
  const telemetry = await fixture()
  for (let index = 0; index < 80; index++) telemetry.startClientOperation('chat.send').end()
  telemetry.online()
  await vi.waitFor(() => expect(telemetry.reports).toHaveLength(40))
  expect(telemetry.fetcher.mock.calls.filter(([url]) => url.endsWith('/v1/client-events'))).toHaveLength(2)
})
