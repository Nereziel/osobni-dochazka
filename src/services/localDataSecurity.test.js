import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const indexedDbSource = fs.readFileSync(new URL('./indexedDb.js', import.meta.url), 'utf8');
const authSource = fs.readFileSync(new URL('../composables/useAuth.js', import.meta.url), 'utf8');

describe('local account data cleanup', () => {
  it('provides one cleanup operation for days, settings and queued sync payloads', () => {
    expect(indexedDbSource).toContain('export async function clearUserLocalData');
    expect(indexedDbSource).toContain("'user_days'");
    expect(indexedDbSource).toContain("'user_settings'");
    expect(indexedDbSource).toContain("'sync_queue'");
  });

  it('clears the signed-in user local data when logging out', () => {
    expect(authSource).toContain('clearUserLocalData');
    expect(authSource).toMatch(/await\s+clearUserLocalData\(priorUser\.userKey\)/);
  });
});
