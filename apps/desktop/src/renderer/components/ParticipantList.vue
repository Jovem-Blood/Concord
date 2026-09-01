<script setup lang="ts">
import type { ParticipantView, VoiceState } from '../services/cloudflare/types'
defineProps<{ participants: ParticipantView[]; voice: VoiceState; speaking: Record<string, boolean>; status: string }>()
</script>
<template>
  <div class="sidebar-heading"><h2 id="participants-title">Participantes</h2><span>{{ participants.length }}</span></div>
  <ul class="participant-list" aria-labelledby="participants-title">
    <li
      v-for="participant in participants" :key="participant.identity"
      :class="{ speaking: speaking[participant.isLocal ? 'local' : participant.identity] }"
    >
      <span class="avatar" aria-hidden="true">{{ participant.name.slice(0, 1).toUpperCase() }}</span>
      <span>
        <strong :title="participant.name">{{ participant.name }}{{ participant.isLocal ? ' · Você' : '' }}</strong>
        <small class="participant-status">{{ status !== 'Conectado' ? status :
          speaking[participant.isLocal ? 'local' : participant.identity] ? 'Falando' :
          participant.isLocal ? (voice.joined ? (voice.muted ? 'Microfone silenciado' : 'Na conversa') : 'Só ouvindo') :
          participant.voice.available ? (participant.voice.muted ? 'Microfone silenciado' : 'Na conversa') : 'Só ouvindo' }}</small>
      </span>
    </li>
  </ul>
</template>
