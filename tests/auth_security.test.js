import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';

describe('Security & Session-Based Auth Authorization Tests (New Architecture)', () => {
  // Databázové tabulky simulující PostgreSQL schema:
  // attendance_profiles, attendance_sessions, attendance_days, attendance_invites
  let profilesTable = [];
  let sessionsTable = [];
  let daysTable = [];
  let invitesTable = [];

  // Kontext simulovaného HTTP volání
  let currentHeaders = {};

  beforeEach(() => {
    currentHeaders = {};
    sessionsTable = [];

    // bcrypt simulace: bcrypt(pin) = 'bcrypt:' + pin
    // legacy sha256 simulace: sha256('dochazka:' + username + ':' + pin)
    profilesTable = [
      {
        user_key: 'user:admin',
        username: 'admin',
        display_name: 'Admin Boss',
        pin_password_hash: 'bcrypt:admin1234',
        auth_version: 2,
        pin_hash: null,
        failed_login_count: 0,
        locked_until: null,
        last_failed_login_at: null,
        legacy_migrated_at: null,
        role: 'admin'
      },
      {
        user_key: 'user:alice',
        username: 'alice',
        display_name: 'Alice Wonder',
        pin_password_hash: 'bcrypt:alice1234',
        auth_version: 2,
        pin_hash: null,
        failed_login_count: 0,
        locked_until: null,
        last_failed_login_at: null,
        legacy_migrated_at: null,
        role: 'employee'
      },
      {
        user_key: 'user:bob',
        username: 'bob',
        display_name: 'Bob Builder',
        pin_password_hash: 'bcrypt:bob1234',
        auth_version: 2,
        pin_hash: null,
        failed_login_count: 0,
        locked_until: null,
        last_failed_login_at: null,
        legacy_migrated_at: null,
        role: 'employee'
      },
      {
        // Existující legacy uživatel na auth_version = 1 s původním SHA-256 hashem
        user_key: 'user:legacy_user',
        username: 'legacy_user',
        display_name: 'Legacy User',
        pin_password_hash: null,
        auth_version: 1,
        pin_hash: sha256('dochazka:legacy_user:5555'),
        failed_login_count: 0,
        locked_until: null,
        last_failed_login_at: null,
        legacy_migrated_at: null,
        role: 'employee'
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
        type: 'work',
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

  // 4. PostgreSQL login_attendance_user
  function login_attendance_user(username, pin, remember = true) {
    const cleanUser = (username || '').toLowerCase().trim().replace(/[^a-zA-Z0-9._-]/g, '');
    const userKey = `user:${cleanUser}`;
    const profile = profilesTable.find(p => p.user_key === userKey);

    if (!profile) {
      throw new Error('Neplatné uživatelské jméno nebo PIN.');
    }

    if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
      throw new Error('Účet je dočasně uzamčen z bezpečnostních důvodů. Zkuste to za chvíli.');
    }

    let isValid = false;

    if (profile.auth_version === 2 && profile.pin_password_hash) {
      isValid = (profile.pin_password_hash === `bcrypt:${pin}`);
    } else if (profile.auth_version === 1 && profile.pin_hash) {
      // Seamless migrace ze SHA-256 na bcrypt
      const legacyHash = sha256(`dochazka:${cleanUser}:${pin}`);
      if (legacyHash === profile.pin_hash) {
        isValid = true;
        profile.pin_password_hash = `bcrypt:${pin}`;
        profile.auth_version = 2;
        profile.pin_hash = null;
        profile.legacy_migrated_at = new Date().toISOString();
      }
    }

    if (!isValid) {
      profile.failed_login_count = (profile.failed_login_count || 0) + 1;
      profile.last_failed_login_at = new Date().toISOString();
      if (profile.failed_login_count >= 10) {
        profile.locked_until = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      } else if (profile.failed_login_count >= 5) {
        profile.locked_until = new Date(Date.now() + 60 * 1000).toISOString();
      }
      throw new Error('Neplatné uživatelské jméno nebo PIN.');
    }

    // Úspěch -> vyresetovat lockout
    profile.failed_login_count = 0;
    profile.locked_until = null;

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

  // 7. RLS simulace pro attendance_days
  function rls_select_attendance_days(userKeyFilter) {
    const callerKey = current_session_user_key();
    const isAdmin = is_admin();

    return daysTable.filter(row => {
      if (userKeyFilter && row.user_key !== userKeyFilter) return false;
      return (callerKey !== '' && row.user_key === callerKey) || isAdmin;
    });
  }

  function rls_insert_attendance_day(dayPayload) {
    const callerKey = current_session_user_key();
    const isAdmin = is_admin();

    const allowed = (callerKey !== '' && dayPayload.user_key === callerKey) || isAdmin;
    if (!allowed) {
      throw new Error('RLS check violation: Access denied to insert attendance day.');
    }
    daysTable.push(dayPayload);
    return dayPayload;
  }

  function rls_update_profile_role(targetUserKey, newRole) {
    const callerKey = current_session_user_key();
    const isAdmin = is_admin();

    const profile = profilesTable.find(p => p.user_key === targetUserKey);
    if (!profile) return null;

    // Běžný uživatel si nesmí měnit roli
    if (!isAdmin) {
      if (callerKey !== targetUserKey || newRole !== profile.role) {
        throw new Error('RLS check violation: Regular user cannot change their own role.');
      }
    }

    profile.role = newRole;
    return profile;
  }

  function register_user_with_invite(username, displayName, pin, inviteCode = '') {
    const cleanUser = (username || '').toLowerCase().trim().replace(/[^a-zA-Z0-9._-]/g, '');
    if (cleanUser.length < 3) {
      throw new Error('Uživatelské jméno musí mít alespoň 3 znaky.');
    }
    if (!pin || pin.length < 4) {
      throw new Error('PIN/heslo musí mít alespoň 4 znaky.');
    }
    const userKey = `user:${cleanUser}`;
    const userCount = profilesTable.length;
    let assignedRole = 'employee';

    if (userCount === 0) {
      assignedRole = 'admin';
    } else {
      const trimmedInvite = (inviteCode || '').trim();
      if (!trimmedInvite) {
        throw new Error('Registrace nových uživatelů je pouze na pozvánky. Zadej platný kód pozvánky.');
      }

      const invite = invitesTable.find(i => i.code.toUpperCase() === trimmedInvite.toUpperCase());
      if (!invite) {
        throw new Error(`Kód pozvánky "${trimmedInvite}" neexistuje nebo je neplatný.`);
      }
      if (invite.is_used) {
        throw new Error('Tento kód pozvánky již byl využit.');
      }
      if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
        throw new Error('Platnost tohoto kódu pozvánky vypršela.');
      }
      assignedRole = invite.target_role || 'employee';
    }

    if (profilesTable.some(p => p.user_key === userKey)) {
      throw new Error(`Uživatelské jméno "${cleanUser}" je již obsazeno.`);
    }

    const newProfile = {
      user_key: userKey,
      username: cleanUser,
      display_name: displayName || cleanUser,
      pin_password_hash: `bcrypt:${pin}`,
      role: assignedRole,
      auth_version: 2
    };
    profilesTable.push(newProfile);

    if (userCount > 0 && inviteCode) {
      const invite = invitesTable.find(i => i.code.toUpperCase() === inviteCode.trim().toUpperCase());
      if (invite) {
        invite.is_used = true;
        invite.used_by = userKey;
        invite.used_at = new Date().toISOString();
      }
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
  }

  // ==========================================================================
  // Testy jednotlivých bezpečnostních požadavků z P0 až P10
  // ==========================================================================

  describe('P0 & P9: Platná, neplatná, expirovaná a revokovaná session', () => {
    it('Platný session token uživatele A umožní číst jeho vlastní data', () => {
      const loginRes = login_attendance_user('bob', 'bob1234');
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
      // Nastavíme expiraci v minulosti
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

      // Alice nesmí vkládat pro Boba
      expect(() => {
        rls_insert_attendance_day({
          user_key: 'user:bob',
          date: '2026-10-25',
          type: 'work'
        });
      }).toThrow(/RLS check violation/);

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

    it('Employee s rolí role=admin v payloadu si nesmí povýšit práva', () => {
      const loginBob = login_attendance_user('bob', 'bob1234');
      setSessionHeader(loginBob.session_token);

      expect(() => {
        rls_update_profile_role('user:bob', 'admin');
      }).toThrow(/Regular user cannot change their own role/);
    });
  });

  describe('P3.1 & P9: PIN Brute-force ochrana a lockout', () => {
    it('Po 5 chybných pokusech o login se účet dočasně uzamkne na 1 minutu', () => {
      for (let i = 0; i < 5; i++) {
        expect(() => {
          login_attendance_user('bob', 'wrong_pin');
        }).toThrow(/Neplatné uživatelské jméno nebo PIN/);
      }

      // 6. pokus je již odmítnut z důvodu uzamčení účtu
      expect(() => {
        login_attendance_user('bob', 'bob1234');
      }).toThrow(/Účet je dočasně uzamčen/);
    });
  });

  describe('P10: Plynulá migrace existujícího legacy uživatele bez ztráty účtu', () => {
    it('Uživatel s auth_version = 1 a SHA-256 pin_hash se při prvním přihlášení automaticky převede na bcrypt a získá session token', () => {
      const legacyProfile = profilesTable.find(p => p.user_key === 'user:legacy_user');
      expect(legacyProfile.auth_version).toBe(1);
      expect(legacyProfile.pin_hash).toBeTruthy();
      expect(legacyProfile.pin_password_hash).toBeNull();

      // První přihlášení s původním PINem '5555'
      const loginRes = login_attendance_user('legacy_user', '5555');

      expect(loginRes.session_token).toBeTruthy();
      expect(loginRes.user_key).toBe('user:legacy_user');

      // Profil je nyní povýšen na auth_version = 2
      expect(legacyProfile.auth_version).toBe(2);
      expect(legacyProfile.pin_password_hash).toBe('bcrypt:5555');
      expect(legacyProfile.pin_hash).toBeNull();
      expect(legacyProfile.legacy_migrated_at).toBeTruthy();

      // Další přihlášení již probíhá plně přes bcrypt
      const nextLogin = login_attendance_user('legacy_user', '5555');
      expect(nextLogin.session_token).toBeTruthy();
    });
  });

  describe('P2 & P2.1: Registrace s pozvánkou a prevence username enumeration', () => {
    it('Útočník s neplatnou pozvánkou dostane chybu pozvánky, nikoliv o existenci jména "admin"', () => {
      expect(() => {
        register_user_with_invite('admin', 'Admin Copy', 'some_pin', 'INVALID_INVITE');
      }).toThrow(/Kód pozvánky "INVALID_INVITE" neexistuje nebo je neplatný/);
    });

    it('Teprve s platnou pozvánkou se projeví obsazenost uživatelského jména', () => {
      expect(() => {
        register_user_with_invite('admin', 'Admin Copy', 'some_pin', 'INV-TEST1234');
      }).toThrow(/Uživatelské jméno "admin" je již obsazeno/);
    });

    it('Úspěšná registrace vytvoří účet s bcrypt hashem a ihned vrátí session token', () => {
      const regRes = register_user_with_invite('new_employee', 'Newbie', 'secret1234', 'INV-TEST1234');
      expect(regRes.success).toBe(true);
      expect(regRes.session_token).toBeTruthy();

      const newProf = profilesTable.find(p => p.user_key === 'user:new_employee');
      expect(newProf.pin_password_hash).toBe('bcrypt:secret1234');
      expect(newProf.auth_version).toBe(2);

      // Pozvánka je označena jako použitá
      const invite = invitesTable.find(i => i.code === 'INV-TEST1234');
      expect(invite.is_used).toBe(true);
    });
  });
});
