import { ref, computed } from 'vue';
import { supabaseRequest, isSupabaseConfigured } from '../services/supabase.js';

const LS_USER_KEY = 'dochazka_active_user_v2';
const LS_REMEMBER_KEY = 'dochazka_remember_login_v1';
const LS_BIOMETRICS_KEY = 'dochazka_biometrics_cred_v1';

/**
 * Legacy pomocná funkce pro hashování PINu na klientovi.
 * Používá se POUZE v offline/lokálním režimu nebo pro testy,
 * v produkčním Supabase režimu probíhá veškeré ověřování a hashování na serveru (bcrypt).
 */
export async function hashPin(pin, username) {
  const clean = (username || '').toLowerCase().trim();
  const raw = `dochazka:${clean}:${pin}`;
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv:${(h >>> 0).toString(16)}`;
}

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
  const isAuthenticated = computed(() => Boolean(currentUser.value?.userKey));
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

    const userKey = `user:${cleanUser}`;

    if (isSupabaseConfigured()) {
      const res = await supabaseRequest('/rest/v1/rpc/login_attendance_user', {
        method: 'POST',
        body: JSON.stringify({
          p_username: cleanUser,
          p_pin: pinInput,
          p_remember: Boolean(rememberMe)
        })
      });

      if (!res?.session_token) {
        throw new Error('Přihlášení se nezdařilo: server nevydal session token.');
      }

      const userObj = {
        sessionToken: res.session_token,
        userKey: res.user_key || userKey,
        username: res.username || cleanUser,
        displayName: res.display_name || cleanUser,
        role: res.role || 'employee',
        expiresAt: res.expires_at
      };

      saveUserSession(userObj, rememberMe);
      return { message: `Vítej zpět, ${userObj.displayName}!`, profile: userObj };
    } else {
      const userObj = {
        sessionToken: `local_session_${Date.now()}`,
        userKey,
        username: cleanUser,
        displayName: cleanUser,
        role: 'admin',
        expiresAt: null
      };
      saveUserSession(userObj, rememberMe);
      return { message: `Přihlášen lokální profil ${cleanUser}.`, profile: null };
    }
  }

  async function register(usernameInput, displayNameInput, pinInput, pinConfirmInput, inviteCodeInput) {
    const cleanUser = usernameInput.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!cleanUser) throw new Error('Zadej platné uživatelské jméno.');
    if (!displayNameInput.trim()) throw new Error('Zadej celé jméno na výkaz.');
    if (!pinInput || pinInput.length < 4) throw new Error('PIN/heslo musí mít alespoň 4 znaky.');
    if (pinInput !== pinConfirmInput) throw new Error('Zadaná hesla/PINy se neshodují.');

    const userKey = `user:${cleanUser}`;
    let assignedRole = 'employee';

    if (isSupabaseConfigured()) {
      const cleanInvite = (inviteCodeInput || '').trim().toUpperCase();

      const rpcRes = await supabaseRequest('/rest/v1/rpc/register_user_with_invite', {
        method: 'POST',
        body: JSON.stringify({
          p_username: cleanUser,
          p_display_name: displayNameInput.trim(),
          p_pin: pinInput,
          p_invite_code: cleanInvite
        })
      });

      if (rpcRes?.role) assignedRole = rpcRes.role;

      const userObj = {
        sessionToken: rpcRes.session_token,
        userKey: rpcRes.user_key || userKey,
        username: rpcRes.username || cleanUser,
        displayName: displayNameInput.trim(),
        role: assignedRole,
        expiresAt: rpcRes.expires_at
      };

      saveUserSession(userObj, true);
      return {
        message: assignedRole === 'admin'
          ? `Účet "${cleanUser}" byl vytvořen s rolí Správce (Admin)!`
          : `Účet "${cleanUser}" byl úspěšně vytvořen!`,
        user: userObj
      };
    } else {
      const userObj = {
        sessionToken: `local_session_${Date.now()}`,
        userKey,
        username: cleanUser,
        displayName: displayNameInput.trim(),
        role: 'admin',
        expiresAt: null
      };
      saveUserSession(userObj, true);
      return {
        message: `Lokální účet "${cleanUser}" vytvořen.`,
        user: userObj
      };
    }
  }

  async function changePin(oldPin, newPin, newPinConfirm) {
    if (!currentUser.value) throw new Error('Pro změnu PINu musíš být přihlášen.');
    if (!oldPin) throw new Error('Zadej svůj současný PIN / heslo.');
    if (!newPin || newPin.length < 4) throw new Error('Nový PIN musí mít alespoň 4 znaky.');
    if (newPin !== newPinConfirm) throw new Error('Nový PIN a jeho potvrzení se neshodují.');
    if (oldPin === newPin) throw new Error('Nový PIN musí být jiný než současný.');

    if (isSupabaseConfigured()) {
      await supabaseRequest('/rest/v1/rpc/change_attendance_pin', {
        method: 'POST',
        body: JSON.stringify({
          p_old_pin: oldPin,
          p_new_pin: newPin,
          p_revoke_others: true
        })
      }, currentUser.value);
    }

    return 'PIN byl úspěšně změněn.';
  }

  async function logout() {
    if (isSupabaseConfigured() && currentUser.value?.sessionToken) {
      try {
        await supabaseRequest('/rest/v1/rpc/logout_attendance_session', {
          method: 'POST',
          body: JSON.stringify({ p_all_devices: false })
        }, currentUser.value);
      } catch {
        // Ignorujeme případnou chybu při offline odhlášení
      }
    }
    saveUserSession(null);
    localStorage.removeItem(LS_BIOMETRICS_KEY);
  }

  async function verifySession() {
    if (!isSupabaseConfigured() || !currentUser.value?.sessionToken) return true;
    try {
      const res = await supabaseRequest('/rest/v1/rpc/verify_attendance_session', {
        method: 'POST'
      }, currentUser.value);
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
      console.warn('Session expirovala nebo byla odhlášena:', err);
      await logout();
      return false;
    }
  }

  // Biometrické odemknutí lokální relace (WebAuthn user verification)
  function isBiometricsSupported() {
    return Boolean(typeof window !== 'undefined' && window.PublicKeyCredential && navigator.credentials);
  }

  function hasSavedBiometrics() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_BIOMETRICS_KEY) || 'null');
      return Boolean(saved?.id && saved?.username && saved?.sessionToken);
    } catch {
      return false;
    }
  }

  async function registerBiometrics() {
    if (!isBiometricsSupported()) {
      throw new Error('Zařízení nepodporuje biometrické ověření (WebAuthn).');
    }
    if (!currentUser.value?.sessionToken) throw new Error('Musíš být přihlášen s aktivní relací.');

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userId = new TextEncoder().encode(currentUser.value.username);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Osobní docházka', id: window.location.hostname || 'localhost' },
        user: {
          id: userId,
          name: currentUser.value.username,
          displayName: currentUser.value.displayName || currentUser.value.username
        },
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred'
        },
        timeout: 60000,
        attestation: 'none'
      }
    });

    if (credential) {
      const rawId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      localStorage.setItem(LS_BIOMETRICS_KEY, JSON.stringify({
        id: rawId,
        username: currentUser.value.username,
        displayName: currentUser.value.displayName,
        sessionToken: currentUser.value.sessionToken,
        role: currentUser.value.role || 'employee',
        userKey: currentUser.value.userKey,
        enabledAt: new Date().toISOString()
      }));
      return true;
    }
    return false;
  }

  async function loginWithBiometrics() {
    if (!isBiometricsSupported()) throw new Error('Biometrika není podporována.');
    const saved = JSON.parse(localStorage.getItem(LS_BIOMETRICS_KEY) || 'null');
    if (!saved?.id || !saved?.username || !saved?.sessionToken) {
      throw new Error('Na tomto zařízení dosud není povoleno biometrické přihlašování.');
    }

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const credentialId = Uint8Array.from(atob(saved.id), c => c.charCodeAt(0));

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id: credentialId,
          type: 'public-key',
          transports: ['internal']
        }],
        userVerification: 'required',
        timeout: 60000
      }
    });

    if (assertion) {
      const userObj = {
        sessionToken: saved.sessionToken,
        userKey: saved.userKey,
        username: saved.username,
        displayName: saved.displayName,
        role: saved.role || 'employee'
      };
      saveUserSession(userObj, true);

      // Ověříme platnost obnovené session proti serveru
      const valid = await verifySession();
      if (!valid) {
        throw new Error('Uložená session na serveru expirovala. Přihlaste se prosím PINem.');
      }

      return `Vítej zpět, ${userObj.displayName}!`;
    }
    throw new Error('Biometrické ověření selhalo.');
  }

  return {
    currentUser,
    isAuthenticated,
    isAdmin,
    login,
    register,
    changePin,
    logout,
    verifySession,
    isBiometricsSupported,
    hasSavedBiometrics,
    registerBiometrics,
    loginWithBiometrics
  };
}
