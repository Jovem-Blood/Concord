import { describe, expect, it, vi } from 'vitest'
import { createSoundPlayer, PresenceSoundNotifier, type SoundName } from './sounds'

describe('named sounds', () => {
  it('plays a bundled sound by name and ignores names without a file', async () => {
    const play = vi.fn(async () => undefined)
    const audio = {
      addEventListener: vi.fn(),
      play,
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
