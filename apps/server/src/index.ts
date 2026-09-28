import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()
const app = await buildApp(config)
let stopping = false
async function shutdown(): Promise<void> {
  if (stopping) return
  stopping = true
  try { await app.close() } catch (error) { app.log.error(error); process.exitCode = 1 }
}
process.once('SIGTERM', () => void shutdown())
process.once('SIGINT', () => void shutdown())

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  process.exitCode = 1
}
