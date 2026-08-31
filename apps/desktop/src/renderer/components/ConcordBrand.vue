<script setup lang="ts">
defineProps<{ compact?: boolean }>()
</script>

<template>
  <!-- Wordmark only until the selected Pencil SVG is supplied; do not invent a replacement mark. -->
  <span class="concord-brand" :class="{ compact }"><strong class="concord-wordmark">Concord</strong></span>
</template>
