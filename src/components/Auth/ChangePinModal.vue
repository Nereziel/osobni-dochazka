<template>
  <dialog
    ref="dialogRef"
    class="win11-dialog"
    @click="onBackdropClick"
  >
    <div class="win11-dialog-surface compact">
      <header class="dialog-header">
        <div>
          <span class="dialog-subtitle">Zabezpečení profilu</span>
          <h2>Změna osobního PINu / hesla</h2>
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
        <p class="dialog-info-text">
          Pro změnu zadej svůj dosavadní PIN a zvol si nový (min. 4 znaky). Nový PIN se zabezpečeně zahashuje a uloží v databázi.
        </p>

        <label class="win-field">
          <span>Současný PIN / heslo *</span>
          <input
            v-model="oldPin"
            type="password"
            placeholder="••••"
            required
            autocomplete="current-password"
          >
        </label>

        <label class="win-field">
          <span>Nový PIN / heslo (min. 4 znaky) *</span>
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
          <span>Potvrzení nového PINu / hesla *</span>
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
            {{ loading ? 'Ukládání...' : 'Uložit nový PIN v databázi' }}
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

const emit = defineEmits(['change-pin-submit']);

const dialogRef = ref(null);
const oldPin = ref('');
const newPin = ref('');
const newPinConfirm = ref('');
const loading = ref(false);

function open() {
  oldPin.value = '';
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
    alert('Nový PIN a jeho potvrzení se neshodují.');
    return;
  }
  emit('change-pin-submit', {
    oldPin: oldPin.value,
    newPin: newPin.value,
    newPinConfirm: newPinConfirm.value
  });
}

function onBackdropClick(e) {
  if (e.target === dialogRef.value) {
    close();
  }
}

defineExpose({ open, close, setLoading: (l) => { loading.value = l; } });
</script>

