<template>
  <section class="win11-view active">
    <!-- Toolbar -->
    <div class="win-toolbar-bar">
      <div class="toolbar-nav-group">
        <button class="win-btn-standard icon-btn" type="button" aria-label="Předchozí měsíc" @click="prevMonth">
          ‹
        </button>
        <button class="win-btn-subtle title-btn" type="button" title="Kliknutím vybereš měsíc" @click="$emit('open-month-picker')">
          <span>{{ monthTitle }}</span>
          <span class="title-sub-pill">Měsíce</span>
        </button>
        <button class="win-btn-standard icon-btn" type="button" aria-label="Další měsíc" @click="nextMonth">
          ›
        </button>
      </div>

      <div class="toolbar-actions-group">
        <span class="schedule-summary-pill">{{ scheduleHint }}</span>
        <button class="win-btn-standard toolbar-action-btn" type="button" title="Doplnit běžnou dobu do prázdných dnů" @click="$emit('fill-missing', currentMonth)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="16" height="16">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span class="btn-label-desktop">Doplnit běžnou dobu do prázdných dnů</span>
          <span class="btn-label-mobile">Doplnit běžnou dobu</span>
        </button>
      </div>
    </div>

    <div class="calendar-workspace-layout">
      <!-- Velká kalendářní mřížka -->
      <div class="win-card calendar-card-shell">
        <div class="calendar-weekdays-header" aria-hidden="true">
          <span>Pondělí</span><span>Úterý</span><span>Středa</span><span>Čtvrtek</span><span>Pátek</span><span>Sobota</span><span>Neděle</span>
        </div>

        <div class="calendar-cells-grid">
          <!-- Odsazení před 1. dnem měsíce -->
          <div
            v-for="padIndex in leadingEmptyDays"
            :key="'pad-' + padIndex"
            class="cal-day-cell empty"
          ></div>

          <!-- Dny v měsíci -->
          <div
            v-for="cell in calendarCells"
            :key="cell.dateKey"
            class="cal-day-cell"
            :class="{
              today: cell.isToday,
              weekend: cell.isWeekend,
              has_record: cell.hasRecord,
              missing_work: cell.isMissingWork
            }"
            @click="$emit('edit-day', cell.dateKey)"
          >
            <div class="cal-day-top">
              <span class="cal-day-number">{{ cell.dayNumber }}</span>
              <span v-if="cell.holiday" class="cal-holiday-tag" :title="cell.holiday">★</span>
            </div>

            <div class="cal-day-content">
              <div v-if="cell.hasRecord" class="cal-record-pill" :class="cell.recordTypeClass">
                <span class="pill-type">{{ cell.shortTypeLabel }}</span>
                <span v-if="cell.timeString" class="pill-time">{{ cell.timeString }}</span>
              </div>
              <span v-else-if="cell.isWeekend" class="cal-empty-sub">Víkend</span>
              <span v-else-if="cell.holiday" class="cal-empty-sub">{{ cell.holiday }}</span>
              <span v-else-if="cell.isMissingWork" class="cal-missing-tag">Nevyplněno</span>
            </div>

            <div v-if="cell.metrics && cell.metrics.balance !== 0" class="cal-day-balance" :class="cell.metrics.balance > 0 ? 'positive' : 'negative'">
              {{ formatDuration(cell.metrics.balance, true) }}
            </div>
          </div>
        </div>

        <!-- Legenda -->
        <div class="calendar-legend-bar">
          <span><i class="dot work"></i> Běžná směna</span>
          <span><i class="dot home"></i> Home office</span>
          <span><i class="dot trip"></i> Služební cesta</span>
          <span><i class="dot leave"></i> Dovolená / Volno</span>
          <span><i class="dot doctor"></i> Lékař / Nemoc</span>
          <span><i class="dot weekend-work"></i> Směna o víkendu</span>
          <span><i class="dot missing"></i> Nevyplněno</span>
        </div>
      </div>

      <!-- Pravý boční panel kalendáře -->
      <aside class="calendar-side-panel">
        <article class="win-card cal-summary-tile">
          <h3>Souhrn měsíce</h3>
          <div class="cal-summary-row">
            <div>
              <span>Fond</span>
              <strong>{{ formatDuration(stats.fund) }}</strong>
            </div>
            <div>
              <span>Odpracováno</span>
              <strong>{{ formatDuration(stats.worked) }}</strong>
            </div>
            <div>
              <span>Saldo</span>
              <strong :class="stats.balance > 0 ? 'positive' : stats.balance < 0 ? 'negative' : ''">
                {{ formatDuration(stats.balance, true) }}
              </strong>
            </div>
          </div>
        </article>

        <article class="win-card cal-events-tile">
          <div class="card-header-row">
            <h3>Záznamy v měsíci</h3>
            <span class="win-badge neutral">{{ monthRecordsCount }} dnů</span>
          </div>

          <div class="cal-records-scroll">
            <div
              v-for="rec in monthRecordsList"
              :key="rec.date"
              class="cal-record-item"
              @click="$emit('edit-day', rec.date)"
            >
              <div class="rec-date-badge">
                <strong>{{ rec.dayNumber }}</strong>
                <small>{{ rec.weekday }}</small>
              </div>
              <div class="rec-info">
                <strong>{{ rec.typeLabel }}</strong>
                <span class="muted">{{ rec.timeSpan }}</span>
              </div>
              <div class="rec-metric">
                <strong>{{ formatDuration(rec.metrics.worked) }}</strong>
                <small :class="rec.metrics.balance > 0 ? 'positive' : rec.metrics.balance < 0 ? 'negative' : ''">
                  {{ formatDuration(rec.metrics.balance, true) }}
                </small>
              </div>
            </div>

            <p v-if="monthRecordsList.length === 0" class="muted" style="margin: 8px 0; font-size: 13px;">
              V tomto měsíci zatím nejsou žádné záznamy.
            </p>
          </div>
        </article>
      </aside>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import {
  fmtMonthTitle,
  localDateKey,
  parseDateKey,
  todayKey,
  isWeekendDate,
  fmtWeekdayShort,
  addMonths,
  getDaysInMonth
} from '../utils/dates.js';
import { holidayName } from '../utils/holidays.js';
import { formatDuration } from '../utils/time.js';
import {
  baseTargetForDate,
  dayMetrics,
  TYPE_LABELS,
  SHORT_TYPE_LABELS,
  activeWorkDays
} from '../utils/attendance.js';

const props = defineProps({
  currentMonth: {
    type: Date,
    required: true
  },
  records: {
    type: Map,
    required: true
  },
  settings: {
    type: Object,
    required: true
  },
  stats: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['change-month', 'open-month-picker', 'fill-missing', 'edit-day']);

const monthTitle = computed(() => fmtMonthTitle(props.currentMonth));

function prevMonth() {
  emit('change-month', addMonths(props.currentMonth, -1));
}

function nextMonth() {
  emit('change-month', addMonths(props.currentMonth, 1));
}

const scheduleHint = computed(() => {
  const days = activeWorkDays(props.settings);
  const ordered = [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d)).join(',');
  let daysStr = 'Po–Pá';
  if (ordered === '1,2,3,4,5,6') daysStr = 'Po–So';
  if (ordered === '1,2,3,4,5,6,0') daysStr = 'Po–Ne';
  return `Rozvrh: ${daysStr} · ${props.settings.workStart || '06:30'}–${props.settings.workEnd || '15:30'}`;
});

const leadingEmptyDays = computed(() => {
  const firstDay = new Date(props.currentMonth.getFullYear(), props.currentMonth.getMonth(), 1, 12);
  const day = firstDay.getDay(); // 0=Ne, 1=Po..
  return day === 0 ? 6 : day - 1;
});

const today = todayKey();

const calendarCells = computed(() => {
  const year = props.currentMonth.getFullYear();
  const month = props.currentMonth.getMonth();
  const daysCount = getDaysInMonth(year, month);
  const cells = [];

  for (let d = 1; d <= daysCount; d++) {
    const curDate = new Date(year, month, d, 12, 0, 0, 0);
    const dateKey = localDateKey(curDate);
    const rec = props.records.get(dateKey);
    const holiday = holidayName(dateKey);
    const isWeekend = isWeekendDate(curDate);
    const baseTarget = baseTargetForDate(dateKey, props.settings);
    const isToday = dateKey === today;
    const isMissingWork = baseTarget > 0 && dateKey < today && !rec;

    let timeString = '';
    let shortTypeLabel = '';
    let recordTypeClass = '';
    let metrics = null;

    if (rec) {
      metrics = dayMetrics(rec, props.settings);
      shortTypeLabel = SHORT_TYPE_LABELS[rec.type] || rec.type;

      if (rec.start && rec.end) {
        timeString = `${rec.start}–${rec.end}`;
      } else if (rec.start) {
        timeString = `od ${rec.start}`;
      }

      if (rec.type === 'homeOffice') recordTypeClass = 'home';
      else if (rec.type === 'businessTrip') recordTypeClass = 'trip';
      else if (rec.type === 'vacation' || rec.type === 'halfVacation' || rec.type === 'compTime') recordTypeClass = 'leave';
      else if (rec.type === 'doctor' || rec.type === 'sick') recordTypeClass = 'doctor';
      else if (isWeekend) recordTypeClass = 'weekend-work';
      else recordTypeClass = 'work';
    }

    cells.push({
      dateKey,
      dayNumber: d,
      isToday,
      isWeekend,
      holiday,
      hasRecord: Boolean(rec),
      isMissingWork,
      recordTypeClass,
      shortTypeLabel,
      timeString,
      metrics
    });
  }

  return cells;
});

const monthRecordsList = computed(() => {
  const year = props.currentMonth.getFullYear();
  const month = props.currentMonth.getMonth();
  const daysCount = getDaysInMonth(year, month);
  const list = [];

  for (let d = 1; d <= daysCount; d++) {
    const curDate = new Date(year, month, d, 12, 0, 0, 0);
    const dateKey = localDateKey(curDate);
    const rec = props.records.get(dateKey);

    if (rec) {
      const metrics = dayMetrics(rec, props.settings);
      let timeSpan = '—';
      if (rec.start && rec.end) timeSpan = `${rec.start} – ${rec.end}`;
      else if (rec.start) timeSpan = `od ${rec.start}`;

      list.push({
        date: dateKey,
        dayNumber: d,
        weekday: fmtWeekdayShort(curDate),
        typeLabel: TYPE_LABELS[rec.type] || rec.type,
        timeSpan,
        metrics
      });
    }
  }

  return list;
});

const monthRecordsCount = computed(() => monthRecordsList.value.length);
</script>

