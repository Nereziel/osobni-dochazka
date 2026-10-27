import { ref, computed } from 'vue';
import { supabaseRequest, isSupabaseConfigured } from '../services/supabase.js';

const LS_USER_KEY = 'dochazka_active_user_v2';
const LS_REMEMBER_KEY = 'dochazka_remember_login_v1';

function loadInitialUser() {
  try {
    const remember = localStorage.getItem(LS_REMEMBER_KEY);
    if (remember === 'false') {
      return JSON.parse(sessionStorage.getItem(LS_USER_KEY) || 'null');
    }
    return JSON.parse(localStorage.getItem(LS_USER_KEY) || sessionStorage.getItem(LS_USER_KEY) || 'null');
  } catch {
    return null;
  }
}

const currentUser = ref(loadInitialUser());

export function useAuth() {
  const isAuthenticated = computed(() => Boolean(currentUser.value?.userKey && currentUser.value?.sessionToken));
  const isAdmin = computed(() => currentUser.value?.role === 'admin');

  function saveUserSession(user, remember = true) {
    currentUser.value = user;
    if (user) {
      if (remember) {
        localStorage.setItem(LS_REMEMBER_KEY, 'true');
        localStorage.setItem(LS_USER_KEY, JSON.stringify(user));
        sessionStorage.removeItem(LS_USER_KEY);
      } else {
        localStorage.setItem(LS_REMEMBER_KEY, 'false');
        localStorage.removeItem(LS_USER_KEY);
        sessionStorage.setItem(LS_USER_KEY, JSON.stringify(user));
      }
    } else {
      localStorage.removeItem(LS_USER_KEY);
      sessionStorage.removeItem(LS_USER_KEY);
    }
  }

  async function login(usernameInput, pinInput, rememberMe = true) {
    const cleanUser = usernameInput.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!cleanUser) throw new Error('Zadej platné uživatelské jméno.');
    if (!pinInput) throw new Error('Zadej svůj PIN nebo heslo.');

    if (!isSupabaseConfigured()) {
      throw new Error('Supabase databáze není nakonfigurována. Pro přihlášení je nutné nastavit spojení s databází.');
    }

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

    if (!res?.session_token) {
      throw new Error('Přihlášení se nezdařilo: server nevydal session token.');
    }

    const userObj = {
      sessionToken: res.session_token,
      userKey: res.user_key || `user:${cleanUser}`,
      username: res.username || cleanUser,
      displayName: res.display_name || cleanUser,
      role: res.role || 'employee',
      expiresAt: res.expires_at
    };

    saveUserSession(userObj, rememberMe);
    return { message: `Vítej zpět, ${userObj.displayName}!`, profile: userObj };
  }

  async function register(usernameInput, displayNameInput, pinInput, pinConfirmInput, inviteCodeInput) {
    const cleanUser = usernameInput.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!cleanUser) throw new Error('Zadej platné uživatelské jméno.');
    if (!displayNameInput.trim()) throw new Error('Zadej celé jméno na výkaz.');
    if (!pinInput || pinInput.length < 4) throw new Error('PIN/heslo musí mít alespoň 4 znaky.');
    if (pinInput !== pinConfirmInput) throw new Error('Zadaná hesla/PINy se neshodují.');

    const cleanInvite = (inviteCodeInput || '').trim().toUpperCase();

    if (!isSupabaseConfigured()) {
      throw new Error('Supabase databáze není nakonfigurována. Pro registraci je nutné nastavit spojení s databází.');
    }

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

    if (!rpcRes?.session_token) {
      throw new Error('Registrace proběhla, ale server nevydal session token.');
    }

    const userObj = {
      sessionToken: rpcRes.session_token,
      userKey: rpcRes.user_key || `user:${cleanUser}`,
      username: rpcRes.username || cleanUser,
      displayName: rpcRes.display_name || displayNameInput.trim(),
      role: rpcRes.role || 'employee',
      expiresAt: rpcRes.expires_at
    };

    saveUserSession(userObj, true);
    return {
      message: `Účet "${cleanUser}" byl úspěšně vytvořen!`,
      user: userObj
    };
  }

  async function changePin(oldPin, newPin, newPinConfirm) {
    if (!currentUser.value?.sessionToken) throw new Error('Pro změnu PINu musíš být přihlášen.');
    if (!oldPin) throw new Error('Zadej svůj současný PIN / heslo.');
    if (!newPin || newPin.length < 4) throw new Error('Nový PIN musí mít alespoň 4 znaky.');
    if (newPin !== newPinConfirm) throw new Error('Nový PIN a jeho potvrzení se neshodují.');
    if (oldPin === newPin) throw new Error('Nový PIN musí být jiný než současný.');

    if (!isSupabaseConfigured()) {
      throw new Error('Supabase databáze není nakonfigurována.');
    }

    const res = await supabaseRequest('/rest/v1/rpc/change_attendance_pin', {
      method: 'POST',
      body: JSON.stringify({
        p_old_pin: oldPin,
        p_new_pin: newPin,
        p_revoke_others: true
      })
    }, currentUser.value);

    if (res?.success === false) {
      throw new Error(res.message || res.error || 'Změna PINu selhala.');
    }

    return res?.message || 'PIN byl úspěšně změněn.';
  }

  function logout() {
    const priorUser = currentUser.value;
    saveUserSession(null);
    try {
      localStorage.removeItem('dochazka_biometrics_cred_v1');
    } catch {
      // Ignorovat případnou chybu přístupu k storage
    }

    if (isSupabaseConfigured() && priorUser?.sessionToken) {
      supabaseRequest('/rest/v1/rpc/logout_attendance_session', {
        method: 'POST',
        body: JSON.stringify({ p_all_devices: false })
      }, priorUser).catch((err) => {
        console.warn('Odvolání serverové session na pozadí selhalo (best-effort):', err?.message || err);
      });
    }
  }

  async function verifySession() {
    if (!isSupabaseConfigured() || !currentUser.value?.sessionToken) return true;

    // Pokud je zařízení offline, neodlašujeme uživatele!
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return true;
    }

    try {
      const res = await supabaseRequest('/rest/v1/rpc/verify_attendance_session', {
        method: 'POST'
      }, currentUser.value);

      if (res?.success === false) {
        console.warn('Session není platná:', res.message || res.error);
        logout();
        return false;
      }

      if (res?.role && currentUser.value) {
        currentUser.value = {
          ...currentUser.value,
          role: res.role,
          displayName: res.display_name || currentUser.value.displayName
        };
        saveUserSession(currentUser.value, localStorage.getItem(LS_REMEMBER_KEY) !== 'false');
      }
      return true;
    } catch (err) {
      // Rozlišení síťové/offline chyby od neplatné session (401/403)
      const isNetworkError =
        (typeof navigator !== 'undefined' && !navigator.onLine) ||
        !err.status ||
        err.name === 'TypeError' ||
        err.message?.includes('fetch') ||
        err.message?.includes('Network');

      if (isNetworkError) {
        console.info('Ověření session odloženo (aplikace je offline nebo síť není dostupná).');
        return true;
      }

      console.warn('Session expirovala nebo byla na serveru zrušena:', err.message);
      logout();
      return false;
    }
  }

  return {
    currentUser,
    isAuthenticated,
    isAdmin,
    login,
    register,
    changePin,
    logout,
    verifySession
  };
}
