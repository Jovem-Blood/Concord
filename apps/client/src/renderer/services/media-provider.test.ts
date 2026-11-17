import { afterEach, expect, it, vi } from 'vitest'
import { SelectableMediaService } from './media-provider'
import type { MediaService } from './room-session'

afterEach(() => vi.unstubAllGlobals())
const credentials = { participantToken: 'token', identity: 'alice', expiresAt: Date.now() + 60_000 }
function fixture() {
  const media = { connect: vi.fn(), disconnect: vi.fn(), onSnapshot: vi.fn(), onConnection: vi.fn(),
    updatePresence: vi.fn(), setSignalingAvailable: vi.fn() }
  const create = vi.fn(() => media as unknown as MediaService)
  return { media, create, service: new SelectableMediaService(create) }
}
it.each(['livekit', 'cloudflare'])('uses the server-selected %s provider and forwards lifecycle', async provider => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ provider }))))
  const { service, media, create } = fixture()
  await service.connect(credentials)
  expect(create).toHaveBeenCalledWith(provider)
  expect(media.connect).toHaveBeenCalledWith(credentials)
  service.setSignalingAvailable(true)
  expect(media.setSignalingAvailable).toHaveBeenCalledWith(true)
  await service.disconnect()
  expect(media.disconnect).toHaveBeenCalledOnce()
})
it('rejects unknown providers rather than silently using a different SFU', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"provider":"unknown"}')))
  const { service, create } = fixture()
  await expect(service.connect(credentials)).rejects.toThrow('Provedor')
  expect(create).not.toHaveBeenCalled()
})
it('does not start a provider after a pending join has been cancelled', async () => {
  let finish!: (response: Response) => void
  const pending = new Promise<Response>(resolve => { finish = resolve })
  const fetcher = vi.fn(() => pending)
  vi.stubGlobal('fetch', fetcher)
  const { service, create } = fixture()
  const joining = service.connect(credentials)
  const rejected = expect(joining).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalled())
  await service.disconnect()
  finish(new Response('{"provider":"livekit"}'))
  await rejected
  expect(create).not.toHaveBeenCalled()
})
