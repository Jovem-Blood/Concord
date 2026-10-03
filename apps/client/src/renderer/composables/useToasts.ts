import { onBeforeUnmount, ref } from 'vue'

export type Toast = { id: number; message: string; tone: 'error' | 'notice' }

export function useToasts() {
  const toasts = ref<Toast[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let nextId = 0
  function remove(id: number): void {
    clearTimeout(timers.get(id))
    timers.delete(id)
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }
  function notify(message: string, tone: Toast['tone'] = 'notice'): void {
    if (!message) return
    const duplicate = toasts.value.find((toast) => toast.message === message && toast.tone === tone)
    if (duplicate) remove(duplicate.id)
    const id = ++nextId
    toasts.value.push({ id, message, tone })
    if (toasts.value.length > 3) remove(toasts.value[0]!.id)
    timers.set(id, setTimeout(() => remove(id), tone === 'error' ? 10_000 : 7_000))
  }
  onBeforeUnmount(() => { timers.forEach(clearTimeout); timers.clear() })
  return { toasts, notify }
}
