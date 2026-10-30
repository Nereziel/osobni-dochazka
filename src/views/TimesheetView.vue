<template>
  <section class="win11-view active">
    <!-- Toolbar -->
    <div class="win-toolbar-bar no-print">
      <div class="toolbar-nav-group">
        <button
          class="win-btn-standard icon-btn"
          type="button"
          aria-label="Předchozí měsíc"
          @click="prevMonth"
        >
          ‹
        </button>
        <button
          class="win-btn-subtle title-btn"
          type="button"
          title="Kliknutím vybereš měsíc"
          @click="$emit('open-month-picker')"
        >
          <span>{{ monthTitle }}</span>
          <span class="title-sub-pill">Měsíce</span>
        </button>
        <button
          class="win-btn-standard icon-btn"
          type="button"
          aria-label="Další měsíc"
          @click="nextMonth"
        >
          ›
        </button>
      </div>

      <div class="toolbar-actions-group timesheet-actions">
        <button
          class="win-btn-standard toolbar-action-btn"
          type="button"
          title="Doplnit chybějící dny"
          @click="$emit('fill-missing', currentMonth)"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            width="16"
            height="16"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span class="btn-label-desktop">Doplnit chybějící dny</span>
          <span class="btn-label-mobile">Doplnit</span>
        </button>
        <button
          class="win-btn-standard toolbar-action-btn"
          type="button"
          title="Exportovat výkaz do CSV"
          @click="$emit('export-csv', currentMonth)"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            width="16"
            height="16"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line
              x1="12"
              y1="15"
              x2="12"
              y2="3"
            />
          </svg>
          <span class="btn-label-desktop">Export do CSV</span>
          <span class="btn-label-mobile">Export CSV</span>
        </button>
        <button
          class="win-btn-accent toolbar-action-btn"
          type="button"
          title="Vytisknout výkaz nebo uložit do PDF"
          @click="printTimesheet"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            width="16"
            height="16"
          >
            <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect
              x="6"
              y="14"
              width="12"
              height="8"
            />
          </svg>
          <span class="btn-label-desktop">Tisk / PDF výkaz</span>
          <span class="btn-label-mobile">Tisk / PDF</span>
        </button>
      </div>
    </div>

    <!-- Oficiální hlavička pro tisk -->
    <div class="official-print-header">
      <h2>MĚSÍČNÍ VÝKAZ ODPRACOVANÉ DOBY</h2>
      <div class="print-meta-grid">
        <div><strong>Jméno zaměstnance:</strong> <span>{{ employeeDisplayName }}</span></div>
        <div><strong>Období:</strong> <span>{{ monthTitle }}</span></div>
        <div><strong>Plánovaný fond:</strong> <span>{{ formatDuration(stats.fund) }}</span></div>
        <div><strong>Skutečně odpracováno:</strong> <span>{{ formatDuration(stats.worked + stats.credited) }}</span></div>
      </div>
    </div>

    <!-- KPI dlaždice -->
    <div class="timesheet-kpi-grid no-print">
      <div class="win-card ts-kpi-tile highlight">
        <span class="ts-kpi-label">Celkové saldo měsíce</span>
        <strong
          class="ts-kpi-val"
          :class="balanceClass"
        >{{ formatDuration(effectiveBalance, true) }}</strong>
        <small class="muted">{{ balanceStatusText }}</small>
      </div>
      <div class="win-card ts-kpi-tile">
        <span class="ts-kpi-label">Fond měsíce</span>
        <strong class="ts-kpi-val">{{ formatDuration(stats.fund) }}</strong>
        <small class="muted">{{ stats.scheduledWorkdays }} pracovních dnů</small>
      </div>
      <div class="win-card ts-kpi-tile">
        <span class="ts-kpi-label">Odpracováno celkem</span>
        <strong class="ts-kpi-val">{{ formatDuration(stats.worked) }}</strong>
        <small class="muted">{{ weekendWorkedText }}</small>
      </div>
      <div class="win-card ts-kpi-tile">
        <span class="ts-kpi-label">Omluvená doba</span>
        <strong class="ts-kpi-val">{{ formatDuration(stats.credited) }}</strong>
        <small class="muted">dovolené, lékař, nemoc</small>
      </div>
      <div class="win-card ts-kpi-tile">
        <span class="ts-kpi-label">Dovolená</span>
        <strong class="ts-kpi-val">{{ formatVacationDays(yearVacation) }}</strong>
        <small class="muted">{{ vacationSubText }}</small>
      </div>
      <div class="win-card ts-kpi-tile">
        <span class="ts-kpi-label">Celkem přestávky</span>
        <strong class="ts-kpi-val">{{ formatDuration(stats.totalBreaks) }}</strong>
        <small class="muted">odečtené obědy</small>
      </div>
    </div>

    <!-- Tabulka docházky -->
    <div class="win-card timesheet-table-card">
      <div class="table-responsive-wrap">
        <table class="win11-datagrid">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Den</th>
              <th>Režim / Typ</th>
              <th>Příchod</th>
              <th>Odchod</th>
              <th>Přestávka</th>
              <th>Odpracováno</th>
              <th>Omluveno</th>
              <th>Saldo</th>
              <th>Poznámka</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in tableRows"
              :key="row.date"
              :class="{ 'weekend-row': row.isWeekend }"
              style="cursor: pointer;"
              @click="$emit('edit-day', row.date)"
            >
              <td><strong>{{ row.dayNumber }}.{{ row.monthNumber }}.</strong></td>
              <td>{{ row.weekday }}</td>
              <td>{{ row.typeLabel }}</td>
              <td>{{ row.start }}</td>
              <td>{{ row.end }}</td>
              <td>{{ row.breakLabel }}</td>
              <td><strong>{{ row.workedText }}</strong></td>
              <td>{{ row.creditedText }}</td>
              <td :class="row.balanceClass">
                <strong>{{ row.balanceText }}</strong>
              </td>
              <td>{{ row.note }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="6">
                <strong>CELKEM ZA MĚSÍC</strong>
              </td>
              <td><strong>{{ formatDuration(stats.worked) }}</strong></td>
              <td><strong>{{ formatDuration(stats.credited) }}</strong></td>
              <td :class="effectiveBalance > 0 ? 'positive' : effectiveBalance < 0 ? 'negative' : ''">
                <strong>{{ formatDuration(effectiveBalance, true) }}</strong>
              </td>
              <td>Fond: {{ formatDuration(stats.fund) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import {
  fmtMonthTitle,
  localDateKey,
  todayKey,
  isWeekendDate,
  fmtWeekdayShort,
  addMonths,
  getDaysInMonth
} from '../utils/dates.js';
import { holidayName } from '../utils/holidays.js';
import { formatDuration } from '../utils/time.js';
import {
  dayMetrics,
  allowsWork,
  TYPE_LABELS,
  formatVacationDays
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
  currentUser: {
    type: Object,
    default: null
  },
  stats: {
    type: Object,
    required: true
  },
  yearVacation: {
    type: Number,
    default: 0
  },
  monthVacation: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['change-month', 'open-month-picker', 'fill-missing', 'export-csv', 'edit-day']);

const monthTitle = computed(() => fmtMonthTitle(props.currentMonth));

function prevMonth() {
  emit('change-month', addMonths(props.currentMonth, -1));
}

function nextMonth() {
  emit('change-month', addMonths(props.currentMonth, 1));
}

function printTimesheet() {
  window.print();
}

const employeeDisplayName = computed(() => {
  return props.currentUser?.displayName || props.currentUser?.username || 'Lokální uživatel';
});

const hasOngoingShiftInMonth = computed(() => {
  return typeof props.stats.completedBalance === 'number' && props.stats.completedBalance !== props.stats.balance;
});

const effectiveBalance = computed(() => {
  if (hasOngoingShiftInMonth.value) {
    return props.stats.completedBalance;
  }
  return props.stats.balance;
});

const balanceClass = computed(() => {
  if (effectiveBalance.value > 0) return 'positive';
  if (effectiveBalance.value < 0) return 'negative';
  return '';
});

const balanceStatusText = computed(() => {
  if (hasOngoingShiftInMonth.value) {
    if (effectiveBalance.value > 0) return `nadpracováno (můžeš jít o ${formatDuration(effectiveBalance.value)} dříve)`;
    if (effectiveBalance.value < 0) return 'nedoplatek (uzavřené dny)';
    return 'vyrovnáno (bez probíhající směny)';
  }
  if (effectiveBalance.value > 0) return `nadpracováno (lze odejít o ${formatDuration(effectiveBalance.value)} dříve)`;
  if (effectiveBalance.value < 0) return 'nedoplatek';
  return 'vyrovnáno';
});

const weekendWorkedText = computed(() => {
  return props.stats.weekendWorked > 0
    ? `z toho víkendy ${formatDuration(props.stats.weekendWorked)}`
    : 'bez víkendů';
});

const vacationSubText = computed(() => {
  const y = props.currentMonth.getFullYear();
  return props.monthVacation > 0
    ? `${props.monthVacation.toLocaleString('cs-CZ')} d. tento měsíc · rok ${y}: celkem ${formatVacationDays(props.yearVacation)}`
    : `rok ${y}: celkem dovolená ${formatVacationDays(props.yearVacation)}`;
});

const tableRows = computed(() => {
  const year = props.currentMonth.getFullYear();
  const month = props.currentMonth.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const today = todayKey();
  const rows = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const curDate = new Date(year, month, d, 12, 0, 0, 0);
    const dateKey = localDateKey(curDate);
    const rec = props.records.get(dateKey);
    const m = rec ? dayMetrics(rec, props.settings) : null;
    const h = holidayName(dateKey);
    const isWeekend = isWeekendDate(curDate);
    const isOngoingToday = dateKey === today && Boolean(rec?.start && !rec?.end) && allowsWork(rec?.type);

    let typeLabel = '—';
    if (rec) {
      typeLabel = TYPE_LABELS[rec.type] || rec.type;
    } else if (h) {
      typeLabel = `Svátek (${h})`;
    } else if (isWeekend) {
      typeLabel = 'Víkend';
    }

    const workedText = rec ? (isOngoingToday ? 'Probíhá…' : formatDuration(m.worked)) : '—';
    const creditedText = rec && m.credited > 0 ? formatDuration(m.credited) : '—';
    const balanceText = rec ? (isOngoingToday ? 'Probíhá' : formatDuration(m.balance, true)) : '—';
    const balanceClassVal = rec && !isOngoingToday ? (m.balance > 0 ? 'positive' : m.balance < 0 ? 'negative' : '') : 'muted';
    const breakLabel = rec && m.breakMinutes > 0 ? `${m.breakMinutes}m` : '—';

    rows.push({
      date: dateKey,
      dayNumber: d,
      monthNumber: month + 1,
      weekday: fmtWeekdayShort(curDate),
      isWeekend,
      typeLabel,
      start: rec?.start || '—',
      end: isOngoingToday ? 'probíhá' : (rec?.end || '—'),
      breakLabel,
      workedText,
      creditedText,
      balanceText,
      balanceClass: balanceClassVal,
      note: rec?.note || ''
    });
  }

  return rows;
});
</script>

