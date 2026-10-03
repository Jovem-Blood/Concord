import { afterEach, expect, it, vi } from 'vitest'
import { waitForIceGathering } from './ice'

class GatheringPeer extends EventTarget {
  iceGatheringState = 'gathering'
  connectionState = 'new'
  localDescription = { sdp: 'v=0\r\n' }
  get pc() { return this as unknown as RTCPeerConnection }
}

afterEach(() => vi.useRealTimers())

it('waits for gathering completion and removes listeners', async () => {
  const peer = new GatheringPeer()
  const removed = vi.spyOn(peer, 'removeEventListener')
  const completed = vi.fn()
  const gathering = waitForIceGathering(peer.pc, new AbortController().signal).then(completed)
  await Promise.resolve()
  expect(completed).not.toHaveBeenCalled()
  peer.iceGatheringState = 'complete'
  peer.dispatchEvent(new Event('icegatheringstatechange'))
  await gathering
  expect(completed).toHaveBeenCalledOnce()
  expect(removed).toHaveBeenCalledWith('icegatheringstatechange', expect.any(Function))
})

it('uses partial candidates after the bounded wait', async () => {
  vi.useFakeTimers()
  const peer = new GatheringPeer()
  peer.localDescription.sdp += 'a=candidate:synthetic-test-candidate\r\n'
  const gathering = waitForIceGathering(peer.pc, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(10_000)
  await expect(gathering).resolves.toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})

it('reports a timeout when no candidate is gathered', async () => {
  vi.useFakeTimers()
  const peer = new GatheringPeer()
  const rejected = expect(waitForIceGathering(peer.pc, new AbortController().signal))
    .rejects.toMatchObject({ name: 'TimeoutError' })
  await vi.advanceTimersByTimeAsync(10_000)
  await rejected
})

it('cancels gathering and clears the timeout when the session leaves', async () => {
  vi.useFakeTimers()
  const peer = new GatheringPeer()
  const controller = new AbortController()
  const rejected = expect(waitForIceGathering(peer.pc, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await rejected
  expect(vi.getTimerCount()).toBe(0)
  peer.iceGatheringState = 'complete'
  await expect(waitForIceGathering(peer.pc, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})

it('rejects gathering when the peer is closed', async () => {
  vi.useFakeTimers()
  const peer = new GatheringPeer()
  const rejected = expect(waitForIceGathering(peer.pc, new AbortController().signal)).rejects.toThrow('closed')
  peer.connectionState = 'closed'
  peer.dispatchEvent(new Event('connectionstatechange'))
  await rejected
  expect(vi.getTimerCount()).toBe(0)
})
