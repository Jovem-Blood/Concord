export function trustedRendererUrl(url: string, rendererUrl: string): boolean {
  try {
    const candidate = new URL(url)
    const renderer = new URL(rendererUrl)
    return candidate.origin === renderer.origin && candidate.pathname === renderer.pathname &&
      candidate.protocol === renderer.protocol && candidate.host === renderer.host
  } catch { return false }
}
export function microphonePermission(permission: string, mainFrame: boolean, url: string,
  rendererUrl: string, mediaTypes: readonly string[]): boolean {
  return permission === 'media' && mainFrame && trustedRendererUrl(url, rendererUrl) &&
    mediaTypes.length === 1 && mediaTypes[0] === 'audio'
}

export function displayCapturePermission(permission: string, mainFrame: boolean, url: string,
  rendererUrl: string, mediaTypes: readonly string[], hasSelection: boolean): boolean {
  // Electron 44 reports display capture as `media` with no camera/microphone types.
  // Newer Electron versions use the dedicated `display-capture` permission.
  return mainFrame && trustedRendererUrl(url, rendererUrl) && hasSelection &&
    (permission === 'display-capture' || (permission === 'media' && mediaTypes.length === 0))
}
