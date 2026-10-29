<template>
  <aside class="win11-sidebar no-print" aria-label="Hlavní nabídka">
    <div class="sidebar-top">
      <div class="sidebar-brand">
        <div class="brand-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="18" rx="3" ry="3" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="2" y1="10" x2="22" y2="10" />
            <path d="M12 14v4" />
            <path d="M10 16h4" />
          </svg>
        </div>
        <div class="brand-info">
          <span class="brand-name">Docházka 11</span>
          <span class="brand-badge">Enterprise Cloud · v{{ APP_VERSION }}</span>
        </div>
      </div>

      <!-- Profilová karta v sidebaru -->
      <div class="user-profile-tile" @click="$emit('user-click')">
        <div class="avatar-ring">{{ userInitials }}</div>
        <div class="user-profile-details">
          <strong>{{ userDisplayName }}</strong>
          <span class="status-indicator-pill" :class="userStatusClass">
            <span class="dot"></span>
            <span>{{ userStatusText }}</span>
          </span>
        </div>
        <button class="win-btn-subtle icon-only-btn" type="button" title="Správa profilu a přihlášení">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <polyline points="17 11 19 13 23 9" />
          </svg>
        </button>
      </div>

      <!-- Navigace -->
      <nav class="win11-nav">
        <button
          class="nav-item"
          :class="{ active: currentView === 'dashboard' }"
          type="button"
          @click="$emit('navigate', 'dashboard')"
        >
          <span class="nav-pill" aria-hidden="true"></span>
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" />
          </svg>
          <span class="nav-label">Přehled &amp; Dnes</span>
        </button>

        <button
          class="nav-item"
          :class="{ active: currentView === 'calendar' }"
          type="button"
          @click="$emit('navigate', 'calendar')"
        >
          <span class="nav-pill" aria-hidden="true"></span>
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span class="nav-label">Kalendář směn</span>
        </button>

        <button
          class="nav-item"
          :class="{ active: currentView === 'timesheet' }"
          type="button"
          @click="$emit('navigate', 'timesheet')"
        >
          <span class="nav-pill" aria-hidden="true"></span>
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /><line x1="2" y1="20" x2="22" y2="20" />
          </svg>
          <span class="nav-label">Měsíční výkaz docházky</span>
        </button>

        <button
          v-if="isAdmin"
          class="nav-item"
          :class="{ active: currentView === 'team' }"
          type="button"
          @click="$emit('navigate', 'team')"
        >
          <span class="nav-pill" aria-hidden="true"></span>
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span class="nav-label">Správa týmu &amp; Pozvánky</span>
        </button>

        <button
          class="nav-item"
          :class="{ active: currentView === 'settings' }"
          type="button"
          @click="$emit('navigate', 'settings')"
        >
          <span class="nav-pill" aria-hidden="true"></span>
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span class="nav-label">Nastavení &amp; Databáze</span>
        </button>
      </nav>
    </div>

    <div class="sidebar-bottom">
      <!-- Widget aktuálního plánu -->
      <div class="sidebar-plan-card">
        <div class="plan-header">
          <span>Můj rozvrh</span>
          <span class="plan-days-badge">{{ planDaysLabel }}</span>
        </div>
        <div class="plan-hours">{{ planHoursLabel }}</div>
        <div class="plan-target">Denní fond: {{ formatDuration(settings.dailyTargetMinutes) }}</div>
      </div>

      <div class="sidebar-footer-actions">
        <button class="win-btn-subtle" type="button" title="Synchronizovat se Supabase" @click="$emit('sync')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span>Sync</span>
        </button>
        <button class="win-btn-subtle" type="button" title="Přepnout tmavý / světlý motiv" @click="$emit('toggle-theme')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        </button>
        <button class="win-btn-subtle" type="button" title="Nápověda k PWA instalaci" @click="$emit('open-pwa-help')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue';
import { activeWorkDays } from '../../utils/attendance.js';
import { formatDuration } from '../../utils/time.js';
import { APP_VERSION } from '../../utils/version.js';

const props = defineProps({
  currentView: {
    type: String,
    required: true
  },
  currentUser: {
    type: Object,
    default: null
  },
  settings: {
    type: Object,
    required: true
  },
  syncState: {
    type: String,
    default: 'local'
  },
  isAdmin: {
    type: Boolean,
    default: false
  }
});

defineEmits(['navigate', 'user-click', 'sync', 'toggle-theme', 'open-pwa-help']);

const userDisplayName = computed(() => {
  return props.currentUser?.displayName || props.currentUser?.username || 'Nepřihlášen';
});

const userInitials = computed(() => {
  const name = props.currentUser?.displayName || props.currentUser?.username;
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
});

const userStatusClass = computed(() => {
  if (props.isAdmin) return 'online';
  if (props.currentUser && props.syncState === 'online') return 'online';
  return 'local';
});

const userStatusText = computed(() => {
  if (props.isAdmin) return 'Správce (Admin)';
  if (props.currentUser) return 'Cloud aktivní';
  return 'Lokální režim';
});

const planDaysLabel = computed(() => {
  const days = activeWorkDays(props.settings);
  const ordered = [1, 2, 3, 4, 5, 6, 0].filter(d => days.includes(d)).join(',');
  if (ordered === '1,2,3,4,5') return 'Po–Pá';
  if (ordered === '1,2,3,4,5,6') return 'Po–So';
  if (ordered === '1,2,3,4,5,6,0') return 'Po–Ne';
  const mapNames = { 1: 'Po', 2: 'Út', 3: 'St', 4: 'Čt', 5: 'Pá', 6: 'So', 0: 'Ne' };
  return days.map(d => mapNames[d]).join(', ') || 'Bez rozvrhu';
});

const planHoursLabel = computed(() => {
  return `${props.settings.workStart || '06:30'} – ${props.settings.workEnd || '15:00'}`;
});
</script>

