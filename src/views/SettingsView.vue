<template>
  <section class="win11-view active">
    <div class="settings-two-columns">
      <!-- LEVÝ SLOUPEC: PRACOVNÍ DOBA, VÍKENDY A SVÁTKY -->
      <div class="settings-col">
        <form
          class="win-card settings-group-card"
          @submit.prevent="submitScheduleSettings"
        >
          <div class="settings-group-header">
            <div class="icon-wrap">
              ⏱️
            </div>
            <div>
              <h3>Běžná pracovní doba a fond</h3>
              <p>Základní parametry tvých pracovních dnů. Ukládají se do tvého osobního profilu v databázi.</p>
            </div>
          </div>

          <div class="settings-form-grid">
            <label class="win-field">
              <span>Běžný příchod</span>
              <input
                v-model="formSettings.workStart"
                type="time"
                required
              >
            </label>
            <label class="win-field">
              <span>Běžný odchod</span>
              <input
                v-model="formSettings.workEnd"
                type="time"
                required
              >
            </label>
            <label class="win-field">
              <span>Denní pracovní fond</span>
              <input
                v-model="dailyTargetInput"
                type="time"
                required
              >
            </label>
            <label class="win-field">
              <span>Délka přestávky</span>
              <div class="win-input-suffix">
                <input
                  v-model.number="formSettings.breakMinutes"
                  type="number"
                  min="0"
                  max="240"
                  step="5"
                  required
                >
                <span>min</span>
              </div>
            </label>
            <label class="win-field">
              <span>Zákonná přestávka po odpracování</span>
              <div class="win-input-suffix">
                <input
                  v-model.number="formSettings.breakAfterMinutes"
                  type="number"
                  min="0"
                  max="1440"
                  step="15"
                  required
                >
                <span>min</span>
              </div>
              <small
                class="muted"
                style="margin-top: 2px;"
              >Standardně 360 min (6 h) dle § 88 Zákoníku práce. U směn pod 6 h se přestávka nestrhává.</small>
            </label>
          </div>

          <div class="field-helper-action">
            <button
              class="win-btn-subtle"
              type="button"
              @click="calcTargetAuto"
            >
              ↻ Spočítat denní fond z příchodu, odchodu a přestávky
            </button>
          </div>

          <div class="win-toggle-control">
            <label class="switch-label">
              <input
                v-model="formSettings.autoFill"
                type="checkbox"
              >
              <span class="switch-slider" />
              <div class="switch-text">
                <strong>Automaticky předvyplňovat pracovní dobu</strong>
                <small>Při otevření dne se rovnou doplní obvyklý příchod a odchod.</small>
              </div>
            </label>
          </div>

          <!-- VÍKENDOVÝ ROZVRH -->
          <div class="settings-subgroup-divider">
            <h4>Pracovní dny v týdnu a víkendy</h4>
            <p>Nastav, které dny v týdnu máš pracovat a jak se mají chovat víkendy.</p>
          </div>

          <div class="win-field">
            <span>Režim práce o víkendu</span>
            <select
              v-model="formSettings.weekendMode"
              class="win-select"
              @change="handleWeekendModeChange"
            >
              <option value="none">
                Pouze všední dny (Po–Pá)
              </option>
              <option value="saturday">
                Pracuji i v sobotu (Po–So)
              </option>
              <option value="sunday">
                Pracuji i v neděli (Po–Pá + Ne)
              </option>
              <option value="both">
                Pracuji celý víkend (Po–Ne)
              </option>
              <option value="custom">
                Vlastní výběr dnů
              </option>
            </select>
          </div>

          <div class="weekday-chips-group">
            <span class="field-sub-label">Aktivní dny započítané do fondu:</span>
            <div class="chips-row">
              <label
                v-for="d in weekDayOptions"
                :key="d.val"
                class="chip-item"
                :class="{ weekend: d.val === 6 || d.val === 0 }"
              >
                <input
                  type="checkbox"
                  :value="d.val"
                  :checked="formSettings.workDays.includes(d.val)"
                  @change="toggleWorkDay(d.val, $event.target.checked)"
                >
                <span>{{ d.label }}</span>
              </label>
            </div>
          </div>

          <div class="win-toggle-control">
            <label class="switch-label">
              <input
                v-model="formSettings.weekendCustomHours"
                type="checkbox"
              >
              <span class="switch-slider" />
              <div class="switch-text">
                <strong>Odlišná pracovní doba o víkendu</strong>
                <small>Umožní nastavit jiný čas i fond pro sobotní/nedělní směny.</small>
              </div>
            </label>
          </div>

          <div
            v-if="formSettings.weekendCustomHours"
            class="custom-weekend-panel"
          >
            <div class="settings-form-grid three-col">
              <label class="win-field">
                <span>Víkendový příchod</span>
                <input
                  v-model="formSettings.weekendStart"
                  type="time"
                >
              </label>
              <label class="win-field">
                <span>Víkendový odchod</span>
                <input
                  v-model="formSettings.weekendEnd"
                  type="time"
                >
              </label>
              <label class="win-field">
                <span>Víkendový fond</span>
                <input
                  v-model="weekendTargetInput"
                  type="time"
                >
              </label>
            </div>
          </div>

          <div class="win-toggle-control">
            <label class="switch-label">
              <input
                v-model="formSettings.workOnHolidays"
                type="checkbox"
              >
              <span class="switch-slider" />
              <div class="switch-text">
                <strong>Pracuji i ve státní svátky</strong>
                <small>Svátek se bude počítat jako běžný pracovní den s předepsaným fondem.</small>
              </div>
            </label>
          </div>

          <div class="settings-save-row">
            <button
              class="win-btn-accent"
              type="submit"
            >
              Uložit nastavení pracovní doby
            </button>
          </div>
        </form>
      </div>

      <!-- PRAVÝ SLOUPEC: ÚČET, SUPABASE CLOUD A ZÁLOHY -->
      <div class="settings-col">
        <!-- ÚČET & PROFIL -->
        <article class="win-card settings-group-card highlight-card">
          <div class="settings-group-header">
            <div class="icon-wrap user">
              👤
            </div>
            <div>
              <h3>Můj účet &amp; Profil</h3>
              <p>{{ accountStatusSubtitle }}</p>
            </div>
          </div>

          <div class="account-profile-view">
            <div class="avatar-large">
              {{ userInitials }}
            </div>
            <div class="account-text-info">
              <div
                v-if="!isEditingName"
                class="account-name-row"
              >
                <strong>{{ accountFullName }}</strong>
                <button
                  v-if="currentUser"
                  class="icon-edit-name-btn"
                  type="button"
                  title="Upravit zobrazované jméno"
                  aria-label="Upravit zobrazované jméno"
                  @click="startEditingName"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    width="14"
                    height="14"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
              </div>
              <div
                v-else
                class="account-name-edit-row"
              >
                <input
                  ref="nameInputRef"
                  v-model="editableDisplayName"
                  type="text"
                  class="inline-name-input"
                  placeholder="Celé jméno"
                  @keyup.enter="saveDisplayName"
                  @keyup.esc="cancelEditingName"
                >
                <button
                  class="inline-name-btn save"
                  type="button"
                  title="Uložit jméno (Enter)"
                  @click="saveDisplayName"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    width="14"
                    height="14"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
                <button
                  class="inline-name-btn cancel"
                  type="button"
                  title="Zrušit úpravu (Esc)"
                  @click="cancelEditingName"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    width="14"
                    height="14"
                  >
                    <line
                      x1="18"
                      y1="6"
                      x2="6"
                      y2="18"
                    />
                    <line
                      x1="6"
                      y1="6"
                      x2="18"
                      y2="18"
                    />
                  </svg>
                </button>
              </div>
              <span class="muted">{{ accountUsernameText }}</span>
              <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px; flex-wrap: wrap;">
                <span
                  class="status-indicator-pill"
                  :class="syncBadgeClass"
                >{{ syncBadgeText }}</span>
                <span
                  v-if="currentUser"
                  class="role-badge"
                  :class="isAdmin ? 'admin' : 'employee'"
                >
                  {{ isAdmin ? 'Správce (Admin)' : 'Zaměstnanec' }}
                </span>
              </div>
            </div>
          </div>

          <div class="account-actions-row">
            <button
              v-if="!currentUser"
              class="win-btn-accent"
              type="button"
              @click="$emit('open-login')"
            >
              Přihlásit se
            </button>
            <button
              v-if="!currentUser"
              class="win-btn-standard"
              type="button"
              @click="$emit('open-register')"
            >
              Registrace s pozvánkou
            </button>
            <button
              v-if="currentUser"
              class="win-btn-standard"
              type="button"
              @click="$emit('open-change-pin')"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                width="16"
                height="16"
              >
                <rect
                  x="3"
                  y="11"
                  width="18"
                  height="11"
                  rx="2"
                  ry="2"
                /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>Změnit PIN / heslo</span>
            </button>
            <button
              v-if="currentUser"
              class="win-btn-subtle danger-btn"
              type="button"
              @click="$emit('logout')"
            >
              Odhlásit
            </button>
          </div>
        </article>

        <!-- KARTA SPRÁVA TÝMU A POZVÁNEK (PRO SPRÁVCE) -->
        <article
          v-if="isAdmin"
          class="win-card settings-group-card highlight-card"
        >
          <div class="settings-group-header">
            <div
              class="icon-wrap"
              style="background: var(--accent-light); color: var(--accent); font-size: 20px;"
            >
              👥
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <h3 style="margin: 0;">
                  Správa týmu &amp; Pozvánky
                </h3>
                <span class="role-badge admin">Správce</span>
              </div>
              <p style="margin: 4px 0 0;">
                Generování pozvánek pro nové zaměstnance, správa hesel a měsíční přehled týmu.
              </p>
            </div>
          </div>

          <div
            class="settings-save-row"
            style="margin-top: 14px;"
          >
            <button
              class="win-btn-accent full-width-btn"
              type="button"
              style="justify-content: center; gap: 8px;"
              @click="$emit('open-team')"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                width="18"
                height="18"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle
                  cx="9"
                  cy="7"
                  r="4"
                /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>Otevřít správu týmu a pozvánek</span>
            </button>
          </div>
        </article>

        <!-- CLOUD DATABÁZE -->
        <article class="win-card settings-group-card">
          <div class="settings-group-header">
            <div class="icon-wrap cloud">
              ⚡
            </div>
            <div>
              <h3>Cloud Databáze</h3>
              <p>Centrální úložiště pro synchronizaci docházky mezi mobilem a počítačem.</p>
            </div>
          </div>

          <div
            v-if="isBuiltInSupabase"
            class="win-infobar success"
          >
            <div class="infobar-icon">
              ✓
            </div>
            <div class="infobar-body">
              <strong>Automaticky připojeno</strong>
              <p>Aplikace používá cloudovou databázi nastavenou v konfiguraci.</p>
            </div>
          </div>

          <div
            v-else
            class="supabase-manual-box"
          >
            <label class="win-field">
              <span>Supabase Project URL</span>
              <input
                v-model="manualSbUrl"
                type="url"
                placeholder="https://abcdef.supabase.co"
                autocomplete="off"
              >
            </label>
            <label class="win-field">
              <span>Supabase Anon Public Key</span>
              <input
                v-model="manualSbKey"
                type="password"
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                autocomplete="off"
              >
            </label>
            <div class="manual-save-row">
              <button
                class="win-btn-accent"
                type="button"
                @click="saveManualSupabase"
              >
                Uložit a otestovat připojení
              </button>
            </div>
          </div>

          <div class="cloud-tools-buttons">
            <button
              class="win-btn-standard"
              type="button"
              @click="$emit('sync')"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                width="16"
                height="16"
              >
                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <span>Synchronizovat data nyní</span>
            </button>
          </div>
        </article>

        <!-- VZHLED A ZÁLOHOVÁNÍ DAT -->
        <article class="win-card settings-group-card">
          <div class="settings-group-header">
            <div class="icon-wrap">
              🎨
            </div>
            <div>
              <h3>Vzhled a lokální záloha</h3>
              <p>Přizpůsobení motivu a export offline zálohy.</p>
            </div>
          </div>

          <div class="win-field">
            <span>Barevný motiv aplikace</span>
            <select
              :value="settings.theme"
              class="win-select"
              @change="$emit('change-theme', $event.target.value)"
            >
              <option value="system">
                Podle Windows / telefonu (automaticky)
              </option>
              <option value="light">
                Světlý motiv (Mica Light)
              </option>
              <option value="dark">
                Tmavý motiv (Mica Dark)
              </option>
            </select>
          </div>

          <div class="backup-actions-grid">
            <button
              class="win-btn-standard"
              type="button"
              @click="$emit('export-backup')"
            >
              ⬇ Exportovat JSON zálohu
            </button>
            <button
              class="win-btn-standard"
              type="button"
              @click="triggerImportFile"
            >
              ⬆ Importovat JSON zálohu
            </button>
            <input
              ref="fileInputRef"
              type="file"
              accept="application/json,.json"
              hidden
              @change="handleFileChange"
            >
            <button
              class="win-btn-subtle danger-btn"
              type="button"
              @click="$emit('reset-local-data')"
            >
              Vymazat lokální data v prohlížeči
            </button>
          </div>
        </article>

        <!-- INFORMACE O APLIKACI -->
        <article class="win-card settings-group-card app-about-card">
          <div class="settings-group-header">
            <div
              class="icon-wrap"
              style="background: var(--accent-light); color: var(--accent); font-size: 18px;"
            >
              ℹ️
            </div>
            <div>
              <h3>O aplikaci</h3>
              <p>Osobní docházka 11</p>
            </div>
          </div>

          <div class="app-version-grid">
            <div class="app-version-item">
              <span class="muted">Verze aplikace:</span>
              <strong>v{{ APP_VERSION }} ({{ APP_BUILD_DATE }})</strong>
            </div>
            <div class="app-version-item">
              <span class="muted">Režim běhu:</span>
              <span class="win-badge positive">PWA Offline Ready</span>
            </div>
            <div class="app-version-item">
              <span class="muted">Hostováno:</span>
              <span class="win-badge neutral">GitHub Pages</span>
            </div>
            <div class="app-version-item">
              <span class="muted">Architektura:</span>
              <span class="win-badge accent">IndexedDB + Supabase</span>
            </div>
          </div>

          <div class="about-card-actions">
            <button
              class="win-btn-subtle"
              type="button"
              @click="$emit('open-pwa-help')"
            >
              <span>Návod k instalaci aplikace</span>
            </button>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch, toRaw, nextTick } from 'vue';
import { minutesToTime, timeToMinutes, durationMinutes } from '../utils/time.js';
import { clampNumber, cloneDeep } from '../utils/validation.js';
import { getSupabaseConfig, saveManualSupabaseConfig } from '../services/supabase.js';
import { APP_VERSION, APP_BUILD_DATE } from '../utils/version.js';

const props = defineProps({
  settings: {
    type: Object,
    required: true
  },
  currentUser: {
    type: Object,
    default: null
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  syncState: {
    type: String,
    default: 'local'
  }
});

const emit = defineEmits([
  'save-settings',
  'update-profile-name',
  'change-theme',
  'open-login',
  'open-register',
  'open-change-pin',
  'logout',
  'open-team',
  'sync',
  'export-backup',
  'import-backup',
  'reset-local-data',
  'open-pwa-help',
  'toast'
]);

const formSettings = ref(cloneDeep(toRaw(props.settings)));

watch(() => props.settings, (newVal) => {
  formSettings.value = cloneDeep(toRaw(newVal));
}, { deep: true });

const dailyTargetInput = computed({
  get: () => minutesToTime(formSettings.value.dailyTargetMinutes),
  set: (val) => {
    const min = timeToMinutes(val);
    formSettings.value.dailyTargetMinutes = min ?? 480;
  }
});

const weekendTargetInput = computed({
  get: () => minutesToTime(formSettings.value.weekendTargetMinutes ?? 480),
  set: (val) => {
    const min = timeToMinutes(val);
    formSettings.value.weekendTargetMinutes = min ?? 480;
  }
});

const weekDayOptions = [
  { val: 1, label: 'Po' },
  { val: 2, label: 'Út' },
  { val: 3, label: 'St' },
  { val: 4, label: 'Čt' },
  { val: 5, label: 'Pá' },
  { val: 6, label: 'So' },
  { val: 0, label: 'Ne' }
];

function handleWeekendModeChange() {
  const m = formSettings.value.weekendMode;
  let days = [1, 2, 3, 4, 5];
  if (m === 'saturday') days = [1, 2, 3, 4, 5, 6];
  else if (m === 'sunday') days = [1, 2, 3, 4, 5, 0];
  else if (m === 'both') days = [1, 2, 3, 4, 5, 6, 0];
  else if (m === 'custom') return;
  formSettings.value.workDays = days;
}

function toggleWorkDay(dayVal, isChecked) {
  const current = new Set(formSettings.value.workDays);
  if (isChecked) current.add(dayVal);
  else current.delete(dayVal);
  formSettings.value.workDays = Array.from(current);

  const sorted = [1, 2, 3, 4, 5, 6, 0].filter(d => current.has(d)).join(',');
  let m = 'custom';
  if (sorted === '1,2,3,4,5') m = 'none';
  else if (sorted === '1,2,3,4,5,6') m = 'saturday';
  else if (sorted === '1,2,3,4,5,0') m = 'sunday';
  else if (sorted === '1,2,3,4,5,6,0') m = 'both';
  formSettings.value.weekendMode = m;
}

function calcTargetAuto() {
  const dur = durationMinutes(formSettings.value.workStart, formSettings.value.workEnd);
  const brk = clampNumber(formSettings.value.breakMinutes, 0, 240, 30);
  const net = Math.max(0, dur - brk);
  formSettings.value.dailyTargetMinutes = net;
  emit('toast', `Denní fond nastaven na ${minutesToTime(net)}`, '✓');
}

function submitScheduleSettings() {
  emit('save-settings', cloneDeep(formSettings.value));
}

// Účet info
const editableDisplayName = ref(props.currentUser?.displayName || '');
const isEditingName = ref(false);
const nameInputRef = ref(null);

watch(() => props.currentUser?.displayName, (newVal) => {
  editableDisplayName.value = newVal || '';
});

function startEditingName() {
  editableDisplayName.value = props.currentUser?.displayName || props.currentUser?.username || '';
  isEditingName.value = true;
  nextTick(() => {
    nameInputRef.value?.focus();
    nameInputRef.value?.select();
  });
}

function cancelEditingName() {
  editableDisplayName.value = props.currentUser?.displayName || '';
  isEditingName.value = false;
}

function saveDisplayName() {
  const clean = editableDisplayName.value.trim();
  if (!clean) return;
  isEditingName.value = false;
  if (clean !== (props.currentUser?.displayName || '')) {
    emit('update-profile-name', clean);
  }
}

const accountStatusSubtitle = computed(() => {
  return props.currentUser ? 'Přihlášený profil' : 'Přihlaš se svým jménem a PINem.';
});

const userInitials = computed(() => {
  const name = props.currentUser?.displayName || props.currentUser?.username;
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
});

const accountFullName = computed(() => {
  return props.currentUser?.displayName || 'Nepřihlášený uživatel';
});

const accountUsernameText = computed(() => {
  return props.currentUser ? `@${props.currentUser.username}` : 'Lokální data v tomto zařízení';
});

const syncBadgeClass = computed(() => {
  if (props.currentUser && props.syncState === 'online') return 'online';
  return 'local';
});

const syncBadgeText = computed(() => {
  if (props.currentUser && props.syncState === 'online') return 'Cloud synchronizováno';
  return 'Pouze lokální úložiště';
});

// Supabase config
const sbConfig = getSupabaseConfig();
const isBuiltInSupabase = ref(sbConfig.isBuiltIn);
const manualSbUrl = ref(sbConfig.url);
const manualSbKey = ref(sbConfig.anonKey);

function saveManualSupabase() {
  saveManualSupabaseConfig(manualSbUrl.value, manualSbKey.value);
  emit('toast', 'Supabase konfigurace uložena', '✓');
  emit('sync');
}

// Backup Import / Export
const fileInputRef = ref(null);

function triggerImportFile() {
  fileInputRef.value?.click();
}

function handleFileChange(e) {
  const file = e.target.files?.[0];
  if (file) {
    emit('import-backup', file);
  }
  e.target.value = '';
}
</script>

