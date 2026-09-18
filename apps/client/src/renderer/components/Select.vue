<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'

type SelectOption = { value: string; label: string; description?: string }

const props = withDefaults(defineProps<{
  label: string
  modelValue: string
  options: readonly SelectOption[]
  disabled?: boolean
}>(), { disabled: false })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)
const baseId = useId()
const labelId = `${baseId}-label`
const listboxId = `${baseId}-listbox`
const selected = computed(() => props.options.find((option) => option.value === props.modelValue) ?? props.options[0])

function optionId(index: number): string { return `${baseId}-option-${index}` }

function focusOption(): void {
  void nextTick(() => root.value?.querySelector<HTMLElement>(`#${CSS.escape(optionId(activeIndex.value))}`)?.focus())
}

function show(direction: 1 | -1 = 1): void {
  if (props.disabled || props.options.length === 0) return
  const selectedIndex = props.options.findIndex((option) => option.value === props.modelValue)
  activeIndex.value = selectedIndex >= 0 ? selectedIndex : direction > 0 ? 0 : props.options.length - 1
  open.value = true
  focusOption()
}

function close(restoreFocus = false): void {
  open.value = false
  if (restoreFocus) void nextTick(() => trigger.value?.focus())
}

function select(option: SelectOption): void {
  emit('update:modelValue', option.value)
  close(true)
}

function move(amount: number): void {
  activeIndex.value = (activeIndex.value + amount + props.options.length) % props.options.length
  focusOption()
}

function onTriggerKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    show(event.key === 'ArrowDown' ? 1 : -1)
  } else if ((event.key === 'Enter' || event.key === ' ') && !props.disabled) {
    event.preventDefault()
    if (open.value) close()
    else show()
  }
}

function onOptionKeydown(event: KeyboardEvent, option: SelectOption): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    move(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    activeIndex.value = event.key === 'Home' ? 0 : props.options.length - 1
    focusOption()
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    select(option)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    close(true)
  } else if (event.key === 'Tab') {
    close()
  }
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) close()
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <div ref="root" class="platform-select" :class="{ disabled }">
    <span :id="labelId" class="platform-select-label">{{ label }}</span>
    <button
      ref="trigger"
      type="button"
      class="platform-select-trigger"
      role="combobox"
      aria-haspopup="listbox"
      :aria-labelledby="labelId"
      :aria-controls="listboxId"
      :aria-expanded="open"
      :aria-activedescendant="open ? optionId(activeIndex) : undefined"
      :disabled="disabled"
      @click="open ? close() : show()"
      @keydown="onTriggerKeydown"
    >
      <span class="platform-select-value">
        <strong>{{ selected?.label }}</strong>
        <small v-if="selected?.description">{{ selected.description }}</small>
      </span>
      <span class="platform-select-chevron" aria-hidden="true" />
    </button>
    <div v-if="open" :id="listboxId" class="platform-select-menu" role="listbox" :aria-labelledby="labelId">
      <button
        v-for="(option, index) in options"
        :id="optionId(index)"
        :key="option.value"
        type="button"
        class="platform-select-option"
        role="option"
        :aria-selected="option.value === modelValue"
        :data-active="index === activeIndex"
        @focus="activeIndex = index"
        @click="select(option)"
        @keydown="onOptionKeydown($event, option)"
      >
        <span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span>
        <span v-if="option.value === modelValue" class="platform-select-check" aria-hidden="true">✓</span>
      </button>
    </div>
  </div>
</template>
