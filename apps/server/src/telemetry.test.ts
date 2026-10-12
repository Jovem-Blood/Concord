import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { Server as GrpcServer, ServerCredentials, type ServerUnaryCall, type sendUnaryData } from '@grpc/grpc-js'
import { context, trace } from '@opentelemetry/api'
import { diagnosticStack, PROTOCOL_VERSION, validClientEvent, validTraceparent, type ClientEvent } from '@concord/protocol'
import { createTelemetry, telemetrySettings, type Telemetry } from './telemetry.js'
import { buildApp } from './app.js'
import { UpstreamHttpError } from './sfu.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  context.disable(); trace.disable(); vi.unstubAllEnvs()
})

const traceparent = `00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`
function report(): ClientEvent {
  return { event: 'room.join.completed', level: 'info', clientId: '12345678-1234-1234-1234-123456789abc',
    platform: 'web', version: '1.0.0', span: { name: 'room.join', traceparent, startedAt: Date.now() - 100, durationMs: 100, outcome: 'success' } }
}
type ExportedSpan = { name: string; traceId: string; spanId: string; parentSpanId?: string; status: { code?: number };
  attributes: { key: string; value: { intValue?: string | number } }[] }
type TraceBody = { resourceSpans: { resource: { attributes: { key: string; value: { stringValue?: string } }[] };
  scopeSpans: { spans: ExportedSpan[] }[] }[] }

async function receiver(status = 200) {
  const received: { path: string; body: unknown; authorization?: string; contentType?: string }[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const buffer = Buffer.concat(chunks)
    received.push({ path: request.url!, body: request.headers['content-type']?.includes('json') ? JSON.parse(buffer.toString()) : buffer,
      authorization: request.headers.authorization, contentType: request.headers['content-type'] })
    response.writeHead(status, { 'content-type': 'application/json' }); response.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => close(server))
  const address = server.address() as { port: number }
  return { received, endpoint: `http://127.0.0.1:${address.port}` }
}
function close(server: Server) { return new Promise<void>((resolve) => server.close(() => resolve())) }
async function appWith(telemetry: Telemetry) {
  vi.stubEnv('LOG_LEVEL', 'silent')
  const app = await buildApp({ host: '127.0.0.1', port: 0, allowedOrigins: [], cloudflareSfu: { appId: 'test', appSecret: 'secret' } },
    { createSession: async () => ({ sessionId: 'test' }), request: async () => ({}) }, telemetry)
  cleanups.push(() => app.close())
  return app
}

describe('optional OpenTelemetry', () => {
  it('requires an explicit destination and honors the kill switch', async () => {
    expect(telemetrySettings({}).enabled).toBe(false)
    expect(telemetrySettings({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318', OTEL_SDK_DISABLED: 'true' }).enabled).toBe(false)
    const telemetry = await createTelemetry({})
    cleanups.push(() => telemetry.shutdown())
    const app = await appWith(telemetry)
    expect((await app.inject('/v1/telemetry')).json()).toMatchObject({ enabled: false, traces: false, sampleRatio: 1, serverTime: expect.any(Number) })
    expect((await app.inject('/health')).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: '/v1/join', payload: { protocol: PROTOCOL_VERSION, roomCode: 'ABCD2345', displayName: 'Private' } })).statusCode).toBe(200)
  })

  it('exports original client IDs, HTTP children, errors and metrics over authenticated OTLP JSON', async () => {
    const { endpoint, received } = await receiver()
    const telemetry = await createTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer%20test-export-key', NODE_ENV: 'test' }, {}, true)
    cleanups.push(() => telemetry.shutdown())
    const app = await appWith(telemetry)
    app.get('/test', () => telemetry.operation('sfu.test', async () => {
      const error = new UpstreamHttpError(503, 'SFU')
      error.message = 'Private room ABCD2345; Bearer app-secret'
      throw error
    }))
    expect((await app.inject({ url: '/test', headers: { traceparent } })).statusCode).toBe(500)
    const body = report()
    expect((await app.inject({ method: 'POST', url: '/v1/client-events', payload: [body, {
      ...body, event: 'client.uncaught', level: 'error', reason: 'TypeError', stack: 'at index-a1.js:10:2',
      span: { ...body.span!, name: 'client.exception', traceparent: `00-${'3'.repeat(32)}-${'4'.repeat(16)}-01`, outcome: 'error' },
      rawMessage: 'Private name; SDP; Bearer app-secret',
    }] })).statusCode).toBe(204)
    await telemetry.flush()
    const traces = received.filter((item) => item.path === '/v1/traces').flatMap((item) => (item.body as TraceBody).resourceSpans)
    const spans = traces.flatMap((item) => item.scopeSpans.flatMap((scope) => scope.spans))
    const client = spans.find((span) => span.name === 'room.join')!
    expect(client).toMatchObject({ traceId: '1'.repeat(32), spanId: '2'.repeat(16) })
    const http = spans.find((span) => span.name === 'GET /test')!
    expect(http).toMatchObject({ traceId: client.traceId, parentSpanId: client.spanId, status: { code: 2 } })
    expect(spans.find((span) => span.name === 'sfu.test')).toMatchObject({ traceId: client.traceId, parentSpanId: http.spanId })
    expect(Number(spans.find((span) => span.name === 'sfu.test')!.attributes.find((attr) => attr.key === 'concord.upstream.status_code')!.value.intValue)).toBe(503)
    expect(spans.find((span) => span.name === 'client.exception')).toMatchObject({ status: { code: 2 } })
    expect(spans.some((span) => span.name.includes('client-events'))).toBe(false)
    expect(traces.some((item) => item.resource.attributes.some((attr) => attr.key === 'service.name' && attr.value.stringValue === 'concord-server.client.web'))).toBe(true)
    const metrics = JSON.stringify(received.filter((item) => item.path === '/v1/metrics'))
    expect(metrics).toContain('concord.operations')
    expect(metrics).toContain('concord.server.heartbeat')
    expect(metrics).not.toContain(body.clientId)
    const logs = JSON.stringify(received.filter((item) => item.path === '/v1/logs'))
    expect(logs).toContain('index-a1.js:10:2')
    expect(logs).toContain('client.uncaught')
    for (const item of received) expect(item.authorization).toBe('Bearer test-export-key')
    const exported = JSON.stringify(received)
    expect(exported).not.toContain('ABCD2345'); expect(exported).not.toContain('app-secret'); expect(exported).not.toContain('rawMessage')
  })

  it('sends protobuf to signal-specific endpoints and counts unsampled client operations', async () => {
    const { endpoint, received } = await receiver()
    const telemetry = await createTelemetry({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/custom/traces`,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${endpoint}/custom/metrics`, OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: 'http/json' })
    cleanups.push(() => telemetry.shutdown())
    await telemetry.operation('sfu.test', async () => undefined)
    const body = report(); body.span!.traceparent = body.span!.traceparent.slice(0, -2) + '00'
    telemetry.recordClient(body)
    await telemetry.flush()
    expect(received.find((item) => item.path === '/custom/traces')).toMatchObject({ contentType: 'application/x-protobuf' })
    expect(JSON.stringify(received.find((item) => item.path === '/custom/metrics')?.body)).toContain('room.join')
  })

  it('exports all three signals over gRPC with configured authentication metadata', async () => {
    const server = new GrpcServer()
    const received: { signal: string; authorization: unknown[] }[] = []
    for (const signal of ['trace', 'metrics', 'logs']) {
      const service = signal === 'trace' ? 'TraceService' : signal === 'metrics' ? 'MetricsService' : 'LogsService'
      server.addService({ export: { path: `/opentelemetry.proto.collector.${signal}.v1.${service}/Export`,
        requestStream: false, responseStream: false,
        requestSerialize: (value: Buffer) => value, requestDeserialize: (value: Buffer) => value,
        responseSerialize: (value: Buffer) => value, responseDeserialize: (value: Buffer) => value,
      } }, { export: (call: ServerUnaryCall<Buffer, Buffer>, callback: sendUnaryData<Buffer>) => {
        received.push({ signal, authorization: call.metadata.get('authorization') }); callback(null, Buffer.alloc(0))
      } })
    }
    const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(),
      (error, bound) => error ? reject(error) : resolve(bound)))
    cleanups.push(() => new Promise<void>((resolve) => server.tryShutdown(() => resolve())))
    const telemetry = await createTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`, OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer%20grpc-test-key' })
    cleanups.push(() => telemetry.shutdown())
    await telemetry.operation('sfu.test', async () => undefined)
    telemetry.recordClient({ ...report(), level: 'error' })
    await telemetry.flush()
    expect(new Set(received.map((request) => request.signal))).toEqual(new Set(['trace', 'logs', 'metrics']))
    for (const request of received) expect(request.authorization).toEqual(['Bearer grpc-test-key'])
  })

  it('keeps serving requests when the OTLP backend rejects exports', async () => {
    const { endpoint } = await receiver(400)
    const telemetry = await createTelemetry({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`, OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json' })
    cleanups.push(() => telemetry.shutdown())
    const app = await appWith(telemetry)
    expect((await app.inject({ method: 'POST', url: '/v1/join', payload: { protocol: PROTOCOL_VERSION, roomCode: 'ABCD2345', displayName: 'Private' } })).statusCode).toBe(200)
    await telemetry.flush()
    expect((await app.inject('/health')).statusCode).toBe(200)
  })
})

describe('diagnostic boundary', () => {
  it('removes exception messages, URL hosts, queries and absolute paths from stacks', () => {
    expect(diagnosticStack('Error: room ABCD2345 Bearer secret\n at open (https://host/private/index-a1.js:10:2)\n at f (C:\\Users\\Private\\main.ts:12:3)\n at eval (secret)')).toBe('at index-a1.js:10:2\nat main.ts:12:3')
    expect(diagnosticStack('Error: secret\n at https://host/index.js?token=secret:1:2')).toBeUndefined()
  })
  it('rejects forged contexts, unbounded durations, sensitive stacks and unknown operations', () => {
    expect(validClientEvent(report())).toBe(true)
    expect(validTraceparent(`00-${'0'.repeat(32)}-${'1'.repeat(16)}-01`)).toBe(false)
    expect(validClientEvent({ ...report(), stack: 'Error: private room' })).toBe(false)
    expect(validClientEvent({ ...report(), span: { ...report().span, name: 'room.private-room-code' } })).toBe(false)
    expect(validClientEvent({ ...report(), span: { ...report().span, durationMs: Infinity } })).toBe(false)
    expect(validClientEvent({ ...report(), span: { ...report().span, startedAt: Date.now() - 3_600_001 } })).toBe(false)
    expect(validClientEvent({ ...report(), span: { ...report().span, parent: `00-${'3'.repeat(32)}-${'4'.repeat(16)}-01` } })).toBe(false)
  })
  it('rejects an invalid report before ingesting any item in the batch', async () => {
    const telemetry = await createTelemetry({})
    cleanups.push(() => telemetry.shutdown())
    const app = await appWith(telemetry)
    expect((await app.inject({ method: 'POST', url: '/v1/client-events', payload: [report(), { ...report(), stack: 'Bearer secret' }] })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/v1/client-events', payload: Array(21).fill(report()) })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/v1/client-events', payload: { ...report(), span: undefined } })).statusCode).toBe(204)
  })
})
