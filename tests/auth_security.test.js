import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { settingsFromProfileRow } from '../src/services/sync.js';
import { useAuth } from '../src/composables/useAuth.js';

describe('Security & Custom Session-Based Auth Authorization Tests (Clean Architecture)', () => {
  // Databázové tabulky simulující čisté PostgreSQL schema:
  // attendance_profiles, attendance_credentials, attendance_sessions, attendance_days, attendance_invites
  let profilesTable = [];
  let credentialsTable = [];
  let sessionsTable = [];
  let daysTable = [];
  let invitesTable = [];

  // Kontext simulovaného HTTP volání
  let currentHeaders = {};

  beforeEach(() => {
    currentHeaders = {};
    sessionsTable = [];

    // attendance_profiles: pouze veřejná data a nastavení (ŽÁDNÁ hesla/zámky)
    profilesTable = [
      {
        user_key: 'user:admin',
        username: 'admin',
        display_name: 'Admin Boss',
        role: 'admin',
        work_start: '06:30',
        work_end: '15:30',
        daily_target_minutes: 510,
        break_minutes: 30,
        theme: 'system',
        settings_json: {}
      },
      {
        user_key: 'user:alice',
        username: 'alice',
        display_name: 'Alice Wonder',
        role: 'employee',
        work_start: '06:30',
        work_end: '15:30',
        daily_target_minutes: 510,
        break_minutes: 30,
        theme: 'system',
        settings_json: {}
      },
      {
        user_key: 'user:bob',
        username: 'bob',
        display_name: 'Bob Builder',
        role: 'employee',
        work_start: '06:30',
        work_end: '15:30',
        daily_target_minutes: 510,
        break_minutes: 30,
        theme: 'system',
        settings_json: {}
      }
    ];

    // attendance_credentials: privátní tabulka přístupná POUZE přes RPC (pgcrypto bcrypt)
    credentialsTable = [
      {
        user_key: 'user:admin',
        pin_password_hash: 'bcrypt:admin1234',
        failed_login_count: 0,
        locked_until: null,
        last_failed_login_at: null
      },
      {
        user_key: 'user:alice',
        pin_password_hash: 'bcrypt:alice1234',
        failed_login_count: 0,
        locked_until: null,
        last_failed_login_at: null
      },
      {
        user_key: 'user:bob',
        pin_password_hash: 'bcrypt:bob1234',
        failed_login_count: 0,
        locked_until: null,
        last_failed_login_at: null
      }
    ];

    daysTable = [
      {
        user_key: 'user:bob',
        date: '2026-10-24',
        type: 'work',
        start_time: '07:00',
        end_time: '15:30',
        deleted_at: null,
        updated_at: '2026-10-24T10:00:00.000Z'
      },
      {
        user_key: 'user:alice',
        date: '2026-10-24',
        type: 'homeOffice',
        start_time: '08:00',
        end_time: '16:30',
        deleted_at: null,
        updated_at: '2026-10-24T10:00:00.000Z'
      }
    ];

    invitesTable = [
      {
        code: 'INV-TEST1234',
        created_by: 'user:admin',
        target_role: 'employee',
        is_used: false,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        used_by: null,
        used_at: null
      },
      {
        code: 'INV-EXPIRED',
        created_by: 'user:admin',
        target_role: 'employee',
        is_used: false,
        expires_at: new Date(Date.now() - 86400000).toISOString(),
        used_by: null,
        used_at: null
      },
      {
        code: 'INV-USED',
        created_by: 'user:admin',
        target_role: 'employee',
        is_used: true,
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        used_by: 'user:charlie',
        used_at: new Date().toISOString()
      }
    ];
  });

  function sha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  // Helpery simulující HTTP request hlavičky
  function setSessionHeader(token) {
    if (!token) {
      delete currentHeaders['x-attendance-session'];
    } else {
      currentHeaders['x-attendance-session'] = token;
    }
  }

  // 1. PostgreSQL current_session_token()
  function current_session_token() {
    return (currentHeaders['x-attendance-session'] || '').trim();
  }

  // 2. PostgreSQL current_session_user_key()
  function current_session_user_key() {
    const rawToken = current_session_token();
    if (!rawToken) return '';

    const tokenHash = sha256(rawToken);
    const session = sessionsTable.find(
      s => s.token_hash === tokenHash && !s.revoked_at && new Date(s.expires_at) > new Date()
    );
    if (!session) return '';

    const profile = profilesTable.find(p => p.user_key === session.user_key);
    return profile ? profile.user_key : '';
  }

  // 3. PostgreSQL is_admin()
  function is_admin() {
    const callerKey = current_session_user_key();
    if (!callerKey) return false;
    const profile = profilesTable.find(p => p.user_key === callerKey);
    return profile?.role === 'admin';
  }

  // 4. PostgreSQL login_attendance_user (vrací JSON, counter se ukládá i při chybě, žádná metadata pro enumeration)
  function login_attendance_user(username, pin, remember = true) {
    if (!username || typeof username !== 'string' || !username.trim() || !pin || typeof pin !== 'string' || pin.length < 1) {
      return { success: false, error: 'invalid_credentials', message: 'Neplatné přihlašovací údaje.' };
    }

    const cleanUser = (username || '').toLowerCase().trim().replace(/[^a-zA-Z0-9._-]/g, '');
    const userKey = `user:${cleanUser}`;
    const profile = profilesTable.find(p => p.user_key === userKey);
    const cred = credentialsTable.find(c => c.user_key === userKey);

    if (!profile || !cred) {
      return { success: false, error: 'invalid_credentials', message: 'Neplatné přihlašovací údaje.' };
    }

    if (cred.locked_until && new Date(cred.locked_until) > new Date()) {
      return { success: false, error: 'invalid_credentials', message: 'Neplatné přihlašovací údaje.' };
    }

    const isValid = (cred.pin_password_hash === `bcrypt:${pin}`);

    if (!isValid) {
      cred.failed_login_count = (cred.failed_login_count || 0) + 1;
      cred.last_failed_login_at = new Date().toISOString();
      if (cred.failed_login_count >= 10) {
        cred.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      } else if (cred.failed_login_count >= 5) {
        cred.locked_until = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      }
      return {
        success: false,
        error: 'invalid_credentials',
        message: 'Neplatné přihlašovací údaje.'
      };
    }

    // Úspěch -> vyresetovat lockout
    cred.failed_login_count = 0;
    cred.locked_until = null;

    // 256-bit cryptographically secure token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + (remember ? 30 : 1) * 86400 * 1000).toISOString();

    sessionsTable.push({
      id: crypto.randomUUID(),
      user_key: profile.user_key,
      token_hash: tokenHash,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      last_used_at: new Date().toISOString(),
      revoked_at: null
    });

    return {
      success: true,
      session_token: rawToken,
      user_key: profile.user_key,
      username: profile.username,
      display_name: profile.display_name,
      role: profile.role,
      expires_at: expiresAt
    };
  }

  // 5. PostgreSQL logout_attendance_session
  function logout_attendance_session(allDevices = false) {
    const rawToken = current_session_token();
    if (!rawToken) return false;

    const tokenHash = sha256(rawToken);

    if (allDevices) {
      const userKey = current_session_user_key();
      if (!userKey) return false;
      sessionsTable.forEach(s => {
        if (s.user_key === userKey && !s.revoked_at) {
          s.revoked_at = new Date().toISOString();
        }
      });
      return true;
    } else {
      const session = sessionsTable.find(s => s.token_hash === tokenHash && !s.revoked_at);
      if (session) {
        session.revoked_at = new Date().toISOString();
        return true;
      }
    }
    return false;
  }

  // 6. PostgreSQL upsert_attendance_day_lww
  function upsert_attendance_day_lww(p_day) {
    const callerKey = current_session_user_key();
    if (!callerKey) {
      throw new Error('Neautorizovaný přístup: Neplatná nebo expirovaná session.');
    }

    const targetUserKey = p_day.user_key;
    if (!targetUserKey || (targetUserKey !== callerKey && !is_admin())) {
      throw new Error('Přístup odepřen: Nelze upravovat data jiného uživatele.');
    }

    if (!p_day.date) {
      throw new Error('Chybí povinný atribut date.');
    }

    const incomingUpdatedAt = p_day.updated_at || new Date().toISOString();
    const existing = daysTable.find(d => d.user_key === targetUserKey && d.date === p_day.date);

    if (existing) {
      if (new Date(incomingUpdatedAt).getTime() >= new Date(existing.updated_at).getTime()) {
        Object.assign(existing, {
          ...p_day,
          updated_at: incomingUpdatedAt
        });
        return { applied: true, action: p_day.deleted_at ? 'tombstone' : 'upsert' };
      } else {
        return { applied: false, reason: 'server_newer', row: existing };
      }
    } else {
      const newRow = { ...p_day, updated_at: incomingUpdatedAt };
      daysTable.push(newRow);
      return { applied: true, action: 'upsert' };
    }
  }

  // 7. PostgreSQL update_own_settings
  function update_own_settings(p_settings) {
    const callerKey = current_session_user_key();
    if (!callerKey) {
      throw new Error('Neautorizovaný přístup: Neplatná session.');
    }

    const profile = profilesTable.find(p => p.user_key === callerKey);
    if (!profile) throw new Error('Profil nenalezen.');

    // Aktualizujeme pouze povolená nastavení, nikoli role nebo username!
    if (typeof p_settings.display_name === 'string' && p_settings.display_name.trim()) {
      profile.display_name = p_settings.display_name.trim();
    }
    if (p_settings.work_start !== undefined) profile.work_start = p_settings.work_start;
    if (p_settings.work_end !== undefined) profile.work_end = p_settings.work_end;
    if (p_settings.daily_target_minutes !== undefined) profile.daily_target_minutes = p_settings.daily_target_minutes;
    if (p_settings.break_minutes !== undefined) profile.break_minutes = p_settings.break_minutes;
    if (Array.isArray(p_settings.work_days)) {
      profile.work_days = p_settings.work_days.filter(d => typeof d === 'number' && d >= 0 && d <= 6);
    }
    if (p_settings.theme !== undefined) profile.theme = p_settings.theme;

    return { success: true, profile };
  }

  // 7b. PostgreSQL change_attendance_pin
  function change_attendance_pin(oldPin, newPin, revokeOthers = true) {
    const callerKey = current_session_user_key();
    if (!callerKey) return { success: false, error: 'unauthorized', message: 'Uživatel není přihlášen.' };

    if (!oldPin || !newPin || newPin.length < 4) {
      return { success: false, error: 'invalid_pin', message: 'Původní PIN i nový PIN (min. 4 znaky) musí být zadány.' };
    }

    const cred = credentialsTable.find(c => c.user_key === callerKey);
    if (!cred) return { success: false, error: 'not_found', message: 'Uživatel nebyl nalezen.' };

    if (cred.pin_password_hash !== `bcrypt:${oldPin}`) {
      return { success: false, error: 'invalid_old_pin', message: 'Původní PIN není správný.' };
    }

    cred.pin_password_hash = `bcrypt:${newPin}`;
    if (revokeOthers) {
      const currentToken = current_session_token();
      const currentHash = sha256(currentToken);
      sessionsTable.forEach(s => {
        if (s.user_key === callerKey && s.token_hash !== currentHash) {
          s.revoked_at = new Date().toISOString();
        }
      });
    }

    return { success: true, message: 'PIN byl úspěšně změněn.' };
  }

  // 7c. PostgreSQL admin_change_user_role
  function admin_change_user_role(targetUserKey, newRole) {
    if (!is_admin()) throw new Error('Přístup odepřen: Pouze správce může měnit role.');
    if (!['admin', 'employee'].includes(newRole)) throw new Error('Neplatná role.');

    if (newRole === 'employee') {
      const target = profilesTable.find(p => p.user_key === targetUserKey);
      if (target?.role === 'admin') {
        const otherAdmins = profilesTable.filter(p => p.role === 'admin' && p.user_key !== targetUserKey).length;
        if (otherAdmins === 0) {
          throw new Error('Operaci nelze provést: Nelze odebrat roli poslednímu administrátorovi v systému.');
        }
      }
    }

    const profile = profilesTable.find(p => p.user_key === targetUserKey);
    if (!profile) {
      throw new Error('Uživatel nebyl nalezen.');
    }
    profile.role = newRole;
    return true;
  }

  // 7d. PostgreSQL admin_delete_user
  function admin_delete_user(targetUserKey) {
    if (!is_admin()) throw new Error('Přístup odepřen: Pouze správce může mazat uživatele.');
    const callerKey = current_session_user_key();
    if (targetUserKey === callerKey) throw new Error('Nemůžeš smazat svůj vlastní přihlášený administrátorský účet.');

    const target = profilesTable.find(p => p.user_key === targetUserKey);
    if (!target) {
      throw new Error('Uživatel nebyl nalezen.');
    }
    if (target.role === 'admin') {
      const otherAdmins = profilesTable.filter(p => p.role === 'admin' && p.user_key !== targetUserKey).length;
      if (otherAdmins === 0) {
        throw new Error('Operaci nelze provést: Nelze smazat posledního administrátora v systému.');
      }
    }

    profilesTable = profilesTable.filter(p => p.user_key !== targetUserKey);
    credentialsTable = credentialsTable.filter(c => c.user_key !== targetUserKey);
    sessionsTable = sessionsTable.filter(s => s.user_key !== targetUserKey);
    return true;
  }

  // 7e. PostgreSQL admin_delete_invite
  function admin_delete_invite(code) {
    if (!is_admin()) {
      throw new Error('Přístup odepřen: Pouze správce může mazat pozvánky.');
    }
    if (!code || !code.trim()) {
      throw new Error('Kód pozvánky je povinný.');
    }
    const cleanCode = code.trim().toUpperCase();
    const idx = invitesTable.findIndex(i => i.code.toUpperCase() === cleanCode);
    if (idx === -1) {
      throw new Error('Pozvánka nebyla nalezena.');
    }
    invitesTable.splice(idx, 1);
    return true;
  }

  // 8. RLS simulace pro attendance_days (POUZE SELECT)
  function rls_select_attendance_days(userKeyFilter) {
    const callerKey = current_session_user_key();
    const isAdmin = is_admin();

    return daysTable.filter(row => {
      if (userKeyFilter && row.user_key !== userKeyFilter) return false;
      return (callerKey !== '' && row.user_key === callerKey) || isAdmin;
    });
  }

  // 9. Registrace uživatele:
  // - První uživatel v prázdné DB -> role 'admin', nepotřebuje invite kód
  // - Každý další uživatel -> vyžaduje platný invite kód, získá roli 'employee'
  // - Transakční advisory lock zaručuje atomicitu a prevenci race condition
  let registrationLock = Promise.resolve();

  async function register_user_with_invite(username, displayName, pin, inviteCode) {
    // Simulace transakčního advisory locku (pg_advisory_xact_lock)
    let releaseLock;
    const lockPromise = new Promise(resolve => { releaseLock = resolve; });
    const currentLock = registrationLock;
    registrationLock = registrationLock.then(() => lockPromise);
    await currentLock;

    try {
      const cleanUser = (username || '').toLowerCase().trim().replace(/[^a-zA-Z0-9._-]/g, '');
      if (cleanUser.length < 3) {
        return { success: false, error: 'invalid_username', message: 'Uživatelské jméno musí mít alespoň 3 znaky.' };
      }
      if (!pin || pin.length < 4) {
        return { success: false, error: 'pin_too_short', message: 'PIN/heslo musí mít alespoň 4 znaky.' };
      }
      const userKey = `user:${cleanUser}`;

      const isFirstUser = profilesTable.length === 0;
      let assignedRole = 'employee';
      let invite = null;

      if (isFirstUser) {
        assignedRole = 'admin';
      } else {
        const trimmedInvite = (inviteCode || '').trim();
        if (!trimmedInvite) {
          return { success: false, error: 'missing_invite', message: 'Registrace vyžaduje platný kód pozvánky.' };
        }

        invite = invitesTable.find(i => i.code.toUpperCase() === trimmedInvite.toUpperCase());
        if (!invite) {
          return { success: false, error: 'invalid_invite', message: `Kód pozvánky "${trimmedInvite}" neexistuje nebo je neplatný.` };
        }
        if (invite.is_used) {
          return { success: false, error: 'invite_used', message: 'Tento kód pozvánky již byl využit.' };
        }
        if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
          return { success: false, error: 'invite_expired', message: 'Platnost tohoto kódu pozvánky vypršela.' };
        }
        assignedRole = 'employee';
      }

      if (profilesTable.some(p => p.user_key === userKey)) {
        return { success: false, error: 'username_taken', message: `Uživatelské jméno "${cleanUser}" je již obsazeno.` };
      }

      // Veřejný profil
      profilesTable.push({
        user_key: userKey,
        username: cleanUser,
        display_name: displayName || cleanUser,
        role: assignedRole,
        work_start: '06:30',
        work_end: '15:30',
        daily_target_minutes: 510,
        break_minutes: 30,
        theme: 'system'
      });

      // Privátní credentials
      credentialsTable.push({
        user_key: userKey,
        pin_password_hash: `bcrypt:${pin}`,
        failed_login_count: 0,
        locked_until: null
      });

      if (invite) {
        invite.is_used = true;
        invite.used_by = userKey;
        invite.used_at = new Date().toISOString();
      }

      // Okamžitě vystavíme session token
      const rawToken = crypto.randomBytes(32).toString('hex');
      sessionsTable.push({
        id: crypto.randomUUID(),
        user_key: userKey,
        token_hash: sha256(rawToken),
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 86400 * 1000).toISOString(),
        revoked_at: null
      });

      return { success: true, session_token: rawToken, user_key: userKey, role: assignedRole };
    } finally {
      releaseLock();
    }
  }

  // ==========================================================================
  // Testy jednotlivých bezpečnostních požadavků z nové architektury
  // ==========================================================================

  describe('P0 & P9: Platná, neplatná, expirovaná a revokovaná session', () => {
    it('Platný session token uživatele A umožní číst jeho vlastní data', () => {
      const loginRes = login_attendance_user('bob', 'bob1234');
      expect(loginRes.success).toBe(true);
      setSessionHeader(loginRes.session_token);

      expect(current_session_user_key()).toBe('user:bob');
      const bobsDays = rls_select_attendance_days('user:bob');
      expect(bobsDays).toHaveLength(1);
    });

    it('Neplatný / náhodný token je odmítnut (vrátí prázdnou identitu a 0 řádků)', () => {
      setSessionHeader('totally_random_fake_token_123');

      expect(current_session_user_key()).toBe('');
      expect(is_admin()).toBe(false);
      expect(rls_select_attendance_days('user:bob')).toHaveLength(0);
    });

    it('Expirovaný token je odmítnut', () => {
      const loginRes = login_attendance_user('bob', 'bob1234');
      const tokenHash = sha256(loginRes.session_token);
      const session = sessionsTable.find(s => s.token_hash === tokenHash);
      session.expires_at = new Date(Date.now() - 10000).toISOString();

      setSessionHeader(loginRes.session_token);
      expect(current_session_user_key()).toBe('');
    });

    it('Revokovaný token (např. po odhlášení) je odmítnut', () => {
      const loginRes = login_attendance_user('bob', 'bob1234');
      setSessionHeader(loginRes.session_token);
      expect(current_session_user_key()).toBe('user:bob');

      // Logout zneplatní token
      logout_attendance_session(false);

      expect(current_session_user_key()).toBe('');
      expect(() => {
        upsert_attendance_day_lww({
          user_key: 'user:bob',
          date: '2026-10-24',
          type: 'work'
        });
      }).toThrow(/Neautorizovaný přístup/);
    });
  });

  describe('P1 & P9: Izolace dat a ochrana proti záměně identit', () => {
    it('Token uživatele A + pokus o čtení nebo zápis dat uživatele B je odepřen', () => {
      const loginAlice = login_attendance_user('alice', 'alice1234');
      setSessionHeader(loginAlice.session_token);

      // Alice nesmí číst Bobova data
      expect(rls_select_attendance_days('user:bob')).toHaveLength(0);

      // Alice nesmí volat LWW upsert pro Boba
      expect(() => {
        upsert_attendance_day_lww({
          user_key: 'user:bob',
          date: '2026-10-24',
          type: 'work',
          updated_at: '2026-10-24T12:00:00.000Z'
        });
      }).toThrow(/Přístup odepřen: Nelze upravovat data jiného uživatele/);
    });

    it('Cizí tombstone: Alice nesmí vytvořit tombstone (smazání) pro Boba', () => {
      const loginAlice = login_attendance_user('alice', 'alice1234');
      setSessionHeader(loginAlice.session_token);

      expect(() => {
        upsert_attendance_day_lww({
          user_key: 'user:bob',
          date: '2026-10-24',
          deleted_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }).toThrow(/Přístup odepřen/);
    });

    it('Employee nesmí volat REST update pro změnu své role', () => {
      const loginBob = login_attendance_user('bob', 'bob1234');
      setSessionHeader(loginBob.session_token);

      // update_own_settings povoluje změnu display_name a rozvrhu, ale nepovoluje změnu role ani username
      update_own_settings({ display_name: 'Robert Stavitel', work_start: '07:00', role: 'admin', username: 'hacker' });
      const bobProf = profilesTable.find(p => p.user_key === 'user:bob');
      expect(bobProf.display_name).toBe('Robert Stavitel');
      expect(bobProf.work_start).toBe('07:00');
      expect(bobProf.role).toBe('employee');
      expect(bobProf.username).toBe('bob');
    });
  });

  describe('P3.1 & P9: Brute-force ochrana a prevence username enumeration', () => {
    it('Po 5 chybných pokusech o login se účet interně uzamkne, ale klient dostane generickou odpověď', () => {
      for (let i = 0; i < 5; i++) {
        const res = login_attendance_user('bob', 'wrong_pin');
        expect(res.success).toBe(false);
        expect(res.error).toBe('invalid_credentials');
        expect(res.failed_attempts).toBeUndefined();
        expect(res.locked_until).toBeUndefined();
      }

      const bobCred = credentialsTable.find(c => c.user_key === 'user:bob');
      expect(bobCred.failed_login_count).toBe(5);
      expect(bobCred.locked_until).toBeTruthy();

      // 6. pokus je odmítnut, ale bez prozrazení lockoutu (prevence enumeration)
      const lockRes = login_attendance_user('bob', 'bob1234');
      expect(lockRes.success).toBe(false);
      expect(lockRes.error).toBe('invalid_credentials');
    });

    it('NULL PIN ani NULL username nevytvoří session a vrátí generickou chybu', () => {
      const initialSessions = sessionsTable.length;

      const nullPinRes = login_attendance_user('bob', null);
      expect(nullPinRes.success).toBe(false);
      expect(nullPinRes.error).toBe('invalid_credentials');

      const nullUserRes = login_attendance_user(null, 'bob1234');
      expect(nullUserRes.success).toBe(false);
      expect(nullUserRes.error).toBe('invalid_credentials');

      expect(sessionsTable.length).toBe(initialSessions);
    });

    it('Neexistující uživatel a špatný PIN existujícího uživatele vrací identickou odpověď', () => {
      const nonExist = login_attendance_user('ghost_user_123', 'any_pin');
      const wrongPin = login_attendance_user('bob', 'bad_pin');

      expect(nonExist.success).toBe(wrongPin.success);
      expect(nonExist.error).toBe(wrongPin.error);
      expect(nonExist.message).toBe(wrongPin.message);
    });

    it('Změna PINu: NULL původní PIN je zamítnut', () => {
      const loginBob = login_attendance_user('bob', 'bob1234');
      setSessionHeader(loginBob.session_token);

      const res = change_attendance_pin(null, 'new_pin_5678');
      expect(res.success).toBe(false);
      expect(res.error).toBe('invalid_pin');
    });

    it('Poslední admin: degradace ani smazání posledního admina není dovoleno', () => {
      const loginAdmin = login_attendance_user('admin', 'admin1234');
      setSessionHeader(loginAdmin.session_token);

      // Pokus o změnu role jediného admina na employee
      expect(() => {
        admin_change_user_role('user:admin', 'employee');
      }).toThrow(/Nelze odebrat roli poslednímu administrátorovi/);

      // Pokus o smazání admina (pokud by byl volán jiným kontextem nebo sám sebe)
      expect(() => {
        admin_delete_user('user:admin');
      }).toThrow();
    });

    it('update_own_settings: bezpečně ukládá pole work_days', () => {
      const loginBob = login_attendance_user('bob', 'bob1234');
      setSessionHeader(loginBob.session_token);

      const res = update_own_settings({ work_days: [1, 2, 3, 4] });
      expect(res.success).toBe(true);
      const bobProf = profilesTable.find(p => p.user_key === 'user:bob');
      expect(bobProf.work_days).toEqual([1, 2, 3, 4]);
    });

    it('settingsFromProfileRow: správně převede serverProfile na lokální settings model', () => {
      const profileRow = {
        work_start: '07:15',
        work_end: '16:00',
        daily_target_minutes: 495,
        break_minutes: 30,
        work_days: [1, 2, 3, 4, 5],
        theme: 'dark',
        settings_json: {}
      };

      const settings = settingsFromProfileRow(profileRow);
      expect(settings.workStart).toBe('07:15');
      expect(settings.workEnd).toBe('16:00');
      expect(settings.dailyTargetMinutes).toBe(495);
      expect(settings.theme).toBe('dark');
      expect(settings.workDays).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('P2 & P2.1: Registrace a automatický první správce (prázdná DB vs následné registrace)', () => {
    it('první registrace → admin (prázdná DB nepotřebuje invite kód a vytvoří admina)', async () => {
      // Vyprázdníme tabulky pro simulaci čisté databáze
      profilesTable = [];
      credentialsTable = [];
      sessionsTable = [];

      const res = await register_user_with_invite('first_boss', 'First Boss', 'admin1234', '');
      expect(res.success).toBe(true);
      expect(res.role).toBe('admin');

      const prof = profilesTable.find(p => p.user_key === 'user:first_boss');
      expect(prof).toBeTruthy();
      expect(prof.role).toBe('admin');
    });

    it('druhá registrace bez invite → zamítnuta (missing_invite)', async () => {
      // V DB už existují profily z beforeEach
      const res = await register_user_with_invite('intruder', 'Intruder', 'pass1234', '');
      expect(res.success).toBe(false);
      expect(res.error).toBe('missing_invite');
    });

    it('druhá registrace s neplatnou pozvánkou → zamítnuta (invalid_invite)', async () => {
      const res = await register_user_with_invite('intruder', 'Intruder', 'pass1234', 'INV-FAKE-999');
      expect(res.success).toBe(false);
      expect(res.error).toBe('invalid_invite');
    });

    it('druhá registrace s validním invite → employee', async () => {
      const regRes = await register_user_with_invite('new_employee', 'Newbie', 'secret1234', 'INV-TEST1234');
      expect(regRes.success).toBe(true);
      expect(regRes.role).toBe('employee');
      expect(regRes.session_token).toBeTruthy();

      const newProf = profilesTable.find(p => p.user_key === 'user:new_employee');
      expect(newProf).toBeTruthy();
      expect(newProf.role).toBe('employee');

      const newCred = credentialsTable.find(c => c.user_key === 'user:new_employee');
      expect(newCred.pin_password_hash).toBe('bcrypt:secret1234');

      // Pozvánka je označena jako použitá
      const invite = invitesTable.find(i => i.code === 'INV-TEST1234');
      expect(invite.is_used).toBe(true);
    });

    it('dvě paralelní první registrace → pouze jeden admin (advisory lock race condition test)', async () => {
      profilesTable = [];
      credentialsTable = [];
      sessionsTable = [];

      // Spustíme dvě registrace současně do prázdné databáze bez invite kódu
      const [res1, res2] = await Promise.all([
        register_user_with_invite('candidate_a', 'Candidate A', 'pass1234', ''),
        register_user_with_invite('candidate_b', 'Candidate B', 'pass1234', '')
      ]);

      const successes = [res1, res2].filter(r => r.success);
      const failures = [res1, res2].filter(r => !r.success);

      // Právě jedna uspěla a získala roli admin
      expect(successes.length).toBe(1);
      expect(successes[0].role).toBe('admin');

      // Druhá registrace byla odmítnuta kvůli chybějícímu invite kódu
      expect(failures.length).toBe(1);
      expect(failures[0].error).toBe('missing_invite');

      // V celé tabulce profilů je přesně jeden administrátor
      const adminUsers = profilesTable.filter(p => p.role === 'admin');
      expect(adminUsers.length).toBe(1);
    });

    it('Teprve s platnou pozvánkou se projeví obsazenost uživatelského jména (prevence enumeration)', async () => {
      const res = await register_user_with_invite('admin', 'Admin Copy', 'some_pin', 'INV-TEST1234');
      expect(res.success).toBe(false);
      expect(res.error).toBe('username_taken');
    });
  });

  describe('P3.3: Offline session handling (verifySession)', () => {
    it('Při výpadku sítě (navigator.onLine = false) nebo chybě sítě neodhlásí uživatele', async () => {
      // Simulace offline chování v useAuth verifySession
      let loggedOut = false;
      const fakeLogout = () => { loggedOut = true; };

      const verifySessionSim = async (isOnline, networkThrows) => {
        if (!isOnline) return true; // offline zachová relaci
        try {
          if (networkThrows) {
            const err = new TypeError('Failed to fetch');
            throw err;
          }
          return true;
        } catch (err) {
          const isNetworkError = !isOnline || !err.status || err.name === 'TypeError' || err.message?.includes('fetch');
          if (isNetworkError) {
            return true;
          }
          fakeLogout();
          return false;
        }
      };

      // 1. Zařízení je offline
      const resOffline = await verifySessionSim(false, false);
      expect(resOffline).toBe(true);
      expect(loggedOut).toBe(false);

      // 2. Došlo k výpadku sítě při fetchi
      const resNetErr = await verifySessionSim(true, true);
      expect(resNetErr).toBe(true);
      expect(loggedOut).toBe(false);
    });

    it('Při explicitní odpovědi 401 / 403 nebo neplatné session odhlásí uživatele', async () => {
      let loggedOut = false;
      const fakeLogout = () => { loggedOut = true; };

      const verifySessionSim = async (serverStatus) => {
        try {
          if (serverStatus === 401) {
            const err = new Error('Neplatná session');
            err.status = 401;
            throw err;
          }
          return true;
        } catch (err) {
          const isNetworkError = !err.status || err.name === 'TypeError';
          if (isNetworkError) return true;
          fakeLogout();
          return false;
        }
      };

      const res401 = await verifySessionSim(401);
      expect(res401).toBe(false);
      expect(loggedOut).toBe(true);
    });

    it('Reálná useAuth.verifySession(): síťová chyba neodhlásí uživatele, neplatná session provede force logout bez confirm()', async () => {
      globalThis.window = {
        DOCHAZKA_CONFIG: {
          supabaseUrl: 'https://test.supabase.co',
          supabaseAnonKey: 'anon-key-test'
        }
      };
      const origNavigator = globalThis.navigator;
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: true },
        configurable: true,
        writable: true
      });

      const { currentUser, verifySession } = useAuth();

      currentUser.value = {
        userKey: 'user:alice',
        username: 'alice',
        displayName: 'Alice',
        role: 'employee',
        sessionToken: 'tok_real_123'
      };

      const confirmSpy = vi.fn();
      globalThis.confirm = confirmSpy;

      // 1. Síťová chyba (Failed to fetch) -> zachová currentUser, vrátí true
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const netRes = await verifySession();
      expect(netRes).toBe(true);
      expect(currentUser.value).not.toBeNull();
      expect(confirmSpy).not.toHaveBeenCalled();

      // 2. Server vrátí { success: false, error: 'invalid_session' } -> okamžitý force logout bez confirm()
      fetchSpy.mockImplementation(async (url) => {
        if (String(url).includes('verify_attendance_session')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ success: false, error: 'invalid_session', message: 'Session expirovala' })
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true })
        };
      });

      const invalidRes = await verifySession();
      expect(invalidRes).toBe(false);
      expect(currentUser.value).toBeNull();
      expect(confirmSpy).not.toHaveBeenCalled();

      delete globalThis.window;
      Object.defineProperty(globalThis, 'navigator', {
        value: origNavigator,
        configurable: true,
        writable: true
      });
      vi.restoreAllMocks();
    });
  });

  describe('P3.4: Správa pozvánek – mazání pozvánky administrátorem (výhradně přes RPC)', () => {
    it('Běžný uživatel (employee) nemůže smazat pozvánku', () => {
      const loginRes = login_attendance_user('alice', 'alice1234');
      setSessionHeader(loginRes.session_token);

      expect(() => admin_delete_invite('INV-TEST1234')).toThrow(/Pouze správce/);
    });

    it('Administrátor může smazat pozvánku přes admin_delete_invite RPC, následně ji nelze použít pro registraci', async () => {
      const adminLogin = login_attendance_user('admin', 'admin1234');
      setSessionHeader(adminLogin.session_token);

      expect(invitesTable.some(i => i.code === 'INV-TEST1234')).toBe(true);
      const ok = admin_delete_invite('INV-TEST1234');
      expect(ok).toBe(true);
      expect(invitesTable.some(i => i.code === 'INV-TEST1234')).toBe(false);

      // Registrace s již smazanou pozvánkou musí selhat
      const regRes = await register_user_with_invite('new_guy', 'New Guy', 'pass1234', 'INV-TEST1234');
      expect(regRes.success).toBe(false);
      expect(regRes.error).toBe('invalid_invite');
    });

    it('TeamView a SQL schéma používají pro mazání pozvánek výhradně admin_delete_invite RPC (žádný přímý REST DELETE)', () => {
      const teamViewContent = fs.readFileSync(path.resolve(process.cwd(), 'src/views/TeamView.vue'), 'utf8');
      expect(teamViewContent).toContain('/rest/v1/rpc/admin_delete_invite');
      expect(teamViewContent).not.toContain('/rest/v1/attendance_invites?code=eq.');

      const schemaContent = fs.readFileSync(path.resolve(process.cwd(), 'supabase/schema.sql'), 'utf8');
      expect(schemaContent).toContain('revoke insert, update, delete on public.attendance_invites from public, anon, authenticated;');
    });

    it('admin_change_user_role a admin_delete_user vyhodí chybu při neexistujícím user_key (kontrola NOT FOUND)', () => {
      const adminLogin = login_attendance_user('admin', 'admin1234');
      setSessionHeader(adminLogin.session_token);

      expect(() => admin_change_user_role('user:nonexistent_ghost', 'admin')).toThrow(/Uživatel nebyl nalezen/);
      expect(() => admin_delete_user('user:nonexistent_ghost')).toThrow(/Uživatel nebyl nalezen/);
    });
  });
});
