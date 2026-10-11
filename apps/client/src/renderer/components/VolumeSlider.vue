<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ modelValue: number; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const dragging = ref(false)
</script>

<template>
  <label class="volume-control">
    <span>{{ label }}</span>
    <span class="volume-slider" :class="{ dragging }" :style="{ '--volume': `${modelValue}%` }">
      <output class="volume-value">{{ modelValue }}%</output>
      <input
        type="range" min="0" max="100" step="1" :value="modelValue" :aria-label="label" :aria-valuetext="`${modelValue}%`"
        @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
        @pointerdown="dragging = true" @pointerup="dragging = false" @pointercancel="dragging = false" @lostpointercapture="dragging = false"
      />
    </span>
  </label>
</template>
