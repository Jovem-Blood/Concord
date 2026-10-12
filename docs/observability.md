# Optional OpenTelemetry

Concord exports traces, application metrics and selected diagnostic logs using standard OTLP. Without an OTLP endpoint, export stays disabled. The default Compose requires no observability backend. Export failures never block room operations.

## Bring your own backend

Configure the server environment (or the root `.env` for Docker):

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-collector.example.com
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20your-token
OTEL_SERVICE_NAME=concord-server
OTEL_SERVICE_VERSION=1.0.0
```

Supported transports: `http/protobuf`, `http/json` and `grpc`. A common HTTP endpoint is a base URL: Concord appends `/v1/traces`, `/v1/metrics` and `/v1/logs`. For gRPC, use the gRPC receiver, such as `http://collector:4317` internally or `https://collector.example.com:4317` with TLS. Headers are comma-separated `key=value` pairs; percent-encode values containing spaces, commas or equals signs.

Each signal supports `OTEL_EXPORTER_OTLP_<SIGNAL>_ENDPOINT`, `_PROTOCOL` and `_HEADERS`, where `<SIGNAL>` is `TRACES`, `METRICS` or `LOGS`. Signal-specific HTTP endpoints include the complete signal path. Empty overrides inherit common values. Set `OTEL_TRACES_EXPORTER=none`, `OTEL_METRICS_EXPORTER=none` or `OTEL_LOGS_EXPORTER=none` to disable a signal, or `OTEL_SDK_DISABLED=true` to disable everything.

`OTEL_RESOURCE_ATTRIBUTES` adds metadata, for example `deployment.environment.name=production`. `/v1/telemetry` exposes enabled/tracing flags, sampling ratio and server time to correct client clock skew. Exporter addresses, headers and credentials stay server-side.

## Optional Grafana reference

Set `GRAFANA_ADMIN_PASSWORD` in the root `.env`, then run:

```sh
docker compose -f docker-compose.yml -f docker-compose.observability.yml up -d --build
```

Open `http://localhost:3000`, sign in as `admin` with your password, then open **Dashboards → Concord → Concord — Operações e erros**. In **Explore**, select Concord Traces or Concord Logs. Logs and traces are linked by trace ID.

The override adds Grafana, monolithic Tempo, Loki, Alloy and Prometheus. Neither Kafka nor Mimir is required. Grafana and OTLP host ports bind only to loopback; use your authenticated proxy or SSH tunnel for remote access. `GRAFANA_PORT`, `OTLP_HTTP_PORT` and `OTLP_GRPC_PORT` change host ports. Concord sends to Alloy on the Compose network. Leave signal-specific endpoints unset with this reference.

Named volumes persist data. Trace blocks and logs have 72-hour retention; metrics have 15-day retention and a 1 GB size limit. Container memory and Docker logs are bounded. This is a small single-host reference: tune memory, disk, retention and backups for your usage. Tempo/Loki retention limits age, not maximum disk usage. Image versions are pinned and should be updated deliberately.

The dashboard shows operation results/platforms, client errors, p95 duration, HTTP responses, server memory and recent errors. Alerts cover repeated client errors, repeated HTTP 5xx errors and missing API telemetry. Thresholds are starting points. The heartbeat rule assumes `OTEL_SERVICE_NAME=concord-server`; adjust it if you rename the service.

**Notifications require a destination.** Configure Grafana **Alerting → Contact points** and **Notification policies** for your channel. Rules alone do not send notifications. Configure uptime checks outside this host as well: Grafana on the same host cannot report that the entire host disappeared.

To return to the base deployment, recreate the server using only `docker-compose.yml` to remove the override's destination. Stop observability containers independently, retaining their volumes if diagnostics should be preserved.

## Coverage and privacy

Client spans cover room join/recovery, chat confirmation/retries, microphone activation/publication, screen capture/publication, media preparation/recovery and SFU signaling. Permission denial and cancellation are separate outcomes from technical errors. No trace spans the entire lifetime of a room.

The client propagates `traceparent` into join/media HTTP requests and chat messages. The API materializes completed client spans with their original IDs, attaching server descendants to the originating operation. Trace metadata never enters delivered chat messages or room history. Client services are `<OTEL_SERVICE_NAME>.client.web` and `.client.desktop`; `client.version` records the actual package version.

Renderer uncaught errors, unhandled rejections and Vue errors are reported. Desktop exceptions, renderer termination and load failures are reported after runtime telemetry discovery. Screen/microphone/remote-track endings, signaling failures and WebRTC failures produce events. These describe observed conditions, which may not reveal their causes.

Server traces cover HTTP, Socket.IO chat/sync/renew/confirm and Cloudflare SFU/TURN calls. SFU traces describe Concord's requests, not Cloudflare internals. Operation names exclude app/session IDs. HTTP routes are templates rather than raw URLs. Ingestion and capability requests are excluded from HTTP tracing/metrics to avoid recursion.

Exceptions contain classified types and bounded source basenames/line/column locations. Exception messages, URL hosts/queries and absolute paths are discarded. Names, room codes, credentials, device IDs, SDP and chat content are not exported. Invalid batches are rejected before processing; unknown report fields are ignored. Reports are anonymous, untrusted diagnostics, not an audit log.

Metric dimensions use bounded operation/outcome/platform values. Client IDs, arbitrary event names, versions and stacks are never metric labels. OTLP logs contain sanitized client diagnostics and server HTTP/SFU/Socket.IO failures, not all stdout/Pino output. Local logs remain available with telemetry disabled.

Queues are bounded and held in memory. The renderer retains at most 40 reports, sends batches of at most 20, retries after outages and tries a page-hide beacon. Reports can be lost on close, hard crash, queue overflow or prolonged disconnection. Desktop delivery retries only while its process lives. Final-event delivery on hard crashes is not guaranteed.

## Sampling and limits

All traces are sampled by default. For about 10% of roots, set `OTEL_TRACES_SAMPLER=parentbased_traceidratio` and `OTEL_TRACES_SAMPLER_ARG=0.1`. Descendants preserve parent sampling. `always_on`, `always_off`, `traceidratio`, `parentbased_always_on` and `parentbased_always_off` are also supported. Metrics/error logs are independent of trace retention. Head sampling can discard a later-failing operation; keeping every failed trace requires a collector sampling policy.

Source-map upload/symbolication, WebRTC quality statistics and synthetic end-to-end media calls are not included. Keep matching builds and private source maps for offline investigation of minified stack locations.

## Validation

Tests cover real authenticated OTLP JSON/protobuf export, client IDs/parents, unsampled operation metrics, disabled telemetry, backend rejection, schema/stack sanitization, queue bounds and permission outcomes. Validate actual media with two clients. `/health` only confirms that the API responds.

After building the server, run `node scripts/check-observability.mjs` with `OTEL_EXPORTER_OTLP_ENDPOINT`, `GRAFANA_URL`, `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` set to a test reference installation. It emits a diagnostic sample and checks trace/log/metric ingestion and provisioned dashboards/rules; it does not exercise media or send a notification.
