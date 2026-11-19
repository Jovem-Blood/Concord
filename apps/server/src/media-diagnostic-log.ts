import { constants } from 'node:fs'
import { appendFile, mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export const MEDIA_REPORT_BODY_LIMIT = 64 * 1024

// The room authority and this volume have a single API process as their writer.
export class MediaDiagnosticLog {
  private readonly current: string
  private readonly previous: string
  private size = 0
  private initialized = false
  private pending = 0
  private writes = Promise.resolve()

  constructor(private readonly directory: string, private readonly maxBytes: number) {
    this.current = join(directory, 'current.ndjson')
    this.previous = join(directory, 'previous.ndjson')
  }

  async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    // A lower configured ceiling also applies to segments from a previous run.
    for (const file of [this.previous, this.current]) {
      try {
        if ((await stat(file)).size > Math.floor(this.maxBytes / 2)) await unlink(file)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    const file = await open(this.current, constants.O_CREAT | constants.O_RDWR, 0o600)
    try {
      this.size = (await file.stat()).size
      if (this.size) {
        // A crash or full disk can leave an incomplete last append. NDJSON rows are
        // bounded, so only the tail needs to be read to recover the last newline.
        const tail = Buffer.alloc(Math.min(this.size, MEDIA_REPORT_BODY_LIMIT + 1024))
        const start = this.size - tail.length
        const { bytesRead } = await file.read(tail, 0, tail.length, start)
        const last = tail.subarray(0, bytesRead).lastIndexOf(10)
        const complete = last < 0 ? 0 : start + last + 1
        if (complete !== this.size) { await file.truncate(complete); this.size = complete }
      }
    } finally { await file.close() }
    this.initialized = true
  }

  async append(entry: object): Promise<void> {
    const line = Buffer.from(JSON.stringify(entry) + '\n')
    const segmentBytes = Math.floor(this.maxBytes / 2)
    if (line.length > Math.min(segmentBytes, MEDIA_REPORT_BODY_LIMIT + 1023)) {
      throw Object.assign(new Error('Media sample exceeds storage limit'), { statusCode: 413 })
    }
    if (this.pending >= 64) throw Object.assign(new Error('Media sample queue full'), { statusCode: 429 })
    this.pending++
    const write = this.writes.then(async () => {
      if (!this.initialized) await this.prepare()
      if (this.size + line.length > segmentBytes) {
        await rename(this.current, this.previous)
        this.size = 0
      }
      await appendFile(this.current, line, { mode: 0o600 })
      this.size += line.length
    }).catch((error: unknown) => {
      this.initialized = false
      throw error
    }).finally(() => { this.pending-- })
    this.writes = write.catch(() => {})
    return write
  }
}
