const DICEBEAR_URL = 'https://api.dicebear.com/10.x/initial-face/svg'
const DICEBEAR_OPTIONS = 'animationVariant=fast:0,fastest:1,medium:0,none:1,slow:0,slowest:0&backgroundColorAngle=360&backgroundColorFill=linear'

export function avatarUrl(name: string): string {
  const seed = name.trim().normalize('NFC') || 'Concord'
  return `${DICEBEAR_URL}?${DICEBEAR_OPTIONS}&seed=${encodeURIComponent(seed)}`
}
