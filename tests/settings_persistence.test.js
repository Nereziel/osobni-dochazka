import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/utils/attendance.js';

vi.mock('../src/services/indexedDb.js', () => ({
  getUserSettings: vi.fn(async () => null),
  putUserSettings: vi.fn(async () => {}),
  putUserSettingsWithOutbox: vi.fn(async () => {}),
  getPendingSyncActions: vi.fn(), removeSyncAction: vi.fn(), updateSyncAction: vi.fn(),
  enqueueSyncAction: vi.fn(), getUserDays: vi.fn(), putUserDay: vi.fn(), deleteUserDay: vi.fn()
}));
import * as db from '../src/services/indexedDb.js';
import { useSettings } from '../src/composables/useSettings.js';

const user = { userKey: 'user:a', username: 'a', displayName: 'A' };
describe('Durable settings saves', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    db.putUserSettingsWithOutbox.mockResolvedValue(undefined);
    await useSettings().loadSettings(null);
  });
  it('journals cloud settings in a single operation, without rewriting the profile name', async () => {
    const model = useSettings();
    await model.saveSettings(user.userKey, { ...DEFAULT_SETTINGS, dailyTargetMinutes: 420 }, user);
    expect(db.putUserSettingsWithOutbox).toHaveBeenCalledWith(user.userKey,
      expect.objectContaining({ dailyTargetMinutes: 420 }),
      expect.objectContaining({ user_key: user.userKey, daily_target_minutes: 420 }));
    expect(db.putUserSettingsWithOutbox.mock.calls[0][2]).not.toHaveProperty('display_name');
    expect(db.putUserSettings).not.toHaveBeenCalled();
    expect(model.settings.value.dailyTargetMinutes).toBe(420);
  });
  it('does not publish uncommitted settings after a failed transaction', async () => {
    const model = useSettings();
    db.putUserSettingsWithOutbox.mockRejectedValueOnce(new Error('Quota'));
    await expect(model.saveSettings(user.userKey, { ...DEFAULT_SETTINGS, dailyTargetMinutes: 420 }, user)).rejects.toThrow('Quota');
    expect(model.settings.value.dailyTargetMinutes).toBe(DEFAULT_SETTINGS.dailyTargetMinutes);
  });
  it('keeps local-only settings out of the cloud queue', async () => {
    await useSettings().saveSettings('user:local', DEFAULT_SETTINGS);
    expect(db.putUserSettings).toHaveBeenCalled();
    expect(db.putUserSettingsWithOutbox).not.toHaveBeenCalled();
  });
  it('rejects an account mismatch before writing', async () => {
    await expect(useSettings().saveSettings('user:b', DEFAULT_SETTINGS, user)).rejects.toThrow();
    expect(db.putUserSettingsWithOutbox).not.toHaveBeenCalled();
  });
});
