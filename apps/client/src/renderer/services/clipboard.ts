export async function writeClipboard(value: string): Promise<void> {
  if (window.clipboardAPI) {
    await window.clipboardAPI.writeText(value)
    return
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copiedSuccessfully = document.execCommand('copy')
  textarea.remove()
  if (!copiedSuccessfully) throw new Error('Clipboard unavailable')
}
