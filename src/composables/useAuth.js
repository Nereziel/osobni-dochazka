import { ref, computed } from 'vue';
import { supabaseRequest, isSupabaseConfigured } from '../services/supabase.js';

const LS_USER_KEY = 'dochazka_active_user_v2';
const LS_REMEMBER_KEY = 'dochazka_remember_login_v1';
const LS_BIOMETRICS_KEY = 'dochazka_biometrics_cred_v1';

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
    const pinHash = await hashPin(pinInput, cleanUser);
    const candidateUser = { userKey, username: cleanUser, pinHash };

    if (isSupabaseConfigured()) {
      const rows = await supabaseRequest(
        `/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(userKey)}&select=*`,
        {},
        candidateUser
      );
      const profile = rows?.[0];
      if (!profile) {
        throw new Error(`Uživatel "${cleanUser}" nebyl nalezen nebo byl zadán chybný PIN.`);
      }

      const userObj = {
        userKey,
        username: cleanUser,
        displayName: profile.display_name || cleanUser,
        pinHash,
        role: profile.role || 'employee'
      };

      saveUserSession(userObj, rememberMe);
      return { message: `Vítej zpět, ${userObj.displayName}!`, profile };
    } else {
      const userObj = {
        userKey,
        username: cleanUser,
        displayName: cleanUser,
        pinHash,
        role: 'admin'
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
    const pinHash = await hashPin(pinInput, cleanUser);
    let assignedRole = 'employee';

    if (isSupabaseConfigured()) {
      const cleanInvite = (inviteCodeInput || '').trim().toUpperCase();

      const rpcRes = await supabaseRequest('/rest/v1/rpc/register_user_with_invite', {
        method: 'POST',
        body: JSON.stringify({
          p_username: cleanUser,
          p_display_name: displayNameInput.trim(),
          p_pin_hash: pinHash,
          p_invite_code: cleanInvite
        })
      });

      if (rpcRes?.role) assignedRole = rpcRes.role;

      const userObj = {
        userKey,
        username: cleanUser,
        displayName: displayNameInput.trim(),
        pinHash,
        role: assignedRole
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
        userKey,
        username: cleanUser,
        displayName: displayNameInput.trim(),
        pinHash,
        role: 'admin'
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

    const oldHash = await hashPin(oldPin, currentUser.value.username);
    if (oldHash !== currentUser.value.pinHash) {
      throw new Error('Zadaný současný PIN není správný.');
    }

    const newHash = await hashPin(newPin, currentUser.value.username);

    if (isSupabaseConfigured()) {
      await supabaseRequest(`/rest/v1/attendance_profiles?user_key=eq.${encodeURIComponent(currentUser.value.userKey)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          pin_hash: newHash,
          updated_at: new Date().toISOString()
        })
      }, currentUser.value);
    }

    currentUser.value = {
      ...currentUser.value,
      pinHash: newHash
    };
    saveUserSession(currentUser.value);
    return 'PIN byl úspěšně změněn.';
  }

  function logout() {
    saveUserSession(null);
    localStorage.removeItem(LS_BIOMETRICS_KEY);
  }

  // Biometrické odemknutí lokální relace (WebAuthn user verification)
  function isBiometricsSupported() {
    return Boolean(typeof window !== 'undefined' && window.PublicKeyCredential && navigator.credentials);
  }

  function hasSavedBiometrics() {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_BIOMETRICS_KEY) || 'null');
      return Boolean(saved?.id && saved?.username);
    } catch {
      return false;
    }
  }

  async function registerBiometrics() {
    if (!isBiometricsSupported()) {
      throw new Error('Zařízení nepodporuje biometrické ověření (WebAuthn).');
    }
    if (!currentUser.value) throw new Error('Musíš být přihlášen.');

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
        pinHash: currentUser.value.pinHash,
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
    if (!saved?.id || !saved?.username) {
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
        userKey: saved.userKey,
        username: saved.username,
        displayName: saved.displayName,
        pinHash: saved.pinHash,
        role: saved.role || 'employee'
      };
      saveUserSession(userObj, true);
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
    isBiometricsSupported,
    hasSavedBiometrics,
    registerBiometrics,
    loginWithBiometrics
  };
}

