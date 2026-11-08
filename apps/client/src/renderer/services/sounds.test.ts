import { describe, expect, it, vi } from 'vitest'
import { createSoundPlayer, PresenceSoundNotifier, shouldPlayChatNotification, type SoundName } from './sounds'

describe('named sounds', () => {
  it('plays a bundled sound by name and ignores names without a file', async () => {
    const play = vi.fn(async () => undefined)
    const audio = {
      addEventListener: vi.fn(),
      play,
      pause: vi.fn(),
      currentTime: 10,
      muted: false,
      preload: '',
      volume: 1,
    } as unknown as HTMLAudioElement
    const createAudio = vi.fn(() => audio)
    const sources = new Map<SoundName, string>([['join', 'join.mp3']])
    const player = createSoundPlayer(sources, createAudio)

    expect(player.play('join')).toBe(true)
    expect(player.play('microphone-on')).toBe(false)
    expect(createAudio).toHaveBeenCalledWith('join.mp3')
    expect(audio.preload).toBe('auto')
    expect(audio.volume).toBe(0.6)
    expect(play).toHaveBeenCalledOnce()
  })

  it('prepares and reuses a notification player after a user gesture', async () => {
    const audio = {
      addEventListener: vi.fn(), play: vi.fn(async () => undefined), pause: vi.fn(),
      currentTime: 10, muted: false, preload: '', volume: 1,
    } as unknown as HTMLAudioElement
    const createAudio = vi.fn(() => audio)
    const player = createSoundPlayer(new Map<SoundName, string>([['chat-notification', 'chat.mp3']]), createAudio)

    expect(player.prepare('chat-notification')).toBe(true)
    await Promise.resolve()
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(audio.currentTime).toBe(0)
    expect(audio.muted).toBe(false)

    expect(player.play('chat-notification')).toBe(true)
    expect(createAudio).toHaveBeenCalledOnce()
    expect(audio.play).toHaveBeenCalledTimes(2)
  })

  it('sounds only when a new message arrives outside the visible focused chat', () => {
    const previous = { notification: 2, open: true }
    expect(shouldPlayChatNotification(previous, { notification: 3, open: true }, { hidden: false, focused: true })).toBe(false)
    expect(shouldPlayChatNotification(previous, { notification: 3, open: false }, { hidden: false, focused: true })).toBe(true)
    expect(shouldPlayChatNotification(previous, { notification: 3, open: true }, { hidden: true, focused: false })).toBe(true)
    expect(shouldPlayChatNotification(previous, { notification: 3, open: true }, { hidden: false, focused: false })).toBe(true)
    expect(shouldPlayChatNotification(previous, { notification: 2, open: false }, { hidden: true, focused: false })).toBe(false)
  })

  it('notifies only when remote participants enter or leave after the baseline', () => {
    const play = vi.fn()
    const notifier = new PresenceSoundNotifier(play)
    const local = { identity: 'local', isLocal: true }
    const alice = { identity: 'alice', isLocal: false }
    const bruno = { identity: 'bruno', isLocal: false }

    notifier.update([local, alice])
    notifier.update([local, alice, bruno])
    notifier.update([local, alice, bruno])
    notifier.update([local, bruno])

    expect(play.mock.calls).toEqual([['join'], ['leave']])

    notifier.reset()
    notifier.update([local, alice])
    expect(play).toHaveBeenCalledTimes(2)
  })
})
