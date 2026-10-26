<template>
  <dialog ref="dialogRef" class="win11-dialog" @click="onBackdropClick">
    <div class="win11-dialog-surface compact">
      <header class="dialog-header">
        <div>
          <span class="dialog-subtitle">Nový profil</span>
          <h2>{{ isFirstUser ? 'První registrace (Správce)' : 'Registrace uživatele' }}</h2>
        </div>
        <button class="win-btn-subtle icon-only" type="button" aria-label="Zavřít" @click="close">
          ×
        </button>
      </header>

      <form class="dialog-body-scroll" @submit.prevent="handleSubmit">
        <div v-if="isFirstUser" class="win-infobar success" style="margin-bottom: 12px;">
          <div class="infobar-icon">🛡️</div>
          <div class="infobar-body">
            <strong>První registrace (Správce systému)</strong>
            <p>V databázi dosud není vytvořen žádný uživatel. Tento účet získá roli administrátora a nepotřebuje pozvánku.</p>
          </div>
        </div>

        <div v-else class="win-infobar info" style="margin-bottom: 12px;">
          <div class="infobar-icon">🔒</div>
          <div class="infobar-body">
            <strong>Registrace na pozvánku (Invite-Only)</strong>
            <p>Pro vytvoření osobního účtu je vyžadován platný kód pozvánky od správce docházky.</p>
          </div>
        </div>

        <p class="dialog-info-text">
          Vytvoř si nový osobní profil ve společné databázi. Budeš mít vlastní evidenci docházky i nastavení směn.
        </p>

        <div class="dialog-form-row">
          <label class="win-field">
            <span>Uživatelské jméno (login bez mezer) *</span>
            <input
              v-model="username"
              type="text"
              placeholder="např. jiri.novak"
              required
              autocomplete="username"
            >
          </label>
          <label class="win-field">
            <span>Celé jméno (na výkaz docházky) *</span>
            <input
              v-model="displayName"
              type="text"
              placeholder="např. Jiří Novák"
              required
              autocomplete="name"
            >
          </label>
        </div>

        <div class="dialog-form-row">
          <label class="win-field">
            <span>Zvol si PIN nebo heslo *</span>
            <input
              v-model="pin"
              type="password"
              placeholder="Minimálně 4 znaky"
              required
              minlength="4"
              autocomplete="new-password"
            >
          </label>
          <label class="win-field">
            <span>Potvrzení PINu / hesla *</span>
            <input
              v-model="pinConfirm"
              type="password"
              placeholder="Zopakuj PIN/heslo"
              required
              minlength="4"
              autocomplete="new-password"
            >
          </label>
        </div>

        <label v-if="!isFirstUser" class="win-field" style="margin-top: 6px;">
          <span>Kód pozvánky od správce (Invite code) *</span>
          <input
            v-model="inviteCode"
            type="text"
            placeholder="např. INV-8X2K9M"
            autocomplete="off"
            required
          >
          <small class="muted" style="font-size: 11px; margin-top: 3px; display: block;">
            Registrace nových uživatelů je uzamčena. Zadej kód pozvánky od správce.
          </small>
        </label>

        <div class="win-toggle-control" style="margin: 6px 0 12px;">
          <label class="switch-label">
            <input v-model="mergeLocal" type="checkbox">
            <span class="switch-slider"></span>
            <div class="switch-text">
              <strong>Nahrát dosavadní záznamy z tohoto zařízení do nového účtu</strong>
            </div>
          </label>
        </div>

        <div class="dialog-footer-block">
          <button class="win-btn-accent full-width-btn" type="submit" :disabled="loading">
            {{ loading ? 'Vytváření účtu...' : 'Vytvořit účet v databázi' }}
          </button>
          <div class="modal-switch-link">
            <span>Už máš účet?</span>
            <button class="text-link-btn" type="button" @click="switchToLogin">
              Přihlásit se k existujícímu účtu
            </button>
          </div>
        </div>
      </form>
    </div>
  </dialog>
</template>

<script setup>
import { ref } from 'vue';

const emit = defineEmits(['register-submit', 'switch-to-login']);

const dialogRef = ref(null);
const isFirstUser = ref(false);
const username = ref('');
const displayName = ref('');
const pin = ref('');
const pinConfirm = ref('');
const inviteCode = ref('');
const mergeLocal = ref(true);
const loading = ref(false);

function open(firstArg = false, secondArg = '') {
  username.value = '';
  displayName.value = '';
  pin.value = '';
  pinConfirm.value = '';
  isFirstUser.value = typeof firstArg === 'boolean' ? firstArg : false;
  // Podpora volání open(prefilledInvite) i legacy open(isFirst, prefilledInvite)
  const prefilled = typeof firstArg === 'string' ? firstArg : (secondArg || '');
  inviteCode.value = prefilled;
  mergeLocal.value = true;
  loading.value = false;
  dialogRef.value?.showModal();
}

function close() {
  dialogRef.value?.close();
}

function switchToLogin() {
  close();
  emit('switch-to-login');
}

function handleSubmit() {
  if (pin.value !== pinConfirm.value) {
    alert('Zadané PINy/hesla se neshodují.');
    return;
  }
  emit('register-submit', {
    username: username.value,
    displayName: displayName.value,
    pin: pin.value,
    pinConfirm: pinConfirm.value,
    inviteCode: inviteCode.value,
    mergeLocal: mergeLocal.value
  });
}

function onBackdropClick(e) {
  if (e.target === dialogRef.value) {
    close();
  }
}

defineExpose({ open, close, setLoading: (l) => { loading.value = l; } });
</script>
