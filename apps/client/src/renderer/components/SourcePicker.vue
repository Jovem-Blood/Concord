<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CaptureProfile, CaptureSourceDTO } from '../../shared/capture'
import { captureProvider } from '../services/capture/provider'

const emit = defineEmits<{
  cancel: []
  share: [source: CaptureSourceDTO | undefined, includeAudio: boolean, profile: CaptureProfile]
}>()
defineProps<{ voiceActive: boolean }>()

const isElectron = captureProvider.capabilities.environment === 'electron'
const sources = ref<CaptureSourceDTO[]>([])
const selectedId = ref('')
const includeAudio = ref(false)
const profile = ref<CaptureProfile>('smooth')
const loading = ref(isElectron)
const error = ref('')
const dialog = ref<HTMLElement | null>(null)
const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null

function trapFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return
  const controls = Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

const selectedSource = computed(() => sources.value.find((source) => source.id === selectedId.value))

onMounted(async () => {
  dialog.value?.focus({ preventScroll: true })
  if (!isElectron) return
  try {
    sources.value = await captureProvider.listSources()
  } catch {
    error.value = 'Não foi possível carregar as telas e janelas disponíveis.'
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => previousFocus?.focus({ preventScroll: true }))
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <section ref="dialog" class="source-picker" role="dialog" aria-modal="true" aria-labelledby="picker-title" tabindex="-1" @keydown="trapFocus" @keydown.esc.stop.prevent="emit('cancel')">
      <header class="picker-header">
        <div>
          <p class="eyebrow">Nova transmissão</p>
          <h2 id="picker-title">O que você quer mostrar?</h2>
          <p>Escolha a fonte e ajuste como ela será transmitida.</p>
        </div>
        <button class="icon-button" aria-label="Fechar" @click="emit('cancel')">×</button>
      </header>

      <div class="picker-body">
        <div class="picker-content">
          <div v-if="loading" class="empty-state" role="status" aria-busy="true">Procurando telas e janelas…</div>
          <div v-else-if="error" class="error-banner" role="alert">{{ error }}</div>
          <div v-else-if="!isElectron" class="native-picker-info">
            <div>
              <strong>Use o seletor seguro do navegador</strong>
              <p>Depois de continuar, escolha uma aba, janela ou monitor. O Concord só recebe a fonte que você autorizar.</p>
            </div>
          </div>
          <div v-else-if="sources.length === 0" class="empty-state" role="status">Nenhuma fonte de captura foi encontrada.</div>
          <div v-else class="source-grid">
            <button
              v-for="source in sources"
              :key="source.id"
              class="source-card"
              :class="{ selected: source.id === selectedId }"
              :aria-pressed="source.id === selectedId"
              :title="source.name"
              @click="selectedId = source.id"
            >
              <span class="source-thumbnail"><img :src="source.thumbnail" alt="" /><span v-if="source.id === selectedId" class="selected-check" aria-hidden="true">Selecionada</span></span>
              <span class="source-name">
                <img v-if="source.icon" class="source-icon" :src="source.icon" alt="" />
                <span>{{ source.name }}</span>
              </span>
              <span class="source-kind">{{ source.kind === 'screen' ? 'Monitor' : 'Janela' }}</span>
            </button>
          </div>
        </div>

        <div class="picker-options">
          <fieldset class="quality-options">
            <legend>Qualidade da transmissão</legend>
            <label class="option-card">
              <input v-model="profile" type="radio" name="capture-profile" value="smooth" />
              <span><strong>Movimento</strong><small>1080p · 30 FPS</small></span>
              <em>Jogos e vídeo</em>
            </label>
            <label class="option-card">
              <input v-model="profile" type="radio" name="capture-profile" value="sharp" />
              <span><strong>Nitidez</strong><small>1080p · 15 FPS</small></span>
              <em>Texto e código</em>
            </label>
          </fieldset>
          <div class="audio-option">
            <div><strong id="system-audio-label">Áudio do sistema · {{ includeAudio ? 'Ligado' : 'Desligado' }}</strong><small id="system-audio-help">{{ isElectron ? 'Inclui o som de outros aplicativos.' : 'Disponível quando a fonte e o navegador permitirem.' }}</small></div>
            <label class="switch"><input v-model="includeAudio" type="checkbox" aria-labelledby="system-audio-label" aria-describedby="system-audio-help" /><span aria-hidden="true" /></label>
          </div>
          <p v-if="includeAudio && voiceActive" class="system-audio-warning" role="status">O áudio do sistema pode incluir a própria conversa da sala.</p>
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
