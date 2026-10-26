<template>
  <dialog ref="dialogRef" class="win11-dialog" @click="onBackdropClick">
    <form class="win11-dialog-surface" @submit.prevent="submitSave">
      <div class="dialog-drag-handle" aria-hidden="true"></div>
      <header class="dialog-header">
        <div>
          <span class="dialog-subtitle">{{ headerSubtitle }}</span>
          <h2>{{ headerTitle }}</h2>
        </div>
        <button class="win-btn-subtle icon-only" type="button" aria-label="Zavřít" @click="close">
          ×
        </button>
      </header>

      <div class="dialog-body-scroll">
        <!-- Režim dne -->
        <label class="win-field">
          <span>Typ směny / Absence</span>
          <select v-model="formData.type" class="win-select">
            <option value="work">Práce (běžná směna)</option>
            <option value="homeOffice">Home office (práce z domova)</option>
            <option value="businessTrip">Služební cesta</option>
            <option value="vacation">Dovolená (celý den)</option>
            <option value="halfVacation">½ dovolené (půlden)</option>
            <option value="doctor">Lékař / Propustka</option>
            <option value="sick">Nemoc / Neschopenka</option>
            <option value="compTime">Náhradní volno</option>
            <option value="holiday">Svátek / Volno bez fondu</option>
            <option value="other">Jiné omluvené volno</option>
          </select>
        </label>

        <!-- Pracovní doba sekce -->
        <div v-if="showsWorkSection" class="dialog-subcard">
          <div class="subcard-header-flex">
            <h4>Pracovní doba</h4>
            <button class="win-btn-subtle compact-btn" type="button" @click="applyDefaultSchedule">
              Použít běžný rozvrh
            </button>
          </div>
          <div class="dialog-form-row">
            <label class="win-field">
              <span>Příchod</span>
              <input v-model="formData.start" type="time">
            </label>
            <label class="win-field">
              <span>Odchod</span>
              <input v-model="formData.end" type="time">
            </label>
          </div>

          <div class="break-toggle-row">
            <div>
              <span class="field-sub-label">Přestávka na oběd</span>
              <strong>{{ autoBreakLabel }}</strong>
            </div>
            <label class="win-mini-toggle">
              <input v-model="formData.manualBreak" type="checkbox">
              <span>Vlastní</span>
            </label>
          </div>

          <label v-if="formData.manualBreak" class="win-field" style="margin-top: 8px;">
            <span>Délka přestávky</span>
            <div class="win-input-suffix">
              <input v-model.number="formData.breakMinutes" type="number" min="0" max="240" step="5">
              <span>min</span>
            </div>
          </label>
        </div>

        <!-- Lékař sekce -->
        <div v-if="formData.type === 'doctor'" class="dialog-subcard">
          <h4>Návštěva lékaře</h4>
          <div class="win-toggle-control" style="margin-bottom: 8px;">
            <label class="switch-label">
              <input v-model="formData.doctorFullDay" type="checkbox">
              <span class="switch-slider"></span>
              <div class="switch-text">
                <strong>Celý den u lékaře</strong>
                <small>Započítá se celý denní fond jako omluvená doba.</small>
              </div>
            </label>
          </div>
          <div v-if="!formData.doctorFullDay" class="dialog-form-row">
            <label class="win-field">
              <span>Čas u lékaře od</span>
              <input v-model="formData.doctorStart" type="time">
            </label>
            <label class="win-field">
              <span>Čas do</span>
              <input v-model="formData.doctorEnd" type="time">
            </label>
          </div>
        </div>

        <!-- Jiná omluvená doba -->
        <div v-if="formData.type === 'other'" class="dialog-subcard">
          <h4>Omluvený čas</h4>
          <label class="win-field">
            <span>Počet minut k započtení</span>
            <div class="win-input-suffix">
              <input v-model.number="formData.otherMinutes" type="number" min="0" max="1440" step="5">
              <span>min</span>
            </div>
          </label>
        </div>

        <!-- Poznámka -->
        <label class="win-field">
          <span>Poznámka ke dni</span>
          <textarea v-model="formData.note" rows="2" placeholder="Např. projekt, pohotovost, přesčas..."></textarea>
        </label>

        <!-- Live souhrn výsledku dne -->
        <div class="dialog-preview-grid">
          <div>
            <span>Odpracováno</span>
            <strong>{{ formatDuration(previewMetrics.worked) }}</strong>
          </div>
          <div>
            <span>Omluveno</span>
            <strong>{{ formatDuration(previewMetrics.credited) }}</strong>
          </div>
          <div>
            <span>Fond dne</span>
            <strong>{{ formatDuration(previewMetrics.target) }}</strong>
          </div>
          <div>
            <span>Saldo</span>
            <strong :class="{ positive: previewMetrics.balance > 0, negative: previewMetrics.balance < 0 }">
              {{ formatDuration(previewMetrics.balance, true) }}
            </strong>
          </div>
        </div>
      </div>

      <footer class="dialog-footer">
        <button
          v-if="hasExistingRecord"
          class="win-btn-subtle danger-btn"
          type="button"
          @click="confirmDelete"
        >
          Smazat záznam
        </button>
        <div class="dialog-actions-right">
          <button class="win-btn-standard" type="button" @click="close">
            Zrušit
          </button>
          <button class="win-btn-accent" type="submit">
            Uložit den
          </button>
        </div>
      </footer>
    </form>
  </dialog>
</template>

<script setup>
import { ref, computed } from 'vue';
import { fmtDayFull, parseDateKey, localDateKey } from '../../utils/dates.js';
import { holidayName } from '../../utils/holidays.js';
import {
  allowsWork,
  dayMetrics,
  defaultHoursForDate,
  calculatedBreak,
  isScheduledWorkday
} from '../../utils/attendance.js';
import { cloneDeep } from '../../utils/validation.js';
import { formatDuration } from '../../utils/time.js';

const props = defineProps({
  settings: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['save', 'delete']);

const dialogRef = ref(null);
const hasExistingRecord = ref(false);

const formData = ref({
  date: '',
  type: 'work',
  start: '',
  end: '',
  manualBreak: false,
  breakMinutes: 30,
  doctorFullDay: false,
  doctorStart: '',
  doctorEnd: '',
  otherMinutes: 0,
  note: ''
});

const headerTitle = computed(() => {
  if (!formData.value.date) return '';
  return fmtDayFull(formData.value.date);
});

const headerSubtitle = computed(() => {
  if (!formData.value.date) return 'Pracovní den';
  const h = holidayName(formData.value.date);
  if (h) return `Svátek: ${h}`;
  const scheduled = isScheduledWorkday(formData.value.date, props.settings);
  return scheduled ? 'Pracovní den podle rozvrhu' : 'Volný den / Víkend';
});

const showsWorkSection = computed(() => {
  if (formData.value.type === 'doctor' && formData.value.doctorFullDay) return false;
  return allowsWork(formData.value.type);
});

const autoBreakLabel = computed(() => {
  const brk = calculatedBreak(formData.value, props.settings);
  return `Automaticky ${brk} min`;
});

const previewMetrics = computed(() => {
  return dayMetrics(formData.value, props.settings);
});

function applyDefaultSchedule() {
  const hours = defaultHoursForDate(formData.value.date, props.settings);
  formData.value.start = hours.start;
  formData.value.end = hours.end;
  formData.value.manualBreak = false;
  formData.value.breakMinutes = props.settings.breakMinutes;
}

function open(dayOrKey, existingRecord = null) {
  const key = typeof dayOrKey === 'string' ? dayOrKey : dayOrKey?.date;
  hasExistingRecord.value = Boolean(existingRecord);

  if (existingRecord) {
    formData.value = {
      date: existingRecord.date,
      type: existingRecord.type || 'work',
      start: existingRecord.start || '',
      end: existingRecord.end || '',
      manualBreak: !!existingRecord.manualBreak,
      breakMinutes: existingRecord.breakMinutes ?? props.settings.breakMinutes,
      doctorFullDay: !!existingRecord.doctorFullDay,
      doctorStart: existingRecord.doctorStart || '',
      doctorEnd: existingRecord.doctorEnd || '',
      otherMinutes: Number(existingRecord.otherMinutes) || 0,
      note: existingRecord.note || ''
    };
  } else {
    const hours = defaultHoursForDate(key, props.settings);
    const scheduled = isScheduledWorkday(key, props.settings);
    const holiday = holidayName(key);

    formData.value = {
      date: key,
      type: scheduled ? 'work' : (holiday ? 'holiday' : 'work'),
      start: props.settings.autoFill ? hours.start : '',
      end: props.settings.autoFill ? hours.end : '',
      manualBreak: false,
      breakMinutes: props.settings.breakMinutes,
      doctorFullDay: false,
      doctorStart: '',
      doctorEnd: '',
      otherMinutes: 0,
      note: ''
    };
  }

  dialogRef.value?.showModal();
}

function close() {
  dialogRef.value?.close();
}

function submitSave() {
  emit('save', cloneDeep(formData.value));
  close();
}

function confirmDelete() {
  if (confirm(`Opravdu smazat záznam pro ${formData.value.date}?`)) {
    emit('delete', formData.value.date);
    close();
  }
}

function onBackdropClick(e) {
  if (e.target === dialogRef.value) {
    close();
  }
}

defineExpose({ open, close });
</script>

