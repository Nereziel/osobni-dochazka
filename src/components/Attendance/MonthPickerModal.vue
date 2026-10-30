<template>
  <dialog
    ref="dialogRef"
    class="win11-dialog"
    @click="onBackdropClick"
  >
    <div class="win11-dialog-surface compact">
      <header class="dialog-header">
        <div class="year-selector-row">
          <button
            class="win-btn-standard icon-btn"
            type="button"
            aria-label="Předchozí rok"
            @click="selectedYear--"
          >
            ‹
          </button>
          <strong class="picker-year-title">{{ selectedYear }}</strong>
          <button
            class="win-btn-standard icon-btn"
            type="button"
            aria-label="Další rok"
            @click="selectedYear++"
          >
            ›
          </button>
        </div>
        <button
          class="win-btn-subtle icon-only"
          type="button"
          aria-label="Zavřít"
          @click="close"
        >
          ×
        </button>
      </header>

      <div class="month-grid-picker">
        <button
          v-for="(name, index) in MONTH_NAMES_CS"
          :key="index"
          class="month-picker-tile"
          :class="{
            current: isCurrentMonth(index),
            active: isSelectedMonth(index)
          }"
          type="button"
          @click="selectMonth(index)"
        >
          {{ name }}
        </button>
      </div>

      <footer
        class="dialog-footer"
        style="justify-content: space-between;"
      >
        <button
          class="win-btn-subtle"
          type="button"
          @click="selectTodayMonth"
        >
          Přejít na dnešní měsíc
        </button>
        <button
          class="win-btn-standard"
          type="button"
          @click="close"
        >
          Zavřít
        </button>
      </footer>
    </div>
  </dialog>
</template>

<script setup>
import { ref } from 'vue';
import { MONTH_NAMES_CS } from '../../utils/dates.js';

const emit = defineEmits(['select']);

const dialogRef = ref(null);
const selectedYear = ref(new Date().getFullYear());
const currentActiveMonth = ref(new Date());

function isCurrentMonth(index) {
  const now = new Date();
  return now.getFullYear() === selectedYear.value && now.getMonth() === index;
}

function isSelectedMonth(index) {
  return currentActiveMonth.value.getFullYear() === selectedYear.value && currentActiveMonth.value.getMonth() === index;
}

function selectMonth(index) {
  const chosen = new Date(selectedYear.value, index, 1, 12, 0, 0, 0);
  emit('select', chosen);
  close();
}

function selectTodayMonth() {
  const now = new Date();
  const chosen = new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0, 0);
  emit('select', chosen);
  close();
}

function open(initialDate) {
  const d = initialDate instanceof Date ? initialDate : new Date();
  currentActiveMonth.value = d;
  selectedYear.value = d.getFullYear();
  dialogRef.value?.showModal();
}

function close() {
  dialogRef.value?.close();
}

function onBackdropClick(e) {
  if (e.target === dialogRef.value) {
    close();
  }
}

defineExpose({ open, close });
</script>

