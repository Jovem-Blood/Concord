import { context, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { AlwaysOffSampler, AlwaysOnSampler, BasicTracerProvider, BatchSpanProcessor, ParentBasedSampler, RandomIdGenerator,
  SamplingDecision, TraceIdRatioBasedSampler, type SpanExporter } from '@opentelemetry/sdk-trace-base'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { MeterProvider, PeriodicExportingMetricReader, type PushMetricExporter } from '@opentelemetry/sdk-metrics'
import { BatchLogRecordProcessor, LoggerProvider, type LogRecordExporter } from '@opentelemetry/sdk-logs'
import { CLIENT_REASONS, diagnosticStack, validTraceparent, type ClientEvent } from '@concord/protocol'

type Signal = 'traces' | 'metrics' | 'logs'
type Exporters = { traces?: () => SpanExporter; metrics?: () => PushMetricExporter; logs?: () => LogRecordExporter }
const signals: Signal[] = ['traces', 'metrics', 'logs']
const levels = { debug: 5, info: 9, warn: 13, error: 17 }

export function telemetrySettings(environment: NodeJS.ProcessEnv) {
  const endpoints = Object.fromEntries(signals.map((signal) => [signal,
    environment[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`] || environment.OTEL_EXPORTER_OTLP_ENDPOINT]))
  const enabled = environment.OTEL_SDK_DISABLED !== 'true' && signals.some((signal) =>
    endpoints[signal] && environment[`OTEL_${signal.toUpperCase()}_EXPORTER`] !== 'none')
  const ratio = Number(environment.OTEL_TRACES_SAMPLER_ARG ?? 1)
  if (enabled && (!Number.isFinite(ratio) || ratio < 0 || ratio > 1)) throw new Error('Invalid OTEL_TRACES_SAMPLER_ARG')
  const sampler = environment.OTEL_TRACES_SAMPLER ?? 'parentbased_traceidratio'
  if (enabled && !['always_on', 'always_off', 'traceidratio', 'parentbased_always_on', 'parentbased_always_off', 'parentbased_traceidratio'].includes(sampler)) {
    throw new Error('Unsupported OTEL_TRACES_SAMPLER')
  }
  return { enabled, endpoints, sampler, sampleRatio: sampler.includes('always_off') ? 0 : sampler.includes('always_on') ? 1 : ratio,
    serviceName: environment.OTEL_SERVICE_NAME ?? 'concord-server' }
}

function spanContext(traceparent?: string) {
  if (!validTraceparent(traceparent)) return undefined
  return { traceId: traceparent.slice(3, 35), spanId: traceparent.slice(36, 52),
    traceFlags: Number.parseInt(traceparent.slice(53), 16), isRemote: true }
}

function errorDetails(error: unknown): Attributes {
  const name = error instanceof Error ? error.name : 'UnknownError'
  const candidate = error as { status?: unknown; code?: unknown; cause?: { code?: unknown } } | null
  const networkCode = candidate?.cause?.code ?? candidate?.code
  const knownNetworkCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET']
  return { 'exception.type': CLIENT_REASONS.includes(name) || name === 'UpstreamHttpError' ? name : 'Error',
    ...(typeof networkCode === 'string' && knownNetworkCodes.includes(networkCode) ? { 'error.type': networkCode } : {}),
    ...(typeof candidate?.status === 'number' && Number.isInteger(candidate.status) && candidate.status >= 100 && candidate.status <= 599 ?
      { 'concord.upstream.status_code': candidate.status } : {}),
    ...(error instanceof Error && diagnosticStack(error.stack) ? { 'exception.stacktrace': diagnosticStack(error.stack)! } : {}) }
}

// Overrides are used by export integration tests; production uses official OTLP exporters.
export async function createTelemetry(environment: NodeJS.ProcessEnv = process.env, overrides: Exporters = {}, register = false) {
  const settings = telemetrySettings(environment)
  const resourceAttributes: Attributes = { 'service.name': settings.serviceName,
    'service.version': environment.OTEL_SERVICE_VERSION ?? '1.0.0',
    'deployment.environment.name': environment.NODE_ENV ?? 'development' }
  for (const pair of (environment.OTEL_RESOURCE_ATTRIBUTES ?? '').split(',')) {
    const separator = pair.indexOf('=')
    if (separator > 0) resourceAttributes[pair.slice(0, separator).trim()] = decodeURIComponent(pair.slice(separator + 1).trim())
  }
  const resource = resourceFromAttributes(resourceAttributes)
  const exporters: Exporters = { ...overrides }
  for (const signal of signals) {
    if (!settings.enabled || !settings.endpoints[signal] || environment[`OTEL_${signal.toUpperCase()}_EXPORTER`] === 'none') {
      delete exporters[signal]; continue
    }
    const protocol = environment[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_PROTOCOL`] || environment.OTEL_EXPORTER_OTLP_PROTOCOL || 'http/protobuf'
    if (!['http/protobuf', 'http/json', 'grpc'].includes(protocol)) throw new Error('Unsupported OTLP protocol')
    // Exporters honor standard signal-specific endpoints and authentication headers.
    // Passing URLs explicitly also makes per-instance configuration testable.
    const specific = environment[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`]
    const base = environment.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, '')
    const url = specific || (protocol === 'grpc' ? base : `${base}/v1/${signal}`)
    const headers: Record<string, string> = {}
    for (const pair of (environment[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_HEADERS`] || environment.OTEL_EXPORTER_OTLP_HEADERS || '').split(',')) {
      const separator = pair.indexOf('=')
      if (separator > 0) headers[pair.slice(0, separator).trim()] = decodeURIComponent(pair.slice(separator + 1).trim())
    }
    const metadata = protocol === 'grpc' ? new (await import('@grpc/grpc-js')).Metadata() : undefined
    if (metadata) for (const [name, value] of Object.entries(headers)) metadata.set(name, value)
    const config = { url, headers, ...(metadata ? { metadata } : {}), timeoutMillis: 3000 }
    const suffix = protocol === 'grpc' ? 'grpc' : protocol === 'http/json' ? 'http' : 'proto'
    if (signal === 'traces' && !exporters.traces) {
      const module = suffix === 'grpc' ? await import('@opentelemetry/exporter-trace-otlp-grpc') : suffix === 'http' ?
        await import('@opentelemetry/exporter-trace-otlp-http') : await import('@opentelemetry/exporter-trace-otlp-proto')
      exporters.traces = () => new module.OTLPTraceExporter(config)
    }
    if (signal === 'metrics' && !exporters.metrics) {
      const module = suffix === 'grpc' ? await import('@opentelemetry/exporter-metrics-otlp-grpc') : suffix === 'http' ?
        await import('@opentelemetry/exporter-metrics-otlp-http') : await import('@opentelemetry/exporter-metrics-otlp-proto')
      exporters.metrics = () => new module.OTLPMetricExporter(config)
    }
    if (signal === 'logs' && !exporters.logs) {
      const module = suffix === 'grpc' ? await import('@opentelemetry/exporter-logs-otlp-grpc') : suffix === 'http' ?
        await import('@opentelemetry/exporter-logs-otlp-http') : await import('@opentelemetry/exporter-logs-otlp-proto')
      exporters.logs = () => new module.OTLPLogExporter(config)
    }
  }
  const batchOptions = { maxQueueSize: 512, maxExportBatchSize: 64, scheduledDelayMillis: 1000, exportTimeoutMillis: 3000 }
  const processors = () => settings.enabled && exporters.traces ? [new BatchSpanProcessor(exporters.traces(), batchOptions)] : []
  const rootSampler = settings.sampler.endsWith('always_off') ? new AlwaysOffSampler() : settings.sampler.endsWith('always_on') ?
    new AlwaysOnSampler() : new TraceIdRatioBasedSampler(settings.sampleRatio)
  const provider = new NodeTracerProvider({ resource, spanProcessors: processors(),
    sampler: settings.sampler.startsWith('parentbased') ? new ParentBasedSampler({ root: rootSampler }) : rootSampler,
    spanLimits: { attributeCountLimit: 32, attributeValueLengthLimit: 1600 } })
  const contextManager = register && settings.enabled ? new AsyncLocalStorageContextManager().enable() : undefined
  if (contextManager) provider.register({ contextManager })
  const tracer = provider.getTracer('concord')
  const logProvider = new LoggerProvider({ resource, processors: settings.enabled && exporters.logs ?
    [new BatchLogRecordProcessor({ exporter: exporters.logs(), ...batchOptions })] : [] })
  const logger = logProvider.getLogger('concord')
  const metricProvider = new MeterProvider({ resource, readers: settings.enabled && exporters.metrics ?
    [new PeriodicExportingMetricReader({ exporter: exporters.metrics(), exportIntervalMillis: 15_000, exportTimeoutMillis: 3000 })] : [] })
  const meter = metricProvider.getMeter('concord')
  const requests = meter.createCounter('concord.http.requests', { description: 'Completed HTTP requests' })
  const requestDuration = meter.createHistogram('concord.http.duration', { unit: 's' })
  const operationCount = meter.createCounter('concord.operations', { description: 'Completed operations, independent of trace sampling' })
  const operationDuration = meter.createHistogram('concord.operation.duration', { unit: 's' })
  const errors = meter.createCounter('concord.client.errors', { description: 'Client error reports' })
  meter.createObservableGauge('concord.server.heartbeat').addCallback((result) => result.observe(1))
  meter.createObservableGauge('concord.server.uptime', { unit: 's' }).addCallback((result) => result.observe(process.uptime()))
  meter.createObservableGauge('concord.server.memory', { unit: 'By' }).addCallback((result) => result.observe(process.memoryUsage().rss))

  // A finished client span is materialized synchronously using its original IDs.
  // This preserves the parent of HTTP spans that have already been exported.
  const randomIds = new RandomIdGenerator()
  let replay: ClientEvent['span']
  const idGenerator = { generateTraceId: () => replay?.traceparent.slice(3, 35) ?? randomIds.generateTraceId(),
    generateSpanId: () => replay?.traceparent.slice(36, 52) ?? randomIds.generateSpanId() }
  const clientProviders = Object.fromEntries(['web', 'desktop'].map((platform) => [platform, new BasicTracerProvider({
    resource: resourceFromAttributes({ ...resourceAttributes, 'service.name': `${settings.serviceName}.client.${platform}` }),
    idGenerator, spanProcessors: processors(), sampler: { shouldSample: () => ({ decision:
      settings.sampler !== 'always_off' && replay?.traceparent.endsWith('01') ? SamplingDecision.RECORD_AND_SAMPLED : SamplingDecision.NOT_RECORD }),
    toString: () => 'ClientSampling' }, spanLimits: { attributeCountLimit: 32, attributeValueLengthLimit: 1600 },
  })]))
  const clientLogProviders = Object.fromEntries(['web', 'desktop'].map((platform) => [platform, new LoggerProvider({
    resource: resourceFromAttributes({ ...resourceAttributes, 'service.name': `${settings.serviceName}.client.${platform}` }),
    processors: settings.enabled && exporters.logs ? [new BatchLogRecordProcessor({ exporter: exporters.logs(), ...batchOptions })] : [],
  })]))
  function failure(span: Span | undefined, error: unknown): void {
    const details = errorDetails(error)
    span?.setAttributes(details)
    span?.setStatus({ code: SpanStatusCode.ERROR, message: String(details['exception.type']) })
    span?.addEvent('exception', details)
  }
  function event(level: ClientEvent['level'], name: string, attributes: Attributes = {}, error?: unknown, parent = context.active(), writer = logger): void {
    if (!settings.enabled) return
    writer.emit({ body: name, severityNumber: levels[level], severityText: level.toUpperCase(), context: parent,
      attributes: { 'event.name': name, ...attributes, ...(error === undefined ? {} : errorDetails(error)) } })
  }
  const telemetry = {
    enabled: settings.enabled,
    clientConfig: { enabled: settings.enabled, traces: Boolean(settings.enabled && exporters.traces), sampleRatio: settings.sampleRatio },
    requestStarted(method: string, route: string, parent?: string): Span | undefined {
      if (!settings.enabled || ['/health', '/v1/client-events', '/v1/telemetry'].includes(route)) return undefined
      const remote = spanContext(parent)
      return tracer.startSpan(`${method} ${route}`, { kind: SpanKind.SERVER,
        attributes: { 'http.request.method': method, 'http.route': route } },
      remote ? trace.setSpanContext(ROOT_CONTEXT, remote) : ROOT_CONTEXT)
    },
    withSpan<T>(span: Span | undefined, action: () => T): T {
      return span ? context.with(trace.setSpan(context.active(), span), action) : action()
    },
    requestFinished(span: Span | undefined, method: string, route: string, status: number, durationMs: number): void {
      if (!settings.enabled || ['/v1/client-events', '/v1/telemetry'].includes(route)) return
      const attributes = { 'http.request.method': method, 'http.route': route, 'http.response.status_code': status }
      requests.add(1, attributes); requestDuration.record(durationMs / 1000, attributes)
      span?.setAttribute('http.response.status_code', status)
      if (status >= 500) span?.setStatus({ code: SpanStatusCode.ERROR })
      span?.end()
    },
    failure, event,
    socketOperation<T>(name: string, parent: string | undefined, action: () => T): T {
      if (!settings.enabled) return action()
      const remote = spanContext(parent)
      const span = tracer.startSpan(name, { kind: SpanKind.SERVER }, remote ? trace.setSpanContext(ROOT_CONTEXT, remote) : ROOT_CONTEXT)
      const started = performance.now()
      return telemetry.withSpan(span, () => {
        let outcome = 'success'
        try { return action() } catch (error) { outcome = 'error'; failure(span, error); throw error }
        finally {
          const dimensions = { operation: name, outcome, platform: 'server' }
          operationCount.add(1, dimensions); operationDuration.record((performance.now() - started) / 1000, dimensions); span.end()
        }
      })
    },
    async operation<T>(name: string, action: () => Promise<T>): Promise<T> {
      if (!settings.enabled) return action()
      const started = performance.now()
      return tracer.startActiveSpan(name, { kind: name.startsWith('sfu.') ? SpanKind.CLIENT : SpanKind.INTERNAL }, async (span) => {
        let outcome = 'success'
        try { return await action() } catch (error) {
          outcome = 'error'; failure(span, error); event('error', `${name}.failed`, {}, error); throw error
        } finally {
          operationCount.add(1, { operation: name, outcome, platform: 'server' })
          operationDuration.record((performance.now() - started) / 1000, { operation: name, outcome, platform: 'server' })
          span.end()
        }
      })
    },
    recordClient(body: ClientEvent): void {
      if (!settings.enabled) return
      const attributes: Attributes = { 'client.platform': body.platform, 'client.id': body.clientId,
        ...(body.version ? { 'client.version': body.version } : {}), ...(body.code ? { 'error.code': body.code } : {}),
        ...(body.reason ? { 'exception.type': body.reason } : {}), ...(body.stack ? { 'exception.stacktrace': body.stack } : {}) }
      let parent = ROOT_CONTEXT
      if (body.span) {
        const info = body.span
        replay = info
        try {
          const remote = spanContext(info.parent)
          const span = clientProviders[body.platform]!.getTracer('concord-client').startSpan(info.name, {
            startTime: info.startedAt, attributes: { ...attributes, 'concord.outcome': info.outcome } },
          remote ? trace.setSpanContext(ROOT_CONTEXT, remote) : ROOT_CONTEXT)
          parent = trace.setSpan(ROOT_CONTEXT, span)
          if (info.outcome === 'error') {
            span.setStatus({ code: SpanStatusCode.ERROR, message: body.reason ?? body.code ?? 'Error' })
            span.addEvent('exception', { 'exception.type': body.reason ?? 'Error',
              ...(body.stack ? { 'exception.stacktrace': body.stack } : {}) })
          }
          span.end(info.startedAt + info.durationMs)
        } finally { replay = undefined }
        const dimensions = { operation: info.name, outcome: info.outcome, platform: body.platform }
        operationCount.add(1, dimensions); operationDuration.record(info.durationMs / 1000, dimensions)
      }
      // Never use client-provided event names, IDs, stacks or versions as metric dimensions.
      if (body.level === 'error' && !['NotAllowedError', 'SecurityError', 'AbortError'].includes(body.reason ?? '') &&
        !['CAPTURE_CANCELLED', 'CAPTURE_PERMISSION_DENIED'].includes(body.code ?? '')) errors.add(1, { platform: body.platform })
      event(body.level, body.event, attributes, undefined, parent, clientLogProviders[body.platform]!.getLogger('concord-client'))
    },
    async flush(): Promise<void> {
      await Promise.allSettled([provider.forceFlush(), logProvider.forceFlush(), metricProvider.forceFlush(),
        ...Object.values(clientProviders).map((client) => client.forceFlush()),
        ...Object.values(clientLogProviders).map((client) => client.forceFlush())])
    },
    async shutdown(): Promise<void> {
      await Promise.allSettled([provider.shutdown(), logProvider.shutdown(), metricProvider.shutdown(),
        ...Object.values(clientProviders).map((client) => client.shutdown()),
        ...Object.values(clientLogProviders).map((client) => client.shutdown())])
      contextManager?.disable()
    },
  }
  return telemetry
}

export type Telemetry = Awaited<ReturnType<typeof createTelemetry>>
