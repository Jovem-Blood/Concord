<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { UpdateState } from '../../shared/update'

const props = defineProps<{ inRoom: boolean }>()
const api = window.updateAPI
const state = ref<UpdateState>()
const open = ref(false)
const requestError = ref('')
let unsubscribe: (() => void) | undefined
let receivedEvent = false
let mounted = true
const busy = computed(() => ['checking', 'downloading', 'installing'].includes(state.value?.status ?? ''))
const label = computed(() => {
  switch (state.value?.status) {
    case 'checking': return 'Verificando atualizações…'
    case 'up-to-date': return 'Você está na versão mais recente.'
    case 'downloading': return `Baixando versão ${state.value.version}… ${Math.floor(state.value.percent ?? 0)}%`
    case 'downloaded': return `Versão ${state.value.version} pronta para instalar.`
    case 'installing': return 'Reiniciando para atualizar…'
    case 'error': return 'Não foi possível atualizar. Verifique sua conexão e tente novamente.'
    case 'unsupported': return 'Atualizações automáticas estão disponíveis nas instalações para Windows e no AppImage para Linux.'
    default: return 'O Concord verifica atualizações automaticamente.'
  }
})
onMounted(async () => {
  if (!api) return
  unsubscribe = api.onState((next) => {
    receivedEvent = true
    state.value = next
    requestError.value = ''
  })
  try {
    const initial = await api.getState()
    if (mounted && !receivedEvent) state.value = initial
  } catch { requestError.value = 'Não foi possível consultar o atualizador.' }
})
onBeforeUnmount(() => { mounted = false; unsubscribe?.() })
async function check() {
  requestError.value = ''
  try { await api?.check() } catch { requestError.value = 'Não foi possível verificar. Tente novamente.' }
}
async function install() {
  if (props.inRoom || state.value?.status !== 'downloaded') return
  try { await api?.install() } catch { requestError.value = 'Não foi possível reiniciar. Feche e abra o Concord para atualizar.' }
}
</script>

<template>
  <aside v-if="api" class="desktop-updates" :class="{ 'in-room': inRoom }" aria-label="Atualizações do Concord">
    <button class="update-toggle" :aria-expanded="open" aria-controls="desktop-update-panel" @click="open = !open">
      <span v-if="state?.status === 'downloaded'" class="update-dot" />
      {{ state?.status === 'downloaded' ? 'Atualização pronta' : state?.status === 'downloading' ? `Atualizando · ${Math.floor(state.percent ?? 0)}%` : 'Atualizações' }}
    </button>
    <section v-if="open" id="desktop-update-panel" class="update-panel">
      <header><strong>Atualizações</strong><button aria-label="Fechar atualizações" @click="open = false">×</button></header>
      <small v-if="state">Versão instalada: {{ state.currentVersion }}</small>
      <p role="status">{{ label }}</p>
      <progress v-if="state?.status === 'downloading'" :value="state.percent ?? 0" max="100" aria-label="Progresso do download" />
      <p v-if="state?.status === 'downloaded'" class="update-hint">{{ inRoom ? 'Saia da sala para reiniciar e atualizar.' : 'Você pode reiniciar agora ou instalar ao fechar o Concord.' }}</p>
      <button v-if="state?.status === 'downloaded'" class="button primary" :disabled="inRoom" @click="install">Reiniciar para atualizar</button>
      <button v-else-if="state && state.status !== 'unsupported'" class="button secondary" :disabled="busy" @click="check">{{ state.status === 'error' ? 'Tentar novamente' : 'Verificar atualizações' }}</button>
      <p v-if="requestError" role="alert">{{ requestError }}</p>
    </section>
  </aside>
</template>

<style scoped>
.desktop-updates { position: fixed; right: 24px; top: 20px; z-index: 30; }
.desktop-updates.in-room { top: 10px; }
.update-toggle { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; background: var(--surface); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
.update-dot { width: 7px; height: 7px; border-radius: 50%; background: #66e0a3; }
.update-panel { position: absolute; right: 0; top: calc(100% + 10px); width: 320px; padding: 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text); box-shadow: 0 12px 40px #0006; }
.update-panel header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.update-panel header button { border: 0; background: transparent; color: inherit; font-size: 24px; cursor: pointer; }
.update-panel p { font-size: 14px; line-height: 1.5; margin: 14px 0; }
.update-panel small, .update-hint { color: var(--text-muted); }
.update-panel progress { width: 100%; accent-color: #66e0a3; }
.update-panel .button { width: 100%; }
</style>
