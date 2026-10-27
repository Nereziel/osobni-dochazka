<template>
  <section class="win11-view active">
    <!-- Stopwatch Banner probíhající směny -->
    <ActiveShiftBanner
      :active-shift="activeShift"
      :daily-target="todayMetrics.target"
      :settings="settings"
      :credited-minutes="todayMetrics.credited"
      @end-shift="handleEndShiftNow"
    />

    <div class="dashboard-grid-layout">
      <!-- LEVÝ VELKÝ PANEL: Dnešní stav a rychlé akce -->
      <div class="dash-col-primary">
        <!-- HERO KARTA: Dnešní saldo a stav dne -->
        <article class="win-card hero-metric-card">
          <div class="card-header-row">
            <div>
              <span class="hero-date-text">{{ todayFormattedDate }}</span>
              <div class="hero-badges-row">
                <span class="win-badge accent">{{ todayTypeLabel }}</span>
                <span v-if="todayHoliday" class="win-badge warning">{{ todayHoliday }}</span>
                <span class="win-badge neutral">{{ todayShiftTimes }}</span>
              </div>
            </div>
            <button class="win-btn-standard" type="button" @click="$emit('edit-day', todayKey)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              <span>Upravit den</span>
            </button>
          </div>

          <!-- Saldo a ukazatel plnění fondu -->
          <div class="hero-gauge-section">
            <div class="gauge-balance-container">
              <span class="gauge-label">Dnešní saldo</span>
              <div class="gauge-number-val" :class="balanceClass">
                {{ formatDuration(todayMetrics.balance, true) }}
              </div>
              <span class="gauge-sub-hint">{{ balanceSubHint }}</span>
            </div>

            <div class="fund-progress-container">
              <div class="progress-info-row">
                <span>Plnění denního fondu</span>
                <strong>{{ progressPercent }} %</strong>
              </div>
              <div class="win-progress-track">
                <div class="win-progress-bar" :style="{ width: progressPercent + '%' }"></div>
              </div>
              <div class="progress-sub-info">
                <span>{{ progressSubText }}</span>
              </div>
            </div>
          </div>

          <!-- 4 klíčové metriky dne -->
          <div class="hero-metric-tiles">
            <div class="metric-tile">
              <span class="tile-label">Odpracováno</span>
              <strong class="tile-value">{{ formatDuration(todayMetrics.worked) }}</strong>
              <span class="tile-sub">čistý čas</span>
            </div>
            <div class="metric-tile">
              <span class="tile-label">Omluveno</span>
              <strong class="tile-value">{{ formatDuration(todayMetrics.credited) }}</strong>
              <span class="tile-sub">absence / náhrada</span>
            </div>
            <div class="metric-tile">
              <span class="tile-label">Přestávka</span>
              <strong class="tile-value">{{ todayBreakDisplay.value }}</strong>
              <span class="tile-sub">{{ todayBreakDisplay.sub }}</span>
            </div>
            <div class="metric-tile">
              <span class="tile-label">Fond dne</span>
              <strong class="tile-value">{{ formatDuration(todayMetrics.target) }}</strong>
              <span class="tile-sub">předepsáno</span>
            </div>
          </div>
        </article>

        <!-- RYCHLÝ ZÁPIS SMĚNY (Quick Command Bar) -->
        <section class="win-card quick-command-card">
          <div class="card-section-title">
            <h2>Rychlý zápis příchodu a odchodu</h2>
            <p>Jedním kliknutím zaeviduj reálný čas nebo doplň standardní rozvrh.</p>
          </div>

          <div class="quick-primary-grid">
            <button class="win-btn-accent quick-tile-btn" type="button" @click="$emit('quick-arrival')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="22" height="22">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 14 14" />
              </svg>
              <div>
                <strong>Příchod teď</strong>
                <small>Uloží aktuální čas</small>
              </div>
            </button>

            <button class="win-btn-standard quick-tile-btn" type="button" @click="$emit('quick-departure')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="22" height="22">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" />
              </svg>
              <div>
                <strong>Odchod teď</strong>
                <small>Ukončí dnešní směnu</small>
              </div>
            </button>

            <button class="win-btn-standard quick-tile-btn" type="button" @click="$emit('quick-normal')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="22" height="22">
                <rect x="3" y="4" width="18" height="18" rx="2" /><polyline points="9 11 12 14 22 4" />
              </svg>
              <div>
                <strong>Běžná pracovní doba</strong>
                <small>{{ defaultShiftHours }}</small>
              </div>
            </button>

            <button class="win-btn-standard quick-tile-btn" type="button" @click="$emit('quick-vacation')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="22" height="22">
                <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
              <div>
                <strong>Dovolená (celý den)</strong>
                <small>Omluvené volno</small>
              </div>
            </button>
          </div>

          <!-- Rychlé předvolby režimu -->
          <div class="quick-presets-strip">
            <span class="preset-label">Rychlé předvolby:</span>
            <button class="win-btn-subtle chip-btn" type="button" @click="$emit('quick-preset', 'homeOffice')">
              🏠 Home office
            </button>
            <button class="win-btn-subtle chip-btn" type="button" @click="$emit('quick-preset', 'doctor')">
              🩺 Lékař (celodenní)
            </button>
            <button class="win-btn-subtle chip-btn" type="button" @click="$emit('quick-preset', 'businessTrip')">
              🚗 Služební cesta
            </button>
            <button class="win-btn-subtle chip-btn" type="button" @click="$emit('quick-preset', 'compTime')">
              ⏱️ Náhradní volno
            </button>
          </div>
        </section>
      </div>

      <!-- PRAVÝ PANEL: Týdenní pás a Měsíční KPI statistiky -->
      <div class="dash-col-secondary">
        <!-- TENTO TÝDEN (7-denní interaktivní pás) -->
        <article class="win-card week-interactive-card">
          <div class="card-header-row">
            <div>
              <h3>Tento týden</h3>
              <p class="muted">Po–Ne rozvrh směn</p>
            </div>
            <span class="card-hint-badge">Kliknutím upravíš</span>
          </div>

          <div class="win-week-strip">
            <button
              v-for="item in weekDays"
              :key="item.key"
              type="button"
              class="week-day-card"
              :class="{
                today: item.isToday,
                weekend: item.isWeekend,
                recorded: item.hasRecord
              }"
              :title="item.tooltip"
              @click="$emit('edit-day', item.key)"
            >
              <span class="week-day-name">{{ item.name }}</span>
              <span class="week-day-number">{{ item.num }}</span>
              <span v-if="item.status" class="cal-dot" :class="item.status"></span>
              <span class="week-day-hours">{{ item.hoursText }}</span>
            </button>
          </div>
        </article>

        <!-- TENTO MĚSÍC V ČÍSLECH -->
        <article class="win-card month-kpi-card">
          <div class="card-header-row">
            <div>
              <h3>Tento měsíc</h3>
              <p class="muted">{{ currentMonthTitle }}</p>
            </div>
            <button class="win-btn-subtle" type="button" @click="$emit('go-to-timesheet')">
              <span>Otevřít výkaz</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <div class="kpi-cards-grid">
            <div class="kpi-card">
              <span class="kpi-title">Měsíční saldo</span>
              <strong class="kpi-value" :class="monthBalanceClass">{{ formatDuration(monthKpi.balance, true) }}</strong>
              <span class="kpi-sub">{{ monthBalanceSub }}</span>
            </div>

            <div class="kpi-card">
              <span class="kpi-title">Odpracováno</span>
              <strong class="kpi-value">{{ formatDuration(monthKpi.worked) }}</strong>
              <span class="kpi-sub">z fondu {{ formatDuration(monthKpi.fund) }}</span>
            </div>

            <div class="kpi-card">
              <span class="kpi-title">Omluvená doba</span>
              <strong class="kpi-value">{{ formatDuration(monthKpi.credited) }}</strong>
              <span class="kpi-sub">dovolené, lékař, nemoc</span>
            </div>

            <div class="kpi-card">
              <span class="kpi-title">Nevyplněné dny</span>
              <strong class="kpi-value" :class="{ warning: monthKpi.missing > 0 }">{{ monthKpi.missing }}</strong>
              <span class="kpi-sub">minulé pracovní dny</span>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import ActiveShiftBanner from '../components/Attendance/ActiveShiftBanner.vue';
import { fmtDayFull, todayKey, localDateKey, parseDateKey, isWeekendDate, fmtMonthTitle } from '../utils/dates.js';
import { holidayName } from '../utils/holidays.js';
import { formatDuration } from '../utils/time.js';
import {
  dayMetrics,
  defaultHoursForDate,
  calculateWorkEndTime,
  isScheduledWorkday,
  statusClassForDay,
  TYPE_LABELS,
  SHORT_TYPE_LABELS
} from '../utils/attendance.js';

const props = defineProps({
  todayRecord: {
    type: Object,
    default: null
  },
  records: {
    type: Map,
    required: true
  },
  settings: {
    type: Object,
    required: true
  },
  activeShift: {
    type: Object,
    required: true
  },
  monthStats: {
    type: Object,
    required: true
  }
});

defineEmits([
  'edit-day',
  'end-shift',
  'quick-arrival',
  'quick-departure',
  'quick-normal',
  'quick-vacation',
  'quick-preset',
  'go-to-timesheet'
]);

const currentKey = todayKey();
const todayFormattedDate = computed(() => fmtDayFull(new Date()));

const todayHoliday = computed(() => holidayName(currentKey));

const todayMetrics = computed(() => {
  if (props.todayRecord) {
    return dayMetrics(props.todayRecord, props.settings);
  }
  const defaultHours = defaultHoursForDate(currentKey, props.settings);
  return {
    target: defaultHours.target,
    worked: 0,
    credited: 0,
    counted: 0,
    balance: 0,
    breakMinutes: 0
  };
});

const todayBreakDisplay = computed(() => {
  const rec = props.todayRecord;
  const standardBreak = props.settings?.breakMinutes ?? 30;
  if (!rec || (!rec.start && !rec.end)) {
    return { value: `${standardBreak} min`, sub: 'standardně' };
  }
  if (rec.manualBreak) {
    return { value: `${rec.breakMinutes ?? standardBreak} min`, sub: 'vlastní' };
  }
  if (rec.start && !rec.end) {
    return { value: `${standardBreak} min`, sub: 'bude odečteno' };
  }
  return {
    value: `${todayMetrics.value.breakMinutes} min`,
    sub: todayMetrics.value.breakMinutes > 0 ? 'odečteno' : 'pod 6 h'
  };
});

const todayTypeLabel = computed(() => {
  if (props.todayRecord?.type) {
    return TYPE_LABELS[props.todayRecord.type] || 'Práce';
  }
  return 'Práce (směna)';
});

const todayShiftTimes = computed(() => {
  if (props.todayRecord?.start && props.todayRecord?.end) {
    return `${props.todayRecord.start} – ${props.todayRecord.end}`;
  }
  const defaultHours = defaultHoursForDate(currentKey, props.settings);
  return `${defaultHours.start} – ${defaultHours.end}`;
});

const balanceClass = computed(() => {
  if (todayMetrics.value.balance > 0) return 'positive';
  if (todayMetrics.value.balance < 0) return 'negative';
  return '';
});

const balanceSubHint = computed(() => {
  const b = todayMetrics.value.balance;
  if (b > 0) return `Nadpracováno +${formatDuration(b)}`;
  if (b < 0) return `Chybí ještě ${formatDuration(Math.abs(b))}`;
  return todayMetrics.value.worked > 0 ? 'Přesně splněný fond' : 'Zatím bez odpracovaného času';
});

const progressPercent = computed(() => {
  const target = todayMetrics.value.target;
  if (target <= 0) return 100;
  const counted = todayMetrics.value.counted;
  return Math.min(100, Math.round((counted / target) * 100));
});

const progressSubText = computed(() => {
  const target = todayMetrics.value.target;
  const counted = todayMetrics.value.counted;
  if (target <= 0) return 'Dnes není předepsán žádný fond';
  if (counted >= target) return `Fond splněn (${formatDuration(counted)} z ${formatDuration(target)})`;

  if (props.activeShift?.isActive && props.activeShift?.startTime) {
    const endTime = calculateWorkEndTime(
      props.activeShift.startTime,
      props.settings,
      todayMetrics.value.credited,
      props.activeShift.manualBreak ? props.activeShift.breakMinutes : null
    );
    return `Zbývá ${formatDuration(target - counted)} (odchod v ${endTime})`;
  }
  return `Zbývá ${formatDuration(target - counted)} do splnění fondu`;
});

const defaultShiftHours = computed(() => {
  return `${props.settings.workStart || '06:30'} – ${props.settings.workEnd || '15:00'}`;
});

// 7-denní pás Po-Ne pro tento týden
const weekDays = computed(() => {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Ne, 1=Po..
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset, 12);
  const today = currentKey;

  const daysNames = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
  const list = [];

  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i, 12);
    const key = localDateKey(cur);
    const rec = props.records.get(key);
    const isToday = key === today;
    const isWeekend = isWeekendDate(cur);
    const status = statusClassForDay(key, rec, props.settings, today);
    const m = rec ? dayMetrics(rec, props.settings) : null;
    const h = holidayName(key);

    let hoursText = '—';
    if (rec) {
      if (m && m.worked > 0) {
        hoursText = formatDuration(m.worked);
      } else {
        hoursText = SHORT_TYPE_LABELS[rec.type] || '—';
      }
    } else if (h) {
      hoursText = 'Svátek';
    } else if (isScheduledWorkday(cur, props.settings)) {
      hoursText = key < today ? 'Chybí' : '—';
    } else {
      hoursText = 'Volno';
    }

    const tooltip = rec
      ? `${TYPE_LABELS[rec.type] || rec.type}${rec.note ? ` (${rec.note})` : ''}`
      : (h || '');

    list.push({
      key,
      name: daysNames[i],
      num: cur.getDate(),
      isToday,
      isWeekend,
      hasRecord: Boolean(rec),
      status,
      hoursText,
      tooltip
    });
  }

  return list;
});

const currentMonthTitle = computed(() => fmtMonthTitle(new Date()));
const monthKpi = computed(() => props.monthStats);

const monthBalanceClass = computed(() => {
  if (monthKpi.value.balance > 0) return 'positive';
  if (monthKpi.value.balance < 0) return 'negative';
  return '';
});

const monthBalanceSub = computed(() => {
  const b = monthKpi.value.balance;
  if (b > 0) return 'kladné saldo';
  if (b < 0) return 'nedoplatek fondu';
  return 'vyrovnané saldo';
});
</script>

