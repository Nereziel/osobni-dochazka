import { ref } from 'vue';
import { DEFAULT_SETTINGS, normalizeSettings } from '../utils/attendance.js';
import { cloneDeep } from '../utils/validation.js';
import { getUserSettings, putUserSettings, enqueueSyncAction } from '../services/indexedDb.js';
import { profileRowFromSettings } from '../services/sync.js';
import { supabaseRequest, isSupabaseConfigured } from '../services/supabase.js';

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
    settings.value = normalized;
    applyTheme();

    if (userId) {
      await putUserSettings(userId, normalized);

      if (!skipCloud && isSupabaseConfigured() && currentUser?.userKey) {
        const row = profileRowFromSettings(normalized, currentUser);
        try {
          await supabaseRequest(`/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(currentUser.userKey)}`, {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify(row)
          }, currentUser);
        } catch (err) {
          console.warn('Uložení nastavení na server selhalo, zařazeno do outboxu:', err);
          await enqueueSyncAction(userId, 'attendance_profiles', 'UPDATE', row);
        }
      }
    }

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

