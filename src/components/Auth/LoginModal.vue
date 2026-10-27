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

        <div class="dialog-footer-block">
          <button class="win-btn-accent full-width-btn" type="submit" :disabled="loading">
            {{ loading ? 'Přihlašování...' : 'Přihlásit se' }}
          </button>
          <div class="modal-switch-link">
            <span>Nemáš ještě vytvořený účet?</span>
            <button class="text-link-btn" type="button" @click="switchToRegister">
              Registrace nového účtu
            </button>
          </div>
        </div>
      </form>
    </div>
  </dialog>
</template>

<script setup>
import { ref } from 'vue';

const emit = defineEmits(['login-submit', 'switch-to-register', 'toast']);

const dialogRef = ref(null);
const username = ref('');
const pin = ref('');
const rememberMe = ref(true);
const loading = ref(false);

function open() {
  username.value = '';
  pin.value = '';
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

function onBackdropClick(e) {
  if (e.target === dialogRef.value) {
    close();
  }
}

defineExpose({ open, close, setLoading: (l) => { loading.value = l; } });
</script>

