import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createTelemetry } from './telemetry.js'

const config = loadConfig()
const telemetry = await createTelemetry(process.env, {}, true).catch(async () => {
  // A bad observability configuration must not stop rooms from working; never print exporter secrets.
  console.error('OpenTelemetry configuration failed; continuing with telemetry disabled.')
  return createTelemetry({ OTEL_SDK_DISABLED: 'true' })
})
const app = await buildApp(config, undefined, telemetry)
let stopping = false
async function shutdown(): Promise<void> {
  if (stopping) return
  stopping = true
  try { await app.close() } catch (error) { app.log.error(error); process.exitCode = 1 }
  await telemetry.shutdown()
}
process.once('SIGTERM', () => void shutdown())
process.once('SIGINT', () => void shutdown())

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  await telemetry.shutdown()
  process.exitCode = 1
}
