<template>
  <fieldset class="attendance-time-picker">
    <legend>{{ label }}</legend>
    <div class="attendance-time-selects">
      <label class="win-field">
        <span>Hodina</span>
        <select v-model="hour" :aria-label="label + ' – hodina'">
          <option v-for="h in ATTENDANCE_HOURS" :key="h" :value="h">{{ h }}</option>
        </select>
      </label>
      <label class="win-field">
        <span>Minuta</span>
        <select v-model="minute" :aria-label="label + ' – minuta'">
          <option v-for="m in ATTENDANCE_MINUTES" :key="m" :value="m">{{ m }}</option>
        </select>
      </label>
    </div>
  </fieldset>
</template>

<script setup>
import { computed } from 'vue';
import { ATTENDANCE_HOURS, ATTENDANCE_MINUTES, isAttendanceTimeSlot, roundAttendanceTime } from '../../utils/time.js';

const props = defineProps({
  modelValue: { type: String, required: true },
  label: { type: String, required: true }
});
const emit = defineEmits(['update:modelValue']);
const normalized = computed(() => {
  const time = roundAttendanceTime(props.modelValue);
  return isAttendanceTimeSlot(time) ? time : '00:00';
});
const hour = computed({
  get: () => normalized.value.slice(0, 2),
  set: (value) => emit('update:modelValue', value + ':' + normalized.value.slice(3))
});
const minute = computed({
  get: () => normalized.value.slice(3),
  set: (value) => emit('update:modelValue', normalized.value.slice(0, 2) + ':' + value)
});
</script>

<style scoped>
.attendance-time-picker {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
  flex: 1 1 160px;
  max-width: 240px;
}
.attendance-time-picker legend {
  padding: 0;
  margin-bottom: 6px;
  font-weight: 600;
}
.attendance-time-selects {
  display: flex;
  gap: 8px;
}
.attendance-time-selects .win-field {
  flex: 1 1 0;
  min-width: 0;
}
.attendance-time-selects select {
  width: 100%;
  min-width: 0;
}
</style>
