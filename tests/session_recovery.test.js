import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/supabase.js', () => ({ supabaseRequest: vi.fn() }));
vi.mock('../src/services/indexedDb.js', () => ({ clearUserLocalData: vi.fn(async () => {}) }));

import { useAuth } from '../src/composables/useAuth.js';
import { supabaseRequest } from '../src/services/supabase.js';
import { clearUserLocalData } from '../src/services/indexedDb.js';

const auth = useAuth();
const user = { userKey: 'user:alice', username: 'alice', role: 'employee' };

beforeEach(() => {
  vi.clearAllMocks();
  auth.currentUser.value = { ...user };
});

describe('Session verification and recovery', () => {
  it.each([429, 403, 500, 502, 503, 504])('keeps local data on HTTP %i', async (status) => {
    supabaseRequest.mockRejectedValueOnce(Object.assign(new Error('service error'), { status }));
    expect(await auth.verifySession()).toBe(true);
    expect(auth.currentUser.value.userKey).toBe(user.userKey);
    expect(clearUserLocalData).not.toHaveBeenCalled();
  });

  it('returns invalid only for a missing or explicitly invalid session, without deleting data itself', async () => {
    supabaseRequest.mockResolvedValueOnce({ success: false, error: 'invalid_session' });
    expect(await auth.verifySession()).toBe(false);
    supabaseRequest.mockRejectedValueOnce(Object.assign(new Error('missing'), { status: 401 }));
    expect(await auth.verifySession()).toBe(false);
    expect(clearUserLocalData).not.toHaveBeenCalled();
  });

  it('rejects a session belonging to another account', async () => {
    supabaseRequest.mockResolvedValueOnce({ success: true, user_key: 'user:bob', role: 'admin' });
    expect(await auth.verifySession()).toBe(false);
    expect(auth.currentUser.value.role).toBe('employee');
  });

  it('ignores a stale verification response after account change', async () => {
    let resolve;
    supabaseRequest.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = auth.verifySession();
    auth.currentUser.value = { userKey: 'user:bob', role: 'employee' };
    resolve({ success: false, error: 'invalid_session' });
    expect(await pending).toBe(true);
    expect(auth.currentUser.value.userKey).toBe('user:bob');
  });

  it('preserves pending changes on automatic logout without revoking another cookie', async () => {
    await auth.logout({ preservePending: true, revoke: false });
    expect(auth.currentUser.value).toBeNull();
    expect(clearUserLocalData).toHaveBeenCalledWith(user.userKey, { preservePending: true });
    expect(supabaseRequest).not.toHaveBeenCalled();
  });

  it('clears all local data on explicit logout after server revocation', async () => {
    supabaseRequest.mockResolvedValueOnce({ success: true });
    await auth.logout();
    expect(clearUserLocalData).toHaveBeenCalledWith(user.userKey);
    expect(supabaseRequest).toHaveBeenCalledWith('/rest/v1/rpc/logout_attendance_session', expect.any(Object));
    expect(auth.currentUser.value).toBeNull();
  });
});
