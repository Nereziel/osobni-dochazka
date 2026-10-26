<template>
  <div v-if="activeShift.isActive" class="win-active-shift-card">
    <div class="shift-live-indicator">
      <span class="pulse-indicator"></span>
      <div class="shift-live-text">
        <span class="shift-live-tag">SMĚNA PROBÍHÁ</span>
        <strong class="shift-live-clock">{{ elapsedTime }}</strong>
      </div>
    </div>
    <div class="shift-live-meta">
      <span>{{ activeShift.typeLabel }} od {{ activeShift.startTime }}</span>
      <span>Denní cíl: {{ formatDuration(dailyTarget) }}</span>
    </div>
    <div class="shift-live-actions">
      <button class="win-btn-accent" type="button" @click="$emit('endShift')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
        <span>Ukončit směnu (Odchod teď)</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { timeToMinutes, formatDuration, pad } from '../../utils/time.js';

const props = defineProps({
  activeShift: {
    type: Object,
    required: true
  },
  dailyTarget: {
    type: Number,
    default: 510
  }
});

defineEmits(['endShift']);

const elapsedTime = ref('00:00:00');
let timerInterval = null;

function updateTimer() {
  if (!props.activeShift?.isActive || !props.activeShift?.startTime) {
    elapsedTime.value = '00:00:00';
    return;
  }

  const sMin = timeToMinutes(props.activeShift.startTime);
  if (sMin === null) return;

  const now = new Date();
  const curMin = now.getHours() * 60 + now.getMinutes();
  const curSec = now.getSeconds();
  const diffSec = (curMin >= sMin ? (curMin - sMin) * 60 : (1440 - sMin + curMin) * 60) + curSec;

  const hh = Math.floor(diffSec / 3600);
  const mm = Math.floor((diffSec % 3600) / 60);
  const ss = diffSec % 60;
  elapsedTime.value = `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

onMounted(() => {
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
});

onUnmounted(() => {
  if (timerInterval) clearInterval(timerInterval);
});

watch(() => props.activeShift, updateTimer, { deep: true });
</script>

