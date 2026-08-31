<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { CaptureProfile, CaptureSourceDTO } from '../../shared/capture'
import { captureProvider } from '../services/capture/provider'

const emit = defineEmits<{
  cancel: []
  share: [source: CaptureSourceDTO | undefined, includeAudio: boolean, profile: CaptureProfile]
}>()

const isElectron = captureProvider.capabilities.environment === 'electron'
const sources = ref<CaptureSourceDTO[]>([])
const selectedId = ref('')
const includeAudio = ref(false)
const profile = ref<CaptureProfile>('smooth')
const loading = ref(isElectron)
const error = ref('')

const selectedSource = computed(() => sources.value.find((source) => source.id === selectedId.value))

onMounted(async () => {
  if (!isElectron) return
  try {
    sources.value = await captureProvider.listSources()
  } catch {
    error.value = 'Não foi possível carregar as telas e janelas disponíveis.'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <section class="source-picker" role="dialog" aria-modal="true" aria-labelledby="picker-title" @keydown.esc="emit('cancel')">
      <header class="picker-header">
        <div>
          <p class="eyebrow">Nova transmissão</p>
          <h2 id="picker-title">O que você quer mostrar?</h2>
          <p>Escolha a fonte e ajuste como ela será transmitida.</p>
        </div>
        <button class="icon-button" aria-label="Fechar" @click="emit('cancel')">×</button>
      </header>

      <div class="picker-content">
        <div v-if="loading" class="empty-state">Procurando telas e janelas…</div>
        <div v-else-if="error" class="error-banner" role="alert">{{ error }}</div>
        <div v-else-if="!isElectron" class="native-picker-info">
          <div class="native-picker-icon" aria-hidden="true"><span /></div>
          <div>
            <strong>Use o seletor seguro do navegador</strong>
            <p>Depois de continuar, escolha uma aba, janela ou monitor. O Concord só recebe a fonte que você autorizar.</p>
          </div>
        </div>
        <div v-else-if="sources.length === 0" class="empty-state">Nenhuma fonte de captura foi encontrada.</div>
        <div v-else class="source-grid">
          <button
            v-for="source in sources"
            :key="source.id"
            class="source-card"
            :class="{ selected: source.id === selectedId }"
            :aria-pressed="source.id === selectedId"
            @click="selectedId = source.id"
          >
            <span class="source-thumbnail"><img :src="source.thumbnail" alt="" /><span v-if="source.id === selectedId" class="selected-check">✓</span></span>
            <span class="source-name">
              <img v-if="source.icon" class="source-icon" :src="source.icon" alt="" />
              {{ source.name }}
            </span>
            <span class="source-kind">{{ source.kind === 'screen' ? 'Monitor' : 'Janela' }}</span>
          </button>
        </div>
      </div>

      <div class="picker-options">
        <fieldset class="quality-options">
          <legend>Qualidade da transmissão</legend>
          <label class="option-card">
            <input v-model="profile" type="radio" value="smooth" />
            <span><strong>Movimento</strong><small>1080p · 30 FPS</small></span>
            <em>Jogos e vídeo</em>
          </label>
          <label class="option-card">
            <input v-model="profile" type="radio" value="sharp" />
            <span><strong>Nitidez</strong><small>1080p · 15 FPS</small></span>
            <em>Texto e código</em>
          </label>
        </fieldset>
        <div class="audio-option">
          <div><strong>Áudio do sistema</strong><small>{{ isElectron ? 'Inclui o som de outros aplicativos.' : 'Disponível quando a fonte e o navegador permitirem.' }}</small></div>
          <label class="switch"><input v-model="includeAudio" type="checkbox" /><span aria-hidden="true" /></label>
        </div>
      </div>

      <footer class="picker-actions">
        <p>Sua transmissão começa apenas após a confirmação.</p>
        <div>
          <button class="button secondary" @click="emit('cancel')">Cancelar</button>
          <button
            class="button primary"
            :disabled="isElectron && !selectedSource"
            @click="emit('share', selectedSource, includeAudio, profile)"
          >
            {{ isElectron ? 'Compartilhar fonte' : 'Continuar' }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>
