import { ref, computed } from 'vue';
import { supabaseRequest } from '../services/supabase.js';
import { clearUserLocalData } from '../services/indexedDb.js';

const LS_USER_KEY = 'dochazka_active_user_v2';
const LS_REMEMBER_KEY = 'dochazka_remember_login_v1';
const MIN_PIN_LENGTH = 6;

function sanitizeStoredUser(user) {
  if (!user || typeof user !== 'object' || !user.userKey) return null;
  return {
    userKey: user.userKey,
    username: user.username || '',
    displayName: user.displayName || user.username || '',
    role: user.role || 'employee',
    expiresAt: user.expiresAt || null
  };
}

function loadInitialUser() {
  try {
    const remember = localStorage.getItem(LS_REMEMBER_KEY);
    const storage = remember === 'false' ? sessionStorage : localStorage;
    const fallbackStorage = remember === 'false' ? null : sessionStorage;
    const parsed = JSON.parse(
      storage.getItem(LS_USER_KEY) || fallbackStorage?.getItem(LS_USER_KEY) || 'null'
    );
    const cleanUser = sanitizeStoredUser(parsed);

    // Rewrite legacy persisted profile data through the allowlist above. This removes
    // any fields from older application versions without ever reading them explicitly.
    if (cleanUser) {
      storage.setItem(LS_USER_KEY, JSON.stringify(cleanUser));
      fallbackStorage?.removeItem(LS_USER_KEY);
    }
    return cleanUser;
  } catch {
    return null;
  }
}

const currentUser = ref(loadInitialUser());
let logoutTask = null;

export function useAuth() {
  const isAuthenticated = computed(() => Boolean(currentUser.value?.userKey));
  const isAdmin = computed(() => currentUser.value?.role === 'admin');

  function isRememberedSession() {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(LS_REMEMBER_KEY) === 'true';
    } catch {
      return false;
    }
  }

  function saveUserSession(user, remember = false) {
    const cleanUser = sanitizeStoredUser(user);
    currentUser.value = cleanUser;
    try {
      if (cleanUser) {
        if (remember) {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(LS_REMEMBER_KEY, 'true');
            localStorage.setItem(LS_USER_KEY, JSON.stringify(cleanUser));
          }
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem(LS_USER_KEY);
          }
        } else {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(LS_REMEMBER_KEY, 'false');
            localStorage.removeItem(LS_USER_KEY);
          }
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(LS_USER_KEY, JSON.stringify(cleanUser));
          }
        }
      } else {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(LS_USER_KEY);
          localStorage.removeItem(LS_REMEMBER_KEY);
        }
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem(LS_USER_KEY);
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  async function login(usernameInput, pinInput, rememberMe = false) {
    if (logoutTask) await logoutTask;
    const cleanUser = usernameInput.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!cleanUser) throw new Error('Zadej platné uživatelské jméno.');
    if (!pinInput) throw new Error('Zadej svůj PIN nebo heslo.');

    const res = await supabaseRequest('/rest/v1/rpc/login_attendance_user', {
      method: 'POST',
      body: JSON.stringify({
        p_username: cleanUser,
        p_pin: pinInput,
        p_remember: Boolean(rememberMe)
      })
    });

    if (res?.success === false) {
      throw new Error(res.message || res.error || 'Přihlášení se nezdařilo.');
    }

    const userObj = {
      userKey: res?.user_key || `user:${cleanUser}`,
      username: res?.username || cleanUser,
      displayName: res?.display_name || cleanUser,
      role: res?.role || 'employee',
      expiresAt: res?.expires_at || null
    };

    saveUserSession(userObj, rememberMe);
    return { message: `Vítej zpět, ${userObj.displayName}!`, profile: userObj };
  }

  async function register(usernameInput, displayNameInput, pinInput, pinConfirmInput, inviteCodeInput) {
    if (logoutTask) await logoutTask;
    const cleanUser = usernameInput.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!cleanUser) throw new Error('Zadej platné uživatelské jméno.');
    if (!displayNameInput.trim()) throw new Error('Zadej celé jméno na výkaz.');
    if (!pinInput || pinInput.length < MIN_PIN_LENGTH) throw new Error(`PIN/heslo musí mít alespoň ${MIN_PIN_LENGTH} znaků.`);
    if (pinInput !== pinConfirmInput) throw new Error('Zadaná hesla/PINy se neshodují.');

    const cleanInvite = (inviteCodeInput || '').trim().toUpperCase();
    if (!cleanInvite) throw new Error('Registrace vyžaduje platný kód pozvánky.');

    const rpcRes = await supabaseRequest('/rest/v1/rpc/register_user_with_invite', {
      method: 'POST',
      body: JSON.stringify({
        p_username: cleanUser,
        p_display_name: displayNameInput.trim(),
        p_pin: pinInput,
        p_invite_code: cleanInvite
      })
    });

    if (rpcRes?.success === false) {
      throw new Error(rpcRes.message || rpcRes.error || 'Registrace se nezdařila.');
    }

    const userObj = {
      userKey: rpcRes?.user_key || `user:${cleanUser}`,
      username: rpcRes?.username || cleanUser,
      displayName: rpcRes?.display_name || displayNameInput.trim(),
      role: rpcRes?.role || 'employee',
      expiresAt: rpcRes?.expires_at || null
    };

    saveUserSession(userObj, false);
    return {
      message: `Účet "${cleanUser}" byl úspěšně vytvořen!`,
      user: userObj
    };
  }

  async function changePin(oldPin, newPin, newPinConfirm) {
    if (!currentUser.value?.userKey) throw new Error('Pro změnu PINu musíš být přihlášen.');
    if (!oldPin) throw new Error('Zadej svůj současný PIN / heslo.');
    if (!newPin || newPin.length < MIN_PIN_LENGTH) throw new Error(`Nový PIN musí mít alespoň ${MIN_PIN_LENGTH} znaků.`);
    if (newPin !== newPinConfirm) throw new Error('Nový PIN a jeho potvrzení se neshodují.');
    if (oldPin === newPin) throw new Error('Nový PIN musí být jiný než současný.');

    const remember = isRememberedSession();
    const res = await supabaseRequest('/rest/v1/rpc/change_attendance_pin', {
      method: 'POST',
      body: JSON.stringify({
        p_old_pin: oldPin,
        p_new_pin: newPin,
        p_revoke_others: true
      })
    });

    if (res?.success === false) {
      throw new Error(res.message || res.error || 'Změna PINu selhala.');
    }

    currentUser.value = {
      ...currentUser.value,
      expiresAt: res?.expires_at || currentUser.value.expiresAt
    };
    saveUserSession(currentUser.value, remember);

    return res?.message || 'PIN byl úspěšně změněn.';
  }

  async function updateDisplayName(newDisplayName) {
    if (!currentUser.value) throw new Error('Pro úpravu profilu musíš být přihlášen.');
    const cleanName = (newDisplayName || '').trim();
    if (!cleanName) throw new Error('Celé jméno nesmí být prázdné.');

    if (currentUser.value?.userKey) {
      await supabaseRequest('/rest/v1/rpc/update_own_settings', {
        method: 'POST',
        body: JSON.stringify({
          p_settings: { display_name: cleanName }
        })
      });
    }

    currentUser.value = {
      ...currentUser.value,
      displayName: cleanName
    };
    saveUserSession(currentUser.value, isRememberedSession());
    return cleanName;
  }

  async function logout({ preservePending = false, revoke = true } = {}) {
    if (logoutTask) return logoutTask;
    const priorUser = currentUser.value;
    saveUserSession(null);

    if (!priorUser?.userKey) return;
    logoutTask = (async () => {
      // Finish revocation before allowing a new login to replace the browser cookie.
      if (revoke) {
        try {
          await supabaseRequest('/rest/v1/rpc/logout_attendance_session', {
            method: 'POST',
            body: JSON.stringify({ p_all_devices: false })
          });
        } catch {
          console.warn('Odvolání serverové relace se nepodařilo.');
        }
      }
      if (preservePending) {
        await clearUserLocalData(priorUser.userKey, { preservePending: true });
      } else {
        await clearUserLocalData(priorUser.userKey);
      }
    })();
    try {
      await logoutTask;
    } finally {
      logoutTask = null;
    }
  }

  async function verifySession() {
    const verifiedUser = currentUser.value;
    if (!verifiedUser?.userKey) return true;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;

    try {
      const res = await supabaseRequest('/rest/v1/rpc/verify_attendance_session', {
        method: 'POST'
      });

      // A delayed verification must not update or invalidate another session.
      if (currentUser.value !== verifiedUser) return true;
      if (res?.success === false && ['missing_session', 'invalid_session'].includes(res.error)) return false;
      if (res?.success === true && res.user_key !== verifiedUser.userKey) return false;

      if (res?.success === true && res.role) {
        saveUserSession({
          ...verifiedUser,
          role: res.role,
          displayName: res.display_name || verifiedUser.displayName
        }, isRememberedSession());
      }
      return true;
    } catch (err) {
      if (currentUser.value !== verifiedUser) return true;
      // 401 is the explicit missing-session response from our API boundary.
      // Transport errors, 429, 403 origin errors and 5xx are not revocation.
      if (err?.status === 401) return false;
      console.info('Ověření relace odloženo (služba není dostupná).');
      return true;
    }
  }

  return {
    currentUser,
    isAuthenticated,
    isAdmin,
    login,
    register,
    changePin,
    updateDisplayName,
    logout,
    verifySession
  };
}
