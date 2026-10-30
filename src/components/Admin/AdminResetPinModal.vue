<template>
  <dialog
    ref="dialogRef"
    class="win11-dialog"
    @click="onBackdropClick"
  >
    <div class="win11-dialog-surface compact">
      <header class="dialog-header">
        <div>
          <span class="dialog-subtitle">Správa zaměstnance</span>
          <h2>Resetování PINu</h2>
        </div>
        <button
          class="win-btn-subtle icon-only"
          type="button"
          aria-label="Zavřít"
          @click="close"
        >
          ×
        </button>
      </header>

      <form
        class="dialog-body-scroll"
        @submit.prevent="handleSubmit"
      >
        <input
          :value="targetUsername"
          type="text"
          name="username"
          autocomplete="username"
          tabindex="-1"
          aria-hidden="true"
          style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;"
        >

        <p class="dialog-info-text">
          Nastav nový dočasný PIN pro uživatele <strong>{{ targetDisplayName }}</strong> (<code>{{ targetUsername }}</code>).
        </p>

        <label class="win-field">
          <span>Nový dočasný PIN (min. 4 znaky) *</span>
          <input
            v-model="newPin"
            type="password"
            placeholder="Zadej nový PIN"
            required
            minlength="4"
            autocomplete="new-password"
          >
        </label>

        <label class="win-field">
          <span>Potvrzení nového PINu *</span>
          <input
            v-model="newPinConfirm"
            type="password"
            placeholder="Zopakuj nový PIN"
            required
            minlength="4"
            autocomplete="new-password"
          >
        </label>

        <div class="dialog-footer-block">
          <button
            class="win-btn-accent full-width-btn"
            type="submit"
            :disabled="loading"
          >
            {{ loading ? 'Ukládání...' : 'Uložit nový PIN kolegovi' }}
          </button>
          <button
            class="win-btn-standard full-width-btn"
            type="button"
            style="margin-top: 6px;"
            @click="close"
          >
            Zrušit
          </button>
        </div>
      </form>
    </div>
  </dialog>
</template>

<script setup>
import { ref } from 'vue';

const emit = defineEmits(['reset-pin-submit']);

const dialogRef = ref(null);
const targetUserKey = ref('');
const targetUsername = ref('');
const targetDisplayName = ref('');
const newPin = ref('');
const newPinConfirm = ref('');
const loading = ref(false);

function open(profile) {
  targetUserKey.value = profile.user_key;
  targetUsername.value = profile.username;
  targetDisplayName.value = profile.display_name || profile.username;
  newPin.value = '';
  newPinConfirm.value = '';
  loading.value = false;
  dialogRef.value?.showModal();
}

function close() {
  dialogRef.value?.close();
}

function handleSubmit() {
  if (newPin.value !== newPinConfirm.value) {
    alert('Nové PINy se neshodují.');
    return;
  }
  emit('reset-pin-submit', {
    targetUserKey: targetUserKey.value,
    targetUsername: targetUsername.value,
    newPin: newPin.value
  });
}

function onBackdropClick(e) {
  if (e.target === dialogRef.value) {
    close();
  }
}

defineExpose({ open, close, setLoading: (l) => { loading.value = l; } });
</script>
