<template>
  <dialog ref="dialogRef" class="win11-dialog" @click="onBackdropClick">
    <div class="win11-dialog-surface compact">
      <header class="dialog-header">
        <div>
          <span class="dialog-subtitle">Osobní účet</span>
          <h2>Přihlášení do docházky</h2>
        </div>
        <button class="win-btn-subtle icon-only" type="button" aria-label="Zavřít" @click="close">
          ×
        </button>
      </header>

      <form class="dialog-body-scroll" @submit.prevent="handleSubmit">
        <p class="dialog-info-text">
          Zadej své <strong>uživatelské jméno</strong> a <strong>PIN / heslo</strong>. Aplikace načte tvůj rozvrh a docházku ze společné databáze.
        </p>

        <label class="win-field">
          <span>Uživatelské jméno (login) *</span>
          <input
            v-model="username"
            type="text"
            placeholder="např. martin"
            required
            autocomplete="username"
          >
        </label>

        <label class="win-field">
          <span>Osobní PIN nebo heslo *</span>
          <input
            v-model="pin"
            type="password"
            placeholder="••••"
            required
            autocomplete="current-password"
          >
        </label>

        <div class="win-toggle-control" style="margin: 6px 0 10px;">
          <label class="switch-label">
            <input v-model="rememberMe" type="checkbox">
            <span class="switch-slider"></span>
            <div class="switch-text">
              <strong>Pamatovat si mě na tomto zařízení</strong>
              <small class="muted" style="display:block; font-size:11px;">Automatické přihlášení při každém otevření aplikace</small>
            </div>
          </label>
        </div>

        <div v-if="hasBiometrics" style="margin-bottom: 12px;">
          <button
            class="win-btn-standard full-width-btn"
            type="button"
            style="display:flex; align-items:center; justify-content:center; gap:8px;"
            @click="handleBiometricLogin"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
            <span>Přihlásit se pomocí Windows Hello / Otisku prstu</span>
          </button>
        </div>

        <div class="dialog-footer-block">
          <button class="win-btn-accent full-width-btn" type="submit" :disabled="loading">
            {{ loading ? 'Přihlašování...' : 'Přihlásit se' }}
          </button>
          <div class="modal-switch-link">
            <span>Máš kód pozvánky od správce?</span>
            <button class="text-link-btn" type="button" @click="switchToRegister">
              Registrace s pozvánkou
            </button>
          </div>
        </div>
      </form>
    </div>
  </dialog>
</template>

<script setup>
import { ref } from 'vue';

const emit = defineEmits(['login-success', 'switch-to-register', 'toast']);

const dialogRef = ref(null);
const username = ref('');
const pin = ref('');
const rememberMe = ref(true);
const loading = ref(false);
const hasBiometrics = ref(false);

function open(biometricsAvailable = false) {
  username.value = '';
  pin.value = '';
  hasBiometrics.value = biometricsAvailable;
  loading.value = false;
  dialogRef.value?.showModal();
}

function close() {
  dialogRef.value?.close();
}

function switchToRegister() {
  close();
  emit('switch-to-register');
}

function handleSubmit() {
  emit('login-submit', {
    username: username.value,
    pin: pin.value,
    rememberMe: rememberMe.value
  });
}

function handleBiometricLogin() {
  emit('biometric-login');
}

function onBackdropClick(e) {
  if (e.target === dialogRef.value) {
    close();
  }
}

defineExpose({ open, close, setLoading: (l) => { loading.value = l; } });
</script>

