import { describe, expect, it } from 'vitest';
import {
  auditActionLabel,
  auditActorLabel,
  auditTargetLabel,
  auditDetailLabel
} from '../src/utils/audit.js';

describe('audit display helpers', () => {
  it('maps known security actions to readable Czech labels', () => {
    expect(auditActionLabel('admin_change_user_role')).toBe('Změna role uživatele');
    expect(auditActionLabel('admin_reset_user_pin')).toBe('Reset PINu uživatele');
    expect(auditActionLabel('admin_delete_user')).toBe('Smazání uživatele');
    expect(auditActionLabel('admin_create_invite')).toBe('Vytvoření pozvánky');
    expect(auditActionLabel('admin_delete_invite')).toBe('Smazání pozvánky');
    expect(auditActionLabel('admin_step_up')).toBe('Ověření správce');
  });

  it('falls back safely for unknown actions', () => {
    expect(auditActionLabel('future_security_event')).toBe('future security event');
    expect(auditActionLabel('')).toBe('Neznámá událost');
  });

  it('prefers display name, then username, then user key for actors and targets', () => {
    expect(auditActorLabel({ actor_display_name: 'Jan Novák', actor_username: 'jnovak', actor_user_key: 'user:jnovak' })).toBe('Jan Novák');
    expect(auditActorLabel({ actor_username: 'jnovak', actor_user_key: 'user:jnovak' })).toBe('jnovak');
    expect(auditActorLabel({ actor_user_key: 'user:jnovak' })).toBe('jnovak');
    expect(auditActorLabel({})).toBe('Systém');

    expect(auditTargetLabel({ target_display_name: 'Petr Svoboda', target_username: 'psvoboda', target_user_key: 'user:psvoboda' })).toBe('Petr Svoboda');
    expect(auditTargetLabel({ target_user_key: 'user:psvoboda' })).toBe('psvoboda');
    expect(auditTargetLabel({})).toBe('—');
  });

  it('renders only useful, non-sensitive event details', () => {
    expect(auditDetailLabel({ action: 'admin_change_user_role', details: { from: 'employee', to: 'admin' } })).toBe('Zaměstnanec → Správce');
    expect(auditDetailLabel({ action: 'admin_create_invite', details: { expires_at: '2026-11-16T12:00:00Z' } })).toContain('Platnost do');
    expect(auditDetailLabel({ action: 'admin_delete_user', details: { role: 'employee' } })).toBe('Role: Zaměstnanec');
    expect(auditDetailLabel({ action: 'admin_reset_user_pin', details: { secret: 'must-not-render' } })).toBe('');
  });
});
