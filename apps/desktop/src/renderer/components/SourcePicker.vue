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
    <section class="source-picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <header class="picker-header">
        <div>
          <p class="eyebrow">Nova transmissão</p>
          <h2 id="picker-title">Compartilhar sua tela</h2>
        </div>
        <button class="icon-button" aria-label="Fechar" @click="emit('cancel')">×</button>
      </header>

      <div v-if="loading" class="empty-state">Procurando telas e janelas…</div>
      <div v-else-if="error" class="error-banner">{{ error }}</div>
      <div v-else-if="!isElectron" class="native-picker-info">
        <div class="native-picker-icon">▣</div>
        <div>
          <strong>O navegador mostrará as opções disponíveis</strong>
          <p>Na próxima etapa, escolha uma aba, janela ou monitor no seletor seguro do navegador.</p>
        </div>
      </div>
      <div v-else-if="sources.length === 0" class="empty-state">Nenhuma fonte de captura foi encontrada.</div>
      <div v-else class="source-grid">
        <button
          v-for="source in sources"
          :key="source.id"
          class="source-card"
          :class="{ selected: source.id === selectedId }"
          @click="selectedId = source.id"
        >
          <img :src="source.thumbnail" alt="" />
          <span class="source-name">
            <img v-if="source.icon" class="source-icon" :src="source.icon" alt="" />
            {{ source.name }}
          </span>
          <span class="source-kind">{{ source.kind === 'screen' ? 'Monitor' : 'Janela' }}</span>
        </button>
      </div>

      <div class="picker-options">
        <fieldset>
          <legend>Qualidade</legend>
          <label class="radio-row">
            <input v-model="profile" type="radio" value="smooth" />
            <span><strong>Suave</strong><small>1080p · 30 FPS, para jogos</small></span>
          </label>
          <label class="radio-row">
            <input v-model="profile" type="radio" value="sharp" />
            <span><strong>Nítida</strong><small>1080p · 15 FPS, para texto</small></span>
          </label>
        </fieldset>
        <label class="check-row">
          <input v-model="includeAudio" type="checkbox" />
          <span>
            <strong>Compartilhar áudio do sistema</strong>
            <small v-if="isElectron">Pode incluir áudio de outros aplicativos.</small>
            <small v-else>Opcional: depende do navegador e da fonte escolhida. Abas costumam ter melhor suporte.</small>
          </span>
        </label>
      </div>

      <footer class="picker-actions">
        <button class="button secondary" @click="emit('cancel')">Cancelar</button>
        <button
          class="button primary"
          :disabled="isElectron && !selectedSource"
          @click="emit('share', selectedSource, includeAudio, profile)"
        >
          {{ isElectron ? 'Compartilhar' : 'Escolher e compartilhar' }}
        </button>
      </footer>
    </section>
  </div>
</template>
