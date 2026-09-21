import { expect, it, vi } from 'vitest'

it('queues offline errors and sends only classified diagnostics after reconnecting', async () => {
  const listeners = new Map<string, () => void>()
  const network = { onLine: false }
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    void url; void init
    return { ok: true, status: 204 }
  })
  vi.stubGlobal('window', { addEventListener: (name: string, listener: () => void) => listeners.set(name, listener) })
  vi.stubGlobal('navigator', network)
  vi.stubGlobal('fetch', fetcher)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  try {
    const { logClient } = await import('./telemetry')
    logClient('error', 'room.join.failed', { error: new Error('private room ABCD2345; Bearer secret'), code: 'ROOM_TOKEN_FAILED' })
    expect(fetcher).not.toHaveBeenCalled()
    network.onLine = true
    listeners.get('online')?.()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    const body = JSON.parse(fetcher.mock.calls[0]![1].body as string)
    expect(body).toMatchObject({ level: 'error', event: 'room.join.failed', code: 'ROOM_TOKEN_FAILED', reason: 'Error' })
    expect(JSON.stringify(body)).not.toContain('ABCD2345')
    expect(JSON.stringify(body)).not.toContain('secret')
  } finally {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  }
})
