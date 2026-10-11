export type AudioLevel = { volume: number; muted: boolean }

export function playbackLevel(master: number, deafened: boolean, level?: AudioLevel): AudioLevel {
  return { volume: master * (level?.volume ?? 100) / 10_000, muted: deafened || Boolean(level?.muted) }
}
