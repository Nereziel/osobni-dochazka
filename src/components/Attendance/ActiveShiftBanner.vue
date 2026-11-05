<template>
  <div
    v-if="activeShift.isActive"
    class="win-active-shift-card"
  >
    <div class="shift-live-indicator">
      <span class="pulse-indicator" />
      <div class="shift-live-text">
        <span class="shift-live-tag">SMĚNA PROBÍHÁ</span>
        <strong class="shift-live-clock">{{ elapsedTime }}</strong>
      </div>
    </div>
    <div class="shift-live-meta">
      <span>{{ activeShift.typeLabel }} od {{ activeShift.startTime }}</span>
      <span>Konec směny: <strong>{{ workEndTime }}</strong></span>
      <span
        v-if="earlyLeaveText"
        class="early-leave-pill"
      >✨ {{ earlyLeaveText }}</span>
    </div>
    <div class="shift-live-actions">
      <button
        class="win-btn-accent"
        type="button"
        @click="$emit('endShift')"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          width="16"
          height="16"
        >
          <rect
            x="6"
            y="6"
            width="12"
            height="12"
            rx="2"
          />
        </svg>
        <span>Ukončit směnu (Odchod teď)</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { shiftElapsedSeconds, pad, formatDuration } from '../../utils/time.js';
import { calculateWorkEndTime, calculateWorkEndTimeForRecord } from '../../utils/attendance.js';

const props = defineProps({
  dayRecord: {
    type: Object,
    default: null
  },
  activeShift: {
    type: Object,
    required: true
  },
  dailyTarget: {
    type: Number,
    default: 480
  },
  settings: {
    type: Object,
    default: () => ({})
  },
  creditedMinutes: {
    type: Number,
    default: 0
  },
  priorBalance: {
    type: Number,
    default: 0
  }
});

defineEmits(['endShift']);

const elapsedTime = ref('00:00:00');
let timerInterval = null;

function projectedEndTime(target) {
  if (props.dayRecord?.type === 'doctor' && !props.dayRecord.doctorFullDay) {
    return calculateWorkEndTimeForRecord(props.dayRecord, props.settings, target);
  }
  const customBreak = props.activeShift?.manualBreak ? props.activeShift.breakMinutes : null;
  return calculateWorkEndTime(
    props.activeShift?.startTime,
    props.settings,
    props.creditedMinutes,
    customBreak,
    target
  );
}

const workEndTime = computed(() => projectedEndTime(props.dailyTarget));

const earlyLeaveText = computed(() => {
  if (!props.priorBalance || props.priorBalance <= 0) return '';
  const reducedTarget = Math.max(0, props.dailyTarget - props.priorBalance);
  const earlyTime = projectedEndTime(reducedTarget);
  return `S nadpracovaným (+${formatDuration(props.priorBalance)}) už v ${earlyTime}`;
});

function updateTimer() {
  if (!props.activeShift?.isActive || !props.activeShift?.startTime) {
    elapsedTime.value = '00:00:00';
    return;
  }

  const diffSec = shiftElapsedSeconds(props.activeShift.date, props.activeShift.startTime, new Date());

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

