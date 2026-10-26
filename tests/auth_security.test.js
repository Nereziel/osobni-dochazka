import { describe, it, expect, beforeEach } from 'vitest';

describe('Security & Legacy Auth Authorization Tests (P0 Vulnerability Audit)', () => {
  // Databázový model simulující PostgreSQL schema a RLS tabulek:
  // attendance_profiles, attendance_days, attendance_invites
  let profilesTable = [];
  let daysTable = [];
  let invitesTable = [];

  // Kontext simulovaného volání (headers, auth.uid())
  let currentHeaders = {};
  let currentAuthUid = null;

  beforeEach(() => {
    currentHeaders = {};
    currentAuthUid = null;

    profilesTable = [
      {
        user_key: 'user:admin',
        username: 'admin',
        display_name: 'Admin Boss',
        pin_hash: 'ADMIN_HASH_999',
        role: 'admin',
        auth_id: 'auth-uuid-admin-001'
      },
      {
        user_key: 'user:alice',
        username: 'alice',
        display_name: 'Alice Wonder',
        pin_hash: 'ALICE_HASH_AAA',
        role: 'employee',
        auth_id: null
      },
      {
        user_key: 'user:bob',
        username: 'bob',
        display_name: 'Bob Builder',
        pin_hash: 'BOB_HASH_BBB',
        role: 'employee',
        auth_id: null
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

  // Helpery simulující PostgreSQL request hlavičky
  function setClientInfoHeader(userKey, pinHash) {
    if (!userKey && !pinHash) {
      delete currentHeaders['x-client-info'];
    } else {
      currentHeaders['x-client-info'] = `dochazka-pwa|${userKey || ''}|${pinHash || ''}`;
    }
  }

  function req_user_key() {
    const raw = currentHeaders['x-client-info'] || '';
    const parts = raw.split('|');
    return (parts[1] || '').trim();
  }

  function req_pin_hash() {
    const raw = currentHeaders['x-client-info'] || '';
    const parts = raw.split('|');
    return (parts[2] || '').trim();
  }

  // 1. Implementace opravy current_profile_user_key() podle 008_fix_legacy_auth_vulnerability.sql
  function current_profile_user_key() {
    // 1. Ověřený Supabase Auth uživatel
    if (currentAuthUid) {
      const matchAuth = profilesTable.find(p => p.auth_id && p.auth_id === currentAuthUid);
      if (matchAuth) return matchAuth.user_key;
    }

    // 2. Ověřený legacy uživatel (musí platit user_key A ZÁROVEŇ odpovídající pin_hash)
    const headerUserKey = req_user_key();
    const headerPinHash = req_pin_hash();

    if (headerUserKey && headerPinHash) {
      const matchProfile = profilesTable.find(
        p => p.user_key === headerUserKey && p.pin_hash === headerPinHash
      );
      if (matchProfile) return matchProfile.user_key;
    }

    // Neautorizováno -> prázdný řetězec
    return '';
  }

  // 2. Implementace zpřísněného is_admin() podle 008_fix_legacy_auth_vulnerability.sql
  function is_admin() {
    const callerKey = current_profile_user_key();
    if (!callerKey) return false;
    const profile = profilesTable.find(p => p.user_key === callerKey);
    return profile?.role === 'admin';
  }

  // 3. Simulace RLS pro attendance_days podle 008_fix_legacy_auth_vulnerability.sql
  function rls_select_attendance_days(userKeyFilter) {
    const callerKey = current_profile_user_key();
    const isAdmin = is_admin();

    return daysTable.filter(row => {
      if (userKeyFilter && row.user_key !== userKeyFilter) return false;
      // RLS Policy: ((current_profile_user_key() <> '' and user_key = current_profile_user_key()) or is_admin())
      const allowed = (callerKey !== '' && row.user_key === callerKey) || isAdmin;
      return allowed;
    });
  }

  function rls_insert_attendance_day(dayPayload) {
    const callerKey = current_profile_user_key();
    const isAdmin = is_admin();

    // RLS Policy WITH CHECK: ((current_profile_user_key() <> '' and user_key = current_profile_user_key()) or is_admin())
    const allowed = (callerKey !== '' && dayPayload.user_key === callerKey) || isAdmin;
    if (!allowed) {
      throw new Error('RLS check violation: New row violates row-level security policy for table attendance_days.');
    }
    daysTable.push(dayPayload);
    return dayPayload;
  }

  function rls_update_attendance_day(userKey, date, updates) {
    const callerKey = current_profile_user_key();
    const isAdmin = is_admin();

    const row = daysTable.find(r => r.user_key === userKey && r.date === date);
    if (!row) return null;

    const allowedUsing = (callerKey !== '' && row.user_key === callerKey) || isAdmin;
    if (!allowedUsing) {
      throw new Error('RLS using violation: Access denied to update attendance day.');
    }

    Object.assign(row, updates);
    return row;
  }

  function rls_delete_attendance_day(userKey, date) {
    const callerKey = current_profile_user_key();
    const isAdmin = is_admin();

    const idx = daysTable.findIndex(r => r.user_key === userKey && r.date === date);
    if (idx === -1) return false;

    const row = daysTable[idx];
    const allowed = (callerKey !== '' && row.user_key === callerKey) || isAdmin;
    if (!allowed) {
      throw new Error('RLS using violation: Access denied to delete attendance day.');
    }
    daysTable.splice(idx, 1);
    return true;
  }

  // 4. Simulace RPC upsert_attendance_day_lww podle 008_fix_legacy_auth_vulnerability.sql
  function upsert_attendance_day_lww(p_day) {
    const callerKey = current_profile_user_key();
    if (!callerKey) {
      throw new Error('Neautorizovaný přístup: Uživatel není přihlášen nebo zadal neplatný PIN.');
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

  // 5. Simulace RPC register_user_with_invite podle 008_fix_legacy_auth_vulnerability.sql
  function register_user_with_invite(username, displayName, pinHash, inviteCode = '') {
    const cleanUser = (username || '').toLowerCase().trim().replace(/[^a-zA-Z0-9._-]/g, '');
    if (cleanUser.length < 3) {
      throw new Error('Uživatelské jméno musí mít alespoň 3 znaky.');
    }
    const userKey = `user:${cleanUser}`;
    const userCount = profilesTable.length;
    let assignedRole = 'employee';

    if (userCount === 0) {
      assignedRole = 'admin';
    } else {
      // Prevence username enumeration: nejdříve validujeme invite!
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

    // Teprve po validaci invite (nebo bootstrapu) ověřit unikátnost uživatelského jména
    if (profilesTable.some(p => p.user_key === userKey)) {
      throw new Error(`Uživatelské jméno "${cleanUser}" je již obsazeno.`);
    }

    const newProfile = {
      user_key: userKey,
      username: cleanUser,
      display_name: displayName || cleanUser,
      pin_hash: pinHash,
      role: assignedRole,
      auth_id: null
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

    return { success: true, user_key: userKey, username: cleanUser, role: assignedRole };
  }

  // ==========================================================================
  // Testy jednotlivých bezpečnostních požadavků z promptu
  // ==========================================================================

  describe('Požadavek 1: current_profile_user_key()', () => {
    it('vrátí prázdný řetězec, pokud chybí hlavička X-Client-Info', () => {
      setClientInfoHeader('', '');
      expect(current_profile_user_key()).toBe('');
    });

    it('vrátí prázdný řetězec, pokud útočník pošle user_key, ale neplatný pin_hash (forged auth)', () => {
      setClientInfoHeader('user:bob', 'INVALID_HASH_123');
      expect(current_profile_user_key()).toBe('');
    });

    it('vrátí prázdný řetězec, pokud user_key v databázi vůbec neexistuje', () => {
      setClientInfoHeader('user:nonexistent', 'ANY_HASH');
      expect(current_profile_user_key()).toBe('');
    });

    it('vrátí platný user_key, pokud user_key a pin_hash odpovídají záznamu v attendance_profiles', () => {
      setClientInfoHeader('user:bob', 'BOB_HASH_BBB');
      expect(current_profile_user_key()).toBe('user:bob');
    });

    it('upřednostní ověřeného uživatele Supabase Auth (auth.uid()) před hlavičkou', () => {
      currentAuthUid = 'auth-uuid-admin-001';
      setClientInfoHeader('user:bob', 'BOB_HASH_BBB');
      // auth.uid() patří adminovi, musí vrátit user:admin
      expect(current_profile_user_key()).toBe('user:admin');
    });
  });

  describe('Požadavek 4 & 8: is_admin() autorizace', () => {
    it('udělí admin práva administrátorovi se správným PIN hashem', () => {
      setClientInfoHeader('user:admin', 'ADMIN_HASH_999');
      expect(is_admin()).toBe(true);
    });

    it('NEUDĚLÍ admin práva při zaslání admin user_key s neplatným PIN hashem', () => {
      setClientInfoHeader('user:admin', 'WRONG_HASH');
      expect(is_admin()).toBe(false);
    });

    it('NEUDĚLÍ admin práva běžnému zaměstnanci ani se správným PINem', () => {
      setClientInfoHeader('user:bob', 'BOB_HASH_BBB');
      expect(is_admin()).toBe(false);
    });

    it('neudělí admin práva anonymnímu požadavku', () => {
      setClientInfoHeader('', '');
      expect(is_admin()).toBe(false);
    });
  });

  describe('Požadavek 5: Ochrana před čtením a manipulací cizích dat (Alice vs Bob)', () => {
    it('Alice s vlastním hashem AAA nesmí přes SELECT číst data Boba', () => {
      setClientInfoHeader('user:alice', 'ALICE_HASH_AAA');
      const bobsDays = rls_select_attendance_days('user:bob');
      expect(bobsDays).toHaveLength(0);
    });

    it('Útočník s hlavičkou user_key = user:bob, ale pin_hash = AAA (Alicin hash) získá 0 řádků', () => {
      // Útočník se pokouší vydávat za Boba pomocí cizího hashe
      setClientInfoHeader('user:bob', 'ALICE_HASH_AAA');
      expect(current_profile_user_key()).toBe('');
      const rows = rls_select_attendance_days('user:bob');
      expect(rows).toHaveLength(0);
    });

    it('Útočník se špatným hashem nesmí vložit (INSERT) docházku pro Boba', () => {
      setClientInfoHeader('user:bob', 'WRONG_HASH');
      expect(() => {
        rls_insert_attendance_day({
          user_key: 'user:bob',
          date: '2026-10-25',
          type: 'work',
          start_time: '08:00',
          end_time: '16:00'
        });
      }).toThrow(/RLS check violation/);
    });

    it('Alice s platným hashem nesmí upravit (UPDATE) docházku Boba', () => {
      setClientInfoHeader('user:alice', 'ALICE_HASH_AAA');
      expect(() => {
        rls_update_attendance_day('user:bob', '2026-10-24', { note: 'Hacked by Alice' });
      }).toThrow(/Access denied to update attendance day/);
    });

    it('Alice s platným hashem nesmí smazat (DELETE) docházku Boba', () => {
      setClientInfoHeader('user:alice', 'ALICE_HASH_AAA');
      expect(() => {
        rls_delete_attendance_day('user:bob', '2026-10-24');
      }).toThrow(/Access denied to delete attendance day/);
    });
  });

  describe('Požadavek 6: Forged user_key v X-Client-Info', () => {
    it('X-Client-Info: dochazka-pwa|user:bob|INVALID_HASH vede k prázdné identitě a odmítnutí všech akcí', () => {
      setClientInfoHeader('user:bob', 'INVALID_HASH');

      expect(current_profile_user_key()).toBe('');
      expect(is_admin()).toBe(false);

      // SELECT
      expect(rls_select_attendance_days('user:bob')).toHaveLength(0);

      // INSERT
      expect(() => {
        rls_insert_attendance_day({
          user_key: 'user:bob',
          date: '2026-10-26',
          type: 'work'
        });
      }).toThrow();

      // LWW RPC
      expect(() => {
        upsert_attendance_day_lww({
          user_key: 'user:bob',
          date: '2026-10-24',
          type: 'work',
          updated_at: '2026-10-24T12:00:00.000Z'
        });
      }).toThrow(/Neautorizovaný přístup/);
    });
  });

  describe('Požadavek 7: Běžný legitimní uživatel funguje bez omezení', () => {
    beforeEach(() => {
      setClientInfoHeader('user:bob', 'BOB_HASH_BBB');
    });

    it('Bob může číst svou vlastní docházku', () => {
      const rows = rls_select_attendance_days('user:bob');
      expect(rows).toHaveLength(1);
      expect(rows[0].date).toBe('2026-10-24');
    });

    it('Bob může vložit nový den docházky', () => {
      const newDay = rls_insert_attendance_day({
        user_key: 'user:bob',
        date: '2026-10-25',
        type: 'work',
        start_time: '08:00',
        end_time: '16:00'
      });
      expect(newDay.date).toBe('2026-10-25');
      expect(daysTable.find(d => d.user_key === 'user:bob' && d.date === '2026-10-25')).toBeTruthy();
    });

    it('Bob může upravit svůj stávající den', () => {
      const updated = rls_update_attendance_day('user:bob', '2026-10-24', { note: 'Doplněna poznámka' });
      expect(updated.note).toBe('Doplněna poznámka');
    });

    it('Bob může smazat svůj den', () => {
      const deleted = rls_delete_attendance_day('user:bob', '2026-10-24');
      expect(deleted).toBe(true);
      expect(daysTable.find(d => d.user_key === 'user:bob' && d.date === '2026-10-24')).toBeUndefined();
    });

    it('Bob může úspěšně volat LWW RPC upsert_attendance_day_lww pro své záznamy', () => {
      const res = upsert_attendance_day_lww({
        user_key: 'user:bob',
        date: '2026-10-24',
        type: 'homeoffice',
        updated_at: '2026-10-24T12:00:00.000Z'
      });
      expect(res.applied).toBe(true);
      expect(daysTable.find(d => d.user_key === 'user:bob' && d.date === '2026-10-24').type).toBe('homeoffice');
    });
  });

  describe('Požadavek 3: LWW RPC upsert_attendance_day_lww kontrola oprávnění', () => {
    it('Běžný uživatel Bob nemůže přes LWW RPC zapsat záznam pro Alici', () => {
      setClientInfoHeader('user:bob', 'BOB_HASH_BBB');
      expect(() => {
        upsert_attendance_day_lww({
          user_key: 'user:alice',
          date: '2026-10-24',
          type: 'work',
          updated_at: '2026-10-24T12:00:00.000Z'
        });
      }).toThrow(/Přístup odepřen: Nelze upravovat data jiného uživatele/);
    });

    it('Ověřený správce má výjimku a může zapisovat dny zaměstnance', () => {
      setClientInfoHeader('user:admin', 'ADMIN_HASH_999');
      const res = upsert_attendance_day_lww({
        user_key: 'user:alice',
        date: '2026-10-24',
        type: 'vacation',
        updated_at: '2026-10-24T15:00:00.000Z'
      });
      expect(res.applied).toBe(true);
      expect(daysTable.find(d => d.user_key === 'user:alice' && d.date === '2026-10-24').type).toBe('vacation');
    });
  });

  describe('Požadavek 9: Prevence Username Enumeration v registraci', () => {
    it('Anonymní útočník s neplatným invite kódem dostane chybu pozvánky, nikoliv o existenci jména "bob"', () => {
      expect(() => {
        register_user_with_invite('bob', 'Bobby', 'NEW_HASH_123', 'INVALID_CODE');
      }).toThrow(/Kód pozvánky "INVALID_CODE" neexistuje nebo je neplatný/);
    });

    it('Anonymní útočník bez invite kódu dostane chybu o nutnosti pozvánky i pro existujícího "admin"', () => {
      expect(() => {
        register_user_with_invite('admin', 'Fake Admin', 'NEW_HASH_123', '');
      }).toThrow(/Registrace nových uživatelů je pouze na pozvánky/);
    });

    it('Uživatel s prošlým invite kódem dostane chybu o expiraci pozvánky, nikoliv o existenci jména', () => {
      expect(() => {
        register_user_with_invite('bob', 'Bobby', 'NEW_HASH_123', 'INV-EXPIRED');
      }).toThrow(/Platnost tohoto kódu pozvánky vypršela/);
    });

    it('Uživatel s již využitým invite kódem dostane chybu o využití pozvánky', () => {
      expect(() => {
        register_user_with_invite('bob', 'Bobby', 'NEW_HASH_123', 'INV-USED');
      }).toThrow(/Tento kód pozvánky již byl využit/);
    });

    it('Teprve s platnou pozvánkou se projeví chyba obsazenosti uživatelského jména', () => {
      expect(() => {
        register_user_with_invite('bob', 'Bobby', 'NEW_HASH_123', 'INV-TEST1234');
      }).toThrow(/Uživatelské jméno "bob" je již obsazeno/);
    });

    it('S platnou pozvánkou a volným uživatelským jménem registrace projde a pozvánka se označí jako použitá', () => {
      const res = register_user_with_invite('david', 'David New', 'DAVID_HASH_777', 'INV-TEST1234');
      expect(res.success).toBe(true);
      expect(res.user_key).toBe('user:david');

      const invite = invitesTable.find(i => i.code === 'INV-TEST1234');
      expect(invite.is_used).toBe(true);
      expect(invite.used_by).toBe('user:david');
    });

    it('Bootstrap prvního uživatele v prázdné databázi nevyžaduje pozvánku a přiřadí roli admin', () => {
      profilesTable = []; // simulace prázdné DB
      const res = register_user_with_invite('superadmin', 'First Superadmin', 'SUPER_HASH_000', '');
      expect(res.success).toBe(true);
      expect(res.role).toBe('admin');
      expect(profilesTable).toHaveLength(1);
    });
  });
});

