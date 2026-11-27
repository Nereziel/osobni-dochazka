import { getPendingSyncActions, getUserDay, conflictQueueSnapshot, acceptConflictServerVersion } from './indexedDb.js';
import { supabaseRequest } from './supabase.js';
import { localDayFromSupabaseRow } from './sync.js';
import { isValidDateKey } from '../utils/validation.js';

export function conflictDates(actions, userId) {
  return [...new Set(actions.filter(item => item.userId === userId &&
    item.entity === 'attendance_days' && item.conflict && isValidDateKey(item.payload?.date))
    .map(item => item.payload.date))].sort();
}

export async function listConflictDates(userId) {
  if (!userId) return [];
  return conflictDates(await getPendingSyncActions(userId), userId);
}

export async function reviewConflict(userId, date) {
  if (!userId || !isValidDateKey(date)) throw new Error('Neplatný účet nebo datum.');
  const actions = await getPendingSyncActions(userId);
  if (!conflictDates(actions, userId).includes(date)) throw new Error('Konflikt již není ve frontě.');
  const queue = conflictQueueSnapshot(actions, userId, date);
  const local = (await getUserDay(userId, date)) || null;
  // Unlike the offline-friendly periodic verification, destructive resolution
  // requires a successful live response with the exact account identity.
  const verified = await supabaseRequest('/rest/v1/rpc/verify_attendance_session', { method: 'POST' });
  if (verified?.success !== true || verified.user_key !== userId) {
    throw new Error('Relaci nelze ověřit. Přihlas se znovu ke stejnému účtu.');
  }
  const rows = await supabaseRequest(
    `/rest/v1/attendance_days?user_key=eq.${encodeURIComponent(userId)}&date=eq.${date}&select=*`
  );
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].user_key !== userId ||
      rows[0].date !== date || !rows[0].updated_at) {
    throw new Error('Cloudovou verzi nelze bezpečně načíst; lokální změna zůstává zachovaná.');
  }
  return { userId, date, queue, local, localSnapshot: JSON.stringify(local), server: localDayFromSupabaseRow(rows[0]) };
}

export async function adoptReviewedCloudVersion(review, userId) {
  if (!review || review.userId !== userId) throw new Error('Účet se změnil.');
  const fresh = await reviewConflict(userId, review.date);
  if (fresh.queue !== review.queue || fresh.localSnapshot !== review.localSnapshot ||
      JSON.stringify(fresh.server) !== JSON.stringify(review.server)) {
    throw new Error('Konflikt se mezitím změnil. Načti nový náhled.');
  }
  const accepted = await acceptConflictServerVersion(userId, review.date,
    review.queue, review.localSnapshot, fresh.server);
  if (!accepted) throw new Error('Lokální data se mezitím změnila. Načti nový náhled.');
}
