<script setup lang="ts">
import type { ParticipantView, VoiceState } from '../services/cloudflare/types'
import { avatarUrl } from '../domain/avatar'
defineProps<{ participants: ParticipantView[]; voice: VoiceState; speaking: Record<string, boolean>; status: string }>()
</script>
<template>
  <div class="sidebar-heading"><h2 id="participants-title">Participantes</h2><span>{{ participants.length }}</span></div>
  <ul class="participant-list" aria-labelledby="participants-title">
    <li
      v-for="participant in participants" :key="participant.identity"
      :class="{ speaking: speaking[participant.isLocal ? 'local' : participant.identity] }"
    >
      <img class="avatar" :src="avatarUrl(participant.name)" :alt="`Avatar de ${participant.name}`" />
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
