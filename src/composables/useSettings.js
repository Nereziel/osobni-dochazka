import { ref } from 'vue';
import { DEFAULT_SETTINGS, normalizeSettings } from '../utils/attendance.js';
import { cloneDeep } from '../utils/validation.js';
import { getUserSettings, putUserSettings, putUserSettingsWithOutbox } from '../services/indexedDb.js';
import { profileRowFromSettings } from '../services/sync.js';

const settings = ref(cloneDeep(DEFAULT_SETTINGS));

export function useSettings() {
  function applyTheme(themeVal = settings.value.theme) {
    if (typeof document === 'undefined') return;
    if (themeVal === 'light' || themeVal === 'dark') {
      document.documentElement.dataset.theme = themeVal;
    } else {
      document.documentElement.dataset.theme = 'system';
    }
  }

  function toggleTheme() {
    const cur = typeof document !== 'undefined' ? document.documentElement.dataset.theme : 'system';
    const next = cur === 'dark' ? 'light' : 'dark';
    settings.value.theme = next;
    applyTheme(next);
  }

  async function loadSettings(userId) {
    if (!userId) {
      settings.value = cloneDeep(DEFAULT_SETTINGS);
      applyTheme();
      return settings.value;
    }
    const saved = await getUserSettings(userId);
    settings.value = normalizeSettings(saved);
    applyTheme();
    return settings.value;
  }

  async function saveSettings(userId, newSettings, currentUser = null, skipCloud = false) {
    const normalized = normalizeSettings(newSettings);
    if (userId) {
      if (!skipCloud && currentUser?.userKey) {
        if (currentUser.userKey !== userId) throw new Error('Účet se změnil.');
        const row = profileRowFromSettings(normalized, currentUser);
        // The schedule editor must not overwrite a separately edited name.
        delete row.display_name;
        delete row.username;
        await putUserSettingsWithOutbox(userId, normalized, row);
      } else {
        await putUserSettings(userId, normalized);
      }
    }
    settings.value = normalized;
    applyTheme();

    return settings.value;
  }

  return {
    settings,
    applyTheme,
    toggleTheme,
    loadSettings,
    saveSettings
  };
}
