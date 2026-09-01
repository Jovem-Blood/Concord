export type MediaSource = 'microphone' | 'screen-video' | 'screen-audio'

export function validMediaSource(source: unknown, kind: unknown): source is MediaSource {
  return source === 'screen-video' ? kind === 'video' :
    (source === 'microphone' || source === 'screen-audio') && kind === 'audio'
}
