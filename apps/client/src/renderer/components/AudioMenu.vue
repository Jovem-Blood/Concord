<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId } from 'vue'
import VolumeSlider from './VolumeSlider.vue'

withDefaults(defineProps<{
  label: string; volume: number; muted: boolean; muteLabel: string; disabled?: boolean; hover?: boolean
}>(), { disabled: false, hover: false })
const emit = defineEmits<{ volume: [value: number]; toggle: []; opened: [] }>()
const root = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)
let suppressFocus = false
const menuId = useId()
let closeTimer: ReturnType<typeof setTimeout> | undefined
let returnFocus: HTMLElement | null = null

function keepOpen(): void { clearTimeout(closeTimer) }
function close(): void { keepOpen(); menu.value?.hidePopover() }
function scheduleClose(): void {
  keepOpen()
  closeTimer = setTimeout(() => {
    if (!menu.value?.matches(':focus-within')) close()
  }, 180)
}
function position(x: number, y: number, upwards: boolean): void {
  if (!menu.value) return
  const bounds = menu.value.getBoundingClientRect()
  menu.value.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
  menu.value.style.top = `${Math.max(8, Math.min(upwards ? y - bounds.height - 8 : y, window.innerHeight - bounds.height - 8))}px`
}
async function showAt(x: number, y: number, upwards = false, focus = false): Promise<void> {
  keepOpen()
  await nextTick()
  if (!menu.value?.isConnected) return
  menu.value.showPopover()
  position(x, y, upwards)
  if (focus) menu.value.querySelector<HTMLElement>('button, input')?.focus()
}
function showHover(): void {
  const bounds = root.value?.getBoundingClientRect()
  if (bounds) void showAt(bounds.left, bounds.top, true)
}
function openAt(event: MouseEvent | KeyboardEvent): void {
  event.preventDefault()
  returnFocus = event.currentTarget as HTMLElement
  const bounds = returnFocus.getBoundingClientRect()
  void showAt(event instanceof MouseEvent ? event.clientX : bounds.left,
    event instanceof MouseEvent ? event.clientY : bounds.bottom, false, true)
}
function escape(event: KeyboardEvent): void {
  event.preventDefault(); close(); returnFocus?.focus()
}
function onToggle(event: Event): void {
  open.value = (event as ToggleEvent).newState === 'open'
  if (open.value) emit('opened')
}
function onBeforeToggle(event: Event): void {
  if ((event as ToggleEvent).newState !== 'closed') return
  // Native popovers restore focus to the trigger when closing.
  suppressFocus = true
  queueMicrotask(() => { suppressFocus = false })
}
defineExpose({ openAt, close })
onBeforeUnmount(keepOpen)
</script>

<template>
  <div ref="root" class="audio-menu-anchor" @pointerenter="hover && showHover()" @pointerleave="hover && scheduleClose()" @focusin="hover && !suppressFocus && showHover()" @click="hover && showHover()">
    <slot :open="open" :menu-id="menuId" />
    <div
      :id="menuId" ref="menu" popover="auto" class="audio-settings-menu" role="dialog" :aria-label="label"
      @toggle="onToggle" @beforetoggle="onBeforeToggle"
      @pointerenter="keepOpen" @pointerleave="hover && scheduleClose()" @focusout="hover && scheduleClose()"
      @click.stop @contextmenu.prevent.stop @keydown.esc.stop="escape"
    >
      <strong class="audio-menu-title">{{ label }}</strong>
      <label class="audio-menu-toggle">
        <span>{{ muteLabel }}</span>
        <span class="switch"><input type="checkbox" :checked="muted" :disabled="disabled" @change="emit('toggle')"><span /></span>
      </label>
      <VolumeSlider :model-value="volume" label="Volume" @update:model-value="emit('volume', $event)" />
      <slot name="options" />
    </div>
  </div>
</template>
