export const SOUND_NAMES = [
  'join',
  'leave',
  'microphone-on',
  'microphone-off',
  'chat-notification',
  'screen-open',
  'screen-close',
] as const

export type SoundName = (typeof SOUND_NAMES)[number]
export type ChatNotificationState = { notification: number; open: boolean }
export type PageAttention = { hidden: boolean; focused: boolean }

type ParticipantIdentity = { identity: string; isLocal: boolean }
type AudioFactory = (source: string) => HTMLAudioElement

const soundFiles = import.meta.glob<string>('../assets/sounds/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
})

const knownSoundNames = new Set<string>(SOUND_NAMES)
const bundledSounds = new Map<SoundName, string>()

for (const [path, source] of Object.entries(soundFiles)) {
  const segments = path.split('/')
  const name = segments[segments.length - 1]?.replace(/\.mp3$/u, '')
  if (name && knownSoundNames.has(name)) bundledSounds.set(name as SoundName, source)
}

export function createSoundPlayer(
  sources: ReadonlyMap<SoundName, string> = bundledSounds,
  createAudio: AudioFactory = (source) => new Audio(source),
) {
  const players = new Map<SoundName, HTMLAudioElement>()

  function player(name: SoundName, source: string): HTMLAudioElement {
    const cached = players.get(name)
    if (cached) return cached
    const audio = createAudio(source)
    audio.preload = 'auto'
    audio.volume = 0.6
    audio.addEventListener('error', () => { if (players.get(name) === audio) players.delete(name) }, { once: true })
    players.set(name, audio)
    return audio
  }

  return {
    prepare(name: SoundName): boolean {
      const source = sources.get(name)
      if (!source) return false
      const audio = player(name, source)
      audio.muted = true
      void audio.play().then(() => {
        audio.pause()
        audio.currentTime = 0
        audio.muted = false
      }).catch(() => { audio.muted = false })
      return true
    },
    play(name: SoundName): boolean {
      const source = sources.get(name)
      if (!source) return false
      const audio = player(name, source)
      audio.muted = false
      audio.volume = 0.6
      audio.currentTime = 0
      void audio.play().catch(() => undefined)
      return true
    },
  }
}

export const soundPlayer = createSoundPlayer()

export function shouldPlayChatNotification(
  previous: ChatNotificationState,
  next: ChatNotificationState,
  page: PageAttention,
): boolean {
  return next.notification > previous.notification && (!next.open || page.hidden || !page.focused)
}

export class PresenceSoundNotifier {
  private remoteParticipantIds: Set<string> | null = null

  constructor(private readonly play: (name: SoundName) => unknown = (name) => soundPlayer.play(name)) {}

  update(participants: readonly ParticipantIdentity[]): void {
    const nextIds = new Set(participants.filter((participant) => !participant.isLocal).map((participant) => participant.identity))
    const previousIds = this.remoteParticipantIds
    this.remoteParticipantIds = nextIds
    if (!previousIds) return

    if ([...nextIds].some((identity) => !previousIds.has(identity))) this.play('join')
    if ([...previousIds].some((identity) => !nextIds.has(identity))) this.play('leave')
  }

  reset(): void {
    this.remoteParticipantIds = null
  }
}
