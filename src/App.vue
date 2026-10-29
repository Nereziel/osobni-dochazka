<template>
  <div class="win11-window">
    <!-- Desktop Sidebar -->
    <Sidebar
      :current-view="currentView"
      :current-user="currentUser"
      :settings="settings"
      :sync-state="syncState"
      :is-admin="isAdmin"
      @navigate="navigateView"
      @user-click="handleUserTileClick"
      @sync="triggerSync"
      @toggle-theme="toggleTheme"
      @open-pwa-help="openPwaHelp"
    />

    <!-- Hlavní obsahová část -->
    <div class="win11-main-wrapper">
      <!-- Horní lišta (App Header) -->
      <Header
        :view-title="currentViewTitle"
        :current-user="currentUser"
        :sync-state="syncState"
        :pending-count="pendingCount"
        :is-online="isOnline"
        @sync="triggerSync"
        @user-click="handleUserTileClick"
      />

      <!-- Hlavní plátno pohledů -->
      <main class="win11-content-area">
        <!-- 1. DASHBOARD -->
        <DashboardView
          v-if="currentView === 'dashboard'"
          :today-record="todayRecord"
          :records="records"
          :settings="settings"
          :active-shift="activeShift"
          :month-stats="dashboardMonthStats"
          @edit-day="openDayEditor"
          @end-shift="handleQuickDeparture"
          @quick-arrival="handleQuickArrival"
          @quick-departure="handleQuickDeparture"
          @quick-normal="handleQuickNormalHours"
          @quick-vacation="handleQuickVacation"
          @quick-preset="handleQuickPreset"
          @go-to-timesheet="navigateView('timesheet')"
        />

        <!-- 2. KALENDÁŘ -->
        <CalendarView
          v-else-if="currentView === 'calendar'"
          :current-month="calendarMonth"
          :records="records"
          :settings="settings"
          :stats="calendarStats"
          @change-month="calendarMonth = $event"
          @open-month-picker="openMonthPicker('calendar')"
          @fill-missing="handleFillMissing"
          @edit-day="openDayEditor"
        />

        <!-- 3. MĚSÍČNÍ VÝKAZ (TIMESHEET) -->
        <TimesheetView
          v-else-if="currentView === 'timesheet'"
          :current-month="timesheetMonth"
          :records="records"
          :settings="settings"
          :current-user="currentUser"
          :stats="timesheetStats"
          :year-vacation="yearVacationCount"
          :month-vacation="monthVacationCount"
          @change-month="timesheetMonth = $event"
          @open-month-picker="openMonthPicker('timesheet')"
          @fill-missing="handleFillMissing"
          @export-csv="handleExportCsv"
          @edit-day="openDayEditor"
        />

        <!-- 4. NASTAVENÍ -->
        <SettingsView
          v-else-if="currentView === 'settings'"
          :settings="settings"
          :current-user="currentUser"
          :is-admin="isAdmin"
          :sync-state="syncState"
          @save-settings="handleSaveSettings"
          @update-profile-name="handleUpdateProfileName"
          @change-theme="handleThemeChange"
          @open-login="openLoginModal"
          @open-register="openRegisterModal"
          @open-change-pin="openChangePinModal"
          @logout="handleLogout"
          @open-team="navigateView('team')"
          @sync="triggerSync"
          @export-backup="handleExportBackup"
          @import-backup="handleImportBackup"
          @reset-local-data="handleResetLocalData"
          @open-pwa-help="openPwaHelp"
          @toast="showToast"
        />

        <!-- 5. SPRÁVA TÝMU -->
        <TeamView
          v-else-if="currentView === 'team'"
          ref="teamViewRef"
          :current-user="currentUser"
          @back-to-settings="navigateView('settings')"
          @open-create-invite="openCreateInviteModal"
          @open-reset-pin="openAdminResetPinModal"
          @toast="showToast"
        />
      </main>

      <!-- Mobilní spodní navigace -->
      <MobileNav
        :current-view="currentView"
        @navigate="navigateView"
      />
    </div>

    <!-- Modální dialogy -->
    <DayEditModal
      ref="dayEditModalRef"
      :settings="settings"
      @save="handleDaySave"
      @delete="handleDayDelete"
    />

    <LoginModal
      ref="loginModalRef"
      @login-submit="handleLoginSubmit"
      @switch-to-register="openRegisterModal"
    />

    <RegisterModal
      ref="registerModalRef"
      @register-submit="handleRegisterSubmit"
      @switch-to-login="openLoginModal"
    />

    <ChangePinModal
      ref="changePinModalRef"
      @change-pin-submit="handleChangePinSubmit"
    />

    <CreateInviteModal
      ref="createInviteModalRef"
      @generate-invite="handleGenerateInvite"
      @toast="showToast"
    />

    <AdminResetPinModal
      ref="adminResetPinModalRef"
      @reset-pin-submit="handleAdminResetPinSubmit"
    />

    <MonthPickerModal
      ref="monthPickerModalRef"
      @select="handleMonthPickerSelect"
    />

    <PwaHelpModal ref="pwaHelpModalRef" />

    <Toast ref="toastRef" />

    <PwaUpdatePrompt />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import Header from './components/Common/Header.vue';
import Sidebar from './components/Common/Sidebar.vue';
import MobileNav from './components/Common/MobileNav.vue';
import Toast from './components/Common/Toast.vue';
import PwaUpdatePrompt from './components/Common/PwaUpdatePrompt.vue';
import PwaHelpModal from './components/Common/PwaHelpModal.vue';

import DashboardView from './views/DashboardView.vue';
import CalendarView from './views/CalendarView.vue';
import TimesheetView from './views/TimesheetView.vue';
import SettingsView from './views/SettingsView.vue';
import TeamView from './views/TeamView.vue';

import DayEditModal from './components/Attendance/DayEditModal.vue';
import LoginModal from './components/Auth/LoginModal.vue';
import RegisterModal from './components/Auth/RegisterModal.vue';
import ChangePinModal from './components/Auth/ChangePinModal.vue';
import CreateInviteModal from './components/Admin/CreateInviteModal.vue';
import AdminResetPinModal from './components/Admin/AdminResetPinModal.vue';
import MonthPickerModal from './components/Attendance/MonthPickerModal.vue';

import { useOnlineStatus } from './composables/useOnlineStatus.js';
import { useAuth } from './composables/useAuth.js';
import { useSettings } from './composables/useSettings.js';
import { useAttendance } from './composables/useAttendance.js';
import { useSync, setBootSyncTimestamp } from './composables/useSync.js';

import { openDatabase, clearUserDays, putUserSettings } from './services/indexedDb.js';
import { supabaseRequest, isSupabaseConfigured } from './services/supabase.js';
import { settingsFromProfileRow } from './services/sync.js';
import { formatClock } from './utils/time.js';
import { todayKey, startOfMonth } from './utils/dates.js';

// Composables
const { isOnline } = useOnlineStatus();
const {
  currentUser,
  isAdmin,
  login,
  register,
  changePin,
  updateDisplayName,
  logout,
  verifySession
} = useAuth();
const { settings, applyTheme, toggleTheme, loadSettings, saveSettings } = useSettings();
const {
  records,
  calendarMonth,
  timesheetMonth,
  loadRecords,
  saveDay,
  deleteDay,
  quickToday,
  fillMissingDaysInMonth,
  exportCsv,
  todayRecord,
  activeShift,
  calcMonthStats,
  calcYearVacation,
  calcMonthVacation
} = useAttendance();
const {
  syncState,
  pendingCount,
  refreshPendingCount,
  sync,
  startForegroundSync,
  stopForegroundSync,
  runBootSyncFlow,
  runResetLocalDataFlow
} = useSync();

// State
const currentView = ref('dashboard');
const monthPickerTarget = ref('calendar');

// Modal refs
const toastRef = ref(null);
const dayEditModalRef = ref(null);
const loginModalRef = ref(null);
const registerModalRef = ref(null);
const changePinModalRef = ref(null);
const createInviteModalRef = ref(null);
const adminResetPinModalRef = ref(null);
const monthPickerModalRef = ref(null);
const pwaHelpModalRef = ref(null);
const teamViewRef = ref(null);

function showToast(msg, icon = 'ℹ️') {
  toastRef.value?.show(msg, icon);
}

const currentViewTitle = computed(() => {
  const titles = {
    dashboard: 'Dnešní přehled',
    calendar: 'Kalendář směn',
    timesheet: 'Měsíční výkaz docházky',
    settings: 'Nastavení a databáze',
    team: 'Správa týmu a pozvánky'
  };
  return titles[currentView.value] || 'Docházka';
});

function navigateView(viewName) {
  currentView.value = viewName;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleUserTileClick() {
  if (currentUser.value) {
    navigateView('settings');
  } else {
    openLoginModal();
  }
}

// Statistiky pro pohledy
const dashboardMonthStats = computed(() => calcMonthStats(new Date(), settings.value));
const calendarStats = computed(() => calcMonthStats(calendarMonth.value, settings.value));
const timesheetStats = computed(() => calcMonthStats(timesheetMonth.value, settings.value));
const yearVacationCount = computed(() => calcYearVacation(timesheetMonth.value.getFullYear()));
const monthVacationCount = computed(() => calcMonthVacation(timesheetMonth.value));

// Ochrana proti držení F5 / spamování reloadu a nadměrnému čerpání limitu Supabase
const RELOAD_KEY_COOLDOWN_MS = 4000;
const MANUAL_SYNC_COOLDOWN_MS = 5000;
const REG_STATUS_CACHE_TTL_MS = 30000;

let lastManualSyncAt = 0;

function handleKeyDownReloadGuard(e) {
  const key = (e.key || '').toLowerCase();
  const isF5 = e.key === 'F5';
  const isCtrlR = (e.ctrlKey || e.metaKey) && !e.altKey && key === 'r';
  if (!isF5 && !isCtrlR) return;

  // Pokud uživatel drží klávesu F5 / Ctrl+R stisknutou (auto-repeat), okamžitě zablokujeme opakování
  if (e.repeat) {
    e.preventDefault();
    return;
  }

  try {
    const now = Date.now();
    const lastReloadKey = Number(sessionStorage.getItem('dochazka_last_reload_key_ts') || 0);
    if (now - lastReloadKey < RELOAD_KEY_COOLDOWN_MS) {
      e.preventDefault();
      showToast('Aplikace byla právě obnovena – šetřím limit databáze', '🛡️');
      return;
    }
    sessionStorage.setItem('dochazka_last_reload_key_ts', String(now));
  } catch {
    // ignore storage errors
  }
}

// Init
onMounted(async () => {
  window.addEventListener('keydown', handleKeyDownReloadGuard);
  try {
    await openDatabase();
    const userKey = currentUser.value?.userKey || 'user:local';
    await Promise.all([
      loadSettings(userKey),
      loadRecords(userKey)
    ]);
    applyTheme();
    await refreshPendingCount(userKey);

    // Kontrola pozvánky z URL adresy (?invite=INV-...)
    const urlParams = new URLSearchParams(window.location.search);
    const inviteParam = urlParams.get('invite');
    if (inviteParam) {
      openRegisterModal(inviteParam.trim().toUpperCase());
      showToast(`Pozvánka ${inviteParam} byla načtena`, '✓');
    } else if (isSupabaseConfigured() && currentUser.value) {
      await runBootSyncFlow({
        currentUser: currentUser.value,
        settingsGetter: () => settings.value,
        verifySessionFn: verifySession,
        onInvalidSessionFn: handleInvalidSession,
        onSyncCompletedFn: handleSyncUpdate,
        triggerFullSyncFn: () => triggerSync(false, { isBoot: true }),
        startServiceFn: startSyncService
      });
    } else if (isSupabaseConfigured() && !currentUser.value) {
      openLoginModal();
    }
  } catch (err) {
    console.error('Inicializace aplikace selhala:', err);
    showToast('Inicializace aplikace selhala', '⚠️');
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDownReloadGuard);
});

async function applyServerProfile(serverProfile) {
  if (!serverProfile || !currentUser.value) return;
  if (serverProfile.display_name && serverProfile.display_name !== currentUser.value.displayName) {
    currentUser.value.displayName = serverProfile.display_name;
  }
  const newSettings = settingsFromProfileRow(serverProfile);
  if (newSettings) {
    settings.value = newSettings;
    await putUserSettings(currentUser.value.userKey, newSettings);
    applyTheme();
  }
}

async function handleSyncUpdate(recordsMap, serverProfile) {
  if (recordsMap) records.value = recordsMap;
  if (serverProfile) await applyServerProfile(serverProfile);
}

function performLocalLogout() {
  if (currentUser.value?.userKey) {
    setBootSyncTimestamp(currentUser.value.userKey, 0);
  }
  stopForegroundSync();
  logout();
  const userKey = 'user:local';
  loadSettings(userKey);
  loadRecords(userKey);
}

function handleInvalidSession() {
  performLocalLogout();
  showToast('Relace vypršela nebo byla odvolána. Přihlaste se prosím znovu.', '⚠️');
  openLoginModal();
}

function startSyncService() {
  if (!currentUser.value) return;
  startForegroundSync(currentUser.value, () => settings.value, handleSyncUpdate, {
    onVerifySession: verifySession,
    onInvalidSession: handleInvalidSession
  });
}

async function triggerSync(pushLocalDays = true, options = {}) {
  if (!currentUser.value) {
    openLoginModal();
    return;
  }

  const now = Date.now();
  if (!options.isBoot && now - lastManualSyncAt < MANUAL_SYNC_COOLDOWN_MS && pendingCount.value === 0) {
    showToast('Data jsou již aktuální (synchronizováno před okamžikem)', '✓');
    return;
  }

  try {
    const res = await sync(currentUser.value, () => settings.value, { pushLocalDays });
    const finishedAt = Date.now();
    lastManualSyncAt = finishedAt;
    setBootSyncTimestamp(currentUser.value.userKey, finishedAt);
    if (res?.recordsMap) {
      records.value = res.recordsMap;
    }
    if (res?.serverProfile) {
      await applyServerProfile(res.serverProfile);
    }
    showToast('Data byla synchronizována', '✓');
  } catch (err) {
    showToast(err.message || 'Synchronizace selhala', '⚠️');
  }
}

// Day Edit Handlers
function openDayEditor(dateKey) {
  let key = dateKey;
  if (typeof dateKey === 'function') {
    key = dateKey();
  } else if (dateKey && typeof dateKey === 'object' && dateKey.date) {
    key = dateKey.date;
  }
  if (!key || typeof key !== 'string') {
    key = todayKey();
  }
  const existing = records.value.get(key) || null;
  dayEditModalRef.value?.open(key, existing);
}

async function handleDaySave(day) {
  try {
    await saveDay(day, currentUser.value, settings.value);
    showToast('Den byl úspěšně uložen', '✓');
    await refreshPendingCount(currentUser.value?.userKey || 'user:local');
  } catch {
    showToast('Uložení selhalo', '⚠️');
  }
}

async function handleDayDelete(dateKey) {
  try {
    await deleteDay(dateKey, currentUser.value);
    showToast('Záznam byl smazán', '🗑️');
    await refreshPendingCount(currentUser.value?.userKey || 'user:local');
  } catch {
    showToast('Smazání selhalo', '⚠️');
  }
}

// Quick Actions
async function handleQuickArrival() {
  await quickToday((d) => {
    d.type = 'work';
    d.start = formatClock();
    d.end = '';
    d.manualBreak = false;
  }, currentUser.value, settings.value);
  showToast('Příchod zaznamenán', '✓');
}

async function handleQuickDeparture() {
  await quickToday((d, hours) => {
    d.type = 'work';
    if (!d.start) d.start = hours.start;
    d.end = formatClock();
    d.manualBreak = false;
  }, currentUser.value, settings.value);
  showToast('Odchod zaznamenán', '✓');
}

async function handleQuickNormalHours() {
  await quickToday((d, hours) => {
    d.type = 'work';
    d.start = hours.start;
    d.end = hours.end;
    d.manualBreak = false;
    d.breakMinutes = settings.value.breakMinutes;
  }, currentUser.value, settings.value);
  showToast('Běžná pracovní doba zapsána', '✓');
}

async function handleQuickVacation() {
  await quickToday((d) => {
    d.type = 'vacation';
    d.start = '';
    d.end = '';
  }, currentUser.value, settings.value);
  showToast('Zapsána celodenní dovolená', '✓');
}

async function handleQuickPreset(type) {
  const labels = {
    homeOffice: 'Zapsán Home office',
    doctor: 'Zapsán lékař (celodenní)',
    businessTrip: 'Zapsána služební cesta',
    compTime: 'Zapsáno náhradní volno'
  };

  await quickToday((d, hours) => {
    d.type = type;
    if (type === 'doctor') {
      d.doctorFullDay = true;
      d.start = '';
      d.end = '';
    } else if (type === 'compTime') {
      d.start = '';
      d.end = '';
    } else {
      d.start = hours.start;
      d.end = hours.end;
      d.manualBreak = false;
      d.breakMinutes = settings.value.breakMinutes;
    }
  }, currentUser.value, settings.value);
  showToast(labels[type] || 'Uloženo', '✓');
}

// Month Actions
async function handleFillMissing(monthDate) {
  const count = await fillMissingDaysInMonth(monthDate, currentUser.value, settings.value);
  showToast(`Doplněno ${count} pracovních dnů`, '✓');
}

function handleExportCsv(monthDate) {
  exportCsv(monthDate, settings.value);
  showToast('CSV výkaz stažen', '⬇');
}

function openMonthPicker(target) {
  monthPickerTarget.value = target;
  const initialDate = target === 'timesheet' ? timesheetMonth.value : calendarMonth.value;
  monthPickerModalRef.value?.open(initialDate);
}

function handleMonthPickerSelect(selectedDate) {
  if (monthPickerTarget.value === 'timesheet') {
    timesheetMonth.value = startOfMonth(selectedDate);
  } else {
    calendarMonth.value = startOfMonth(selectedDate);
  }
}

// Auth Handlers
async function fetchRegistrationStatusCached() {
  try {
    const cachedRaw = sessionStorage.getItem('dochazka_reg_status_cache_v1');
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached && Date.now() - cached.ts < REG_STATUS_CACHE_TTL_MS) {
        return cached.data;
      }
    }
  } catch {
    // ignore storage errors
  }

  const statusRes = await supabaseRequest('/rest/v1/rpc/registration_status', {
    method: 'POST'
  });

  try {
    sessionStorage.setItem('dochazka_reg_status_cache_v1', JSON.stringify({
      ts: Date.now(),
      data: statusRes
    }));
  } catch {
    // ignore storage errors
  }

  return statusRes;
}

async function openLoginModal() {
  if (isSupabaseConfigured()) {
    try {
      const statusRes = await fetchRegistrationStatusCached();
      // Pokud v databázi dosud není žádný profil, přesměrujeme rovnou na registraci prvního správce
      if (statusRes?.requires_invite === false) {
        openRegisterModal();
        return;
      }
    } catch {
      // fallback
    }
  }
  loginModalRef.value?.open();
}

async function handleLoginSubmit({ username, pin, rememberMe }) {
  loginModalRef.value?.setLoading(true);
  try {
    const { message } = await login(username, pin, rememberMe);
    loginModalRef.value?.close();
    showToast(message, '✓');
    const userKey = currentUser.value?.userKey;
    await Promise.all([loadSettings(userKey), loadRecords(userKey)]);
    if (isSupabaseConfigured()) {
      await triggerSync(false, { isBoot: true });
      startSyncService();
    }
  } catch (err) {
    alert(err.message || 'Přihlášení selhalo');
  } finally {
    loginModalRef.value?.setLoading(false);
  }
}

async function openRegisterModal(prefilledInvite = '') {
  loginModalRef.value?.close();
  let isFirst = false;
  if (isSupabaseConfigured()) {
    try {
      const statusRes = await fetchRegistrationStatusCached();
      // requires_invite je false právě tehdy, když v DB ještě není žádný profil (první uživatel)
      isFirst = statusRes?.requires_invite === false;
    } catch {
      // fallback
    }
  }
  registerModalRef.value?.open(isFirst, prefilledInvite);
}

async function handleRegisterSubmit({ username, displayName, pin, pinConfirm, inviteCode, mergeLocal }) {
  registerModalRef.value?.setLoading(true);
  try {
    const { message } = await register(username, displayName, pin, pinConfirm, inviteCode);
    try {
      sessionStorage.removeItem('dochazka_reg_status_cache_v1');
    } catch {
      // ignore
    }
    registerModalRef.value?.close();
    showToast(message, '✓');
    const userKey = currentUser.value?.userKey;
    await loadSettings(userKey);
    await loadRecords(userKey);
    if (isSupabaseConfigured()) {
      await triggerSync(mergeLocal, { isBoot: true });
      startSyncService();
    }
  } catch (err) {
    alert(err.message || 'Registrace selhala');
  } finally {
    registerModalRef.value?.setLoading(false);
  }
}

function openChangePinModal() {
  changePinModalRef.value?.open();
}

async function handleChangePinSubmit({ oldPin, newPin, newPinConfirm }) {
  changePinModalRef.value?.setLoading(true);
  try {
    const msg = await changePin(oldPin, newPin, newPinConfirm);
    changePinModalRef.value?.close();
    showToast(msg, '✓');
  } catch (err) {
    alert(err.message || 'Změna PINu selhala');
  } finally {
    changePinModalRef.value?.setLoading(false);
  }
}

function handleLogout() {
  if (!confirm('Opravdu se odhlásit z tohoto zařízení?')) return;
  performLocalLogout();
  showToast('Uživatel odhlášen', 'ℹ️');
}

// Settings Handlers
async function handleUpdateProfileName(newName) {
  try {
    await updateDisplayName(newName);
    showToast('Jméno profilu bylo aktualizováno', '✓');
  } catch (err) {
    alert(err.message || 'Aktualizace jména selhala');
  }
}

async function handleSaveSettings(newSettings) {
  const userKey = currentUser.value?.userKey || 'user:local';
  await saveSettings(userKey, newSettings, currentUser.value);
  showToast('Nastavení bylo uloženo', '✓');
}

function handleThemeChange(newTheme) {
  settings.value.theme = newTheme;
  applyTheme(newTheme);
  const userKey = currentUser.value?.userKey || 'user:local';
  saveSettings(userKey, settings.value, currentUser.value, true);
}

// Backup Handlers
function handleExportBackup() {
  const daysList = [...records.value.values()].sort((a, b) => a.date.localeCompare(b.date));
  const payload = {
    app: 'osobni-dochazka-win11',
    version: 4,
    exportedAt: new Date().toISOString(),
    user: currentUser.value ? { username: currentUser.value.username, displayName: currentUser.value.displayName } : null,
    settings: settings.value,
    days: daysList
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const fileName = `dochazka-zaloha-${todayKey()}.json`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('JSON záloha exportována', '💾');
}

async function handleImportBackup(file) {
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!Array.isArray(payload.days)) {
      throw new Error('Soubor není platná záloha docházky.');
    }
    const userKey = currentUser.value?.userKey || 'user:local';
    await clearUserDays(userKey);
    for (const d of payload.days) {
      await saveDay(d, currentUser.value, settings.value, true);
    }
    if (payload.settings) {
      await saveSettings(userKey, payload.settings, currentUser.value, true);
    }
    await loadRecords(userKey);
    showToast('Záloha úspěšně importována', '✓');
    if (isSupabaseConfigured() && currentUser.value) {
      triggerSync(true);
    }
  } catch (err) {
    alert(err.message || 'Import zálohy selhal');
  }
}

async function handleResetLocalData() {
  if (!confirm('Opravdu vymazat veškerá lokální data docházky v tomto zařízení?')) return;
  try {
    const res = await runResetLocalDataFlow({
      currentUser: currentUser.value,
      settingsGetter: () => settings.value,
      loadRecordsFn: loadRecords,
      onSyncCompletedFn: handleSyncUpdate
    });
    if (res?.status === 'pulled') {
      showToast('Lokální data vymazána a znovu načtena ze serveru', '✓');
    } else {
      showToast('Lokální data vymazána', '🗑️');
    }
  } catch (err) {
    showToast(err.message || 'Obnovení po výmazu selhalo', '⚠️');
  }
}

function openPwaHelp() {
  pwaHelpModalRef.value?.open();
}

// Admin Invite Handlers
function openCreateInviteModal() {
  createInviteModalRef.value?.open();
}

async function handleGenerateInvite() {
  createInviteModalRef.value?.setLoading(true);
  try {
    const res = await supabaseRequest('/rest/v1/rpc/admin_create_invite', {
      method: 'POST',
      body: JSON.stringify({})
    }, currentUser.value);

    if (res?.code) {
      const url = `${window.location.origin}${window.location.pathname}?invite=${res.code}`;
      createInviteModalRef.value?.setGenerated(res.code, url);
      showToast('Pozvánka vytvořena', '✓');
      teamViewRef.value?.refreshData();
    }
  } catch (err) {
    alert(err.message || 'Vytvoření pozvánky selhalo');
  } finally {
    createInviteModalRef.value?.setLoading(false);
  }
}

function openAdminResetPinModal(prof) {
  adminResetPinModalRef.value?.open(prof);
}

async function handleAdminResetPinSubmit({ targetUserKey, targetUsername, newPin }) {
  adminResetPinModalRef.value?.setLoading(true);
  try {
    await supabaseRequest('/rest/v1/rpc/admin_reset_user_pin', {
      method: 'POST',
      body: JSON.stringify({
        p_target_user_key: targetUserKey,
        p_new_pin: newPin
      })
    }, currentUser.value);

    adminResetPinModalRef.value?.close();
    showToast(`PIN pro ${targetUsername} byl resetován`, '✓');
  } catch (err) {
    alert(err.message || 'Reset PINu selhal');
  } finally {
    adminResetPinModalRef.value?.setLoading(false);
  }
}
</script>

