import { appendFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { MediaDiagnosticLog } from './media-diagnostic-log.js'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'concord-media-log-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

it('rotates concurrent appends in order within a shared byte budget, including after a restart', async () => {
  const sample = (index: number) => ({ index: String(index).padStart(2, '0'), note: 'á'.repeat(50) })
  const rowBytes = Buffer.byteLength(JSON.stringify(sample(0)) + '\n')
  const maxBytes = rowBytes * 4
  const log = new MediaDiagnosticLog(directory, maxBytes)
  await Promise.all(Array.from({ length: 10 }, (_, index) => log.append(sample(index))))
  const previous = join(directory, 'previous.ndjson')
  const current = join(directory, 'current.ndjson')
  const indices = async (path: string) => (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line).index)
  expect(await indices(previous)).toEqual(['06', '07'])
  expect(await indices(current)).toEqual(['08', '09'])
  await new MediaDiagnosticLog(directory, maxBytes).append(sample(10))
  expect(await indices(previous)).toEqual(['08', '09'])
  expect(await indices(current)).toEqual(['10'])
  expect((await stat(previous)).size + (await stat(current)).size).toBeLessThanOrEqual(maxBytes)
  expect((await readdir(directory)).sort()).toEqual(['current.ndjson', 'previous.ndjson'])
})

it('recovers interrupted rows and rejects oversize records without evicting valid ones', async () => {
  const current = join(directory, 'current.ndjson')
  const log = new MediaDiagnosticLog(directory, 1024)
  await log.append({ id: 1 })
  await appendFile(current, '{"id":')
  const restarted = new MediaDiagnosticLog(directory, 1024)
  await expect(restarted.append({ data: 'x'.repeat(600) })).rejects.toMatchObject({ statusCode: 413 })
  await restarted.append({ id: 2 })
  expect(await readFile(current, 'utf8')).toBe('{"id":1}\n{"id":2}\n')
})

it('enforces a newly reduced budget for existing files even before any sample arrives', async () => {
  await writeFile(join(directory, 'previous.ndjson'), 'x'.repeat(600))
  await writeFile(join(directory, 'current.ndjson'), 'x'.repeat(600))
  await new MediaDiagnosticLog(directory, 512).prepare()
  expect(await readdir(directory)).toEqual(['current.ndjson'])
  expect((await stat(join(directory, 'current.ndjson'))).size).toBe(0)
})
