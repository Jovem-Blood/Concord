<script setup lang="ts">
import type { Toast } from '../composables/useToasts'
defineProps<{ toasts: Toast[] }>()
</script>

<template>
  <div class="toast-stack" aria-label="Notificações">
    <TransitionGroup name="toast">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast-${toast.tone}`" :role="toast.tone === 'error' ? 'alert' : 'status'" aria-atomic="true">
        <span class="toast-symbol" aria-hidden="true">{{ toast.tone === 'error' ? '!' : 'i' }}</span>
        <p>{{ toast.message }}</p>
      </div>
    </TransitionGroup>
  </div>
</template>
