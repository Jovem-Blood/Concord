// Check the optional Grafana reference after building apps/server.
// Uses only synthetic diagnostic data; no SFU requests or real room content.
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { createTelemetry } from '../apps/server/dist/telemetry.js'

const grafana = (process.env.GRAFANA_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const password = process.env.GRAFANA_ADMIN_PASSWORD
if (!password || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  throw new Error('Set GRAFANA_ADMIN_PASSWORD and OTEL_EXPORTER_OTLP_ENDPOINT for the test reference.')
}
const headers = { authorization: `Basic ${Buffer.from(`${process.env.GRAFANA_ADMIN_USER ?? 'admin'}:${password}`).toString('base64')}`,
  accept: 'application/json' }
async function get(path) {
  const response = await fetch(`${grafana}${path}`, { headers, signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`Grafana request failed: ${response.status} ${path}`)
  return response.json()
}
async function eventually(check, label) {
  let lastFailure = 'empty response'
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if (await check()) { console.log(`${label}: OK`); return } }
    catch (error) { lastFailure = error.message }
    await delay(1000)
  }
  throw new Error(`${label}: data did not become available (${lastFailure})`)
}

const telemetry = await createTelemetry(process.env, {}, true)
try {
  const span = telemetry.requestStarted('GET', '/telemetry-check')
  if (!span) throw new Error('Telemetry is disabled.')
  const traceId = span.spanContext().traceId
  await telemetry.withSpan(span, () => telemetry.operation('sfu.check', async () => undefined))
  telemetry.requestFinished(span, 'GET', '/telemetry-check', 200, 10)
  const clientTraceId = randomUUID().replaceAll('-', '')
  telemetry.recordClient({ event: 'telemetry.check', level: 'error', clientId: randomUUID(), platform: 'web', version: '1.0.0',
    code: 'OBSERVABILITY_CHECK', reason: 'TypeError', stack: 'at telemetry-check.js:1:1',
    span: { name: 'client.exception', traceparent: `00-${clientTraceId}-${randomUUID().replaceAll('-', '').slice(0, 16)}-01`,
      startedAt: Date.now() - 10, durationMs: 10, outcome: 'error' } })
  await telemetry.flush()
  const hasTrace = async (id) => {
    const response = await get(`/api/datasources/proxy/uid/concord-tempo/api/traces/${id}`)
    return Boolean(response.batches?.length || response.resourceSpans?.length)
  }
  await eventually(() => hasTrace(traceId), 'Server trace')
  await eventually(() => hasTrace(clientTraceId), 'Client exception trace')
  await eventually(async () => {
    const result = await get(`/api/datasources/proxy/uid/concord-prometheus/api/v1/query?query=${encodeURIComponent('concord_server_heartbeat')}`)
    return result.data?.result?.some((series) => Number(series.value[1]) === 1)
  }, 'Heartbeat metric')
  await eventually(async () => {
    const query = `{service_name="concord-server.client.web"} |= "telemetry.check" | trace_id = "${clientTraceId}"`
    const result = await get(`/api/datasources/proxy/uid/concord-loki/loki/api/v1/query_range?query=${encodeURIComponent(query)}`)
    return Boolean(result.data?.result?.length)
  }, 'Client error log')
  const dashboard = await get('/api/dashboards/uid/concord-overview')
  if (dashboard.dashboard?.panels?.length !== 6) throw new Error('Dashboard provisioning failed')
  for (const panel of dashboard.dashboard.panels) {
    const path = panel.type === 'logs' ? '/api/datasources/proxy/uid/concord-loki/loki/api/v1/query_range?query=' :
      '/api/datasources/proxy/uid/concord-prometheus/api/v1/query?query='
    const response = await get(path + encodeURIComponent(panel.targets[0].expr))
    if (response.status !== 'success') throw new Error(`Invalid dashboard query: ${panel.title}`)
  }
  for (const name of ['concord_operations_total', 'concord_client_errors_total', 'concord_operation_duration_seconds_bucket',
    'concord_http_requests_total', 'concord_server_memory_bytes']) {
    await eventually(async () => Boolean((await get(`/api/datasources/proxy/uid/concord-prometheus/api/v1/query?query=${name}`)).data?.result?.length), name)
  }
  console.log('Dashboard: OK')
  const rules = await get('/api/v1/provisioning/alert-rules')
  if (rules.filter((rule) => rule.uid.startsWith('concord-')).length !== 3) throw new Error('Alert provisioning failed')
  console.log('Alert rules: OK')
} finally { await telemetry.shutdown() }
