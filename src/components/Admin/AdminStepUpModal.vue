<template>
  <dialog
    ref="dialogRef"
    class="win11-dialog"
    @click="onBackdropClick"
    @cancel.prevent="cancel"
  >
    <div class="win11-dialog-surface compact">
      <header class="dialog-header">
        <div>
          <span class="dialog-subtitle">Bezpečnostní ověření</span>
          <h2>Potvrdit administrátorskou operaci</h2>
        </div>
        <button
          class="win-btn-subtle icon-only"
          type="button"
          aria-label="Zavřít"
          @click="cancel"
        >
          ×
        </button>
      </header>

      <form
        class="dialog-body-scroll"
        @submit.prevent="submit"
      >
        <input
          :value="username"
          type="text"
          name="username"
          autocomplete="username"
          tabindex="-1"
          aria-hidden="true"
          style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;"
        >

        <p class="dialog-info-text">
          {{ reason }}
        </p>
        <p class="muted">
          Pro tuto citlivou operaci znovu zadej svůj současný admin PIN / heslo.
        </p>

        <label class="win-field">
          <span>Admin PIN / heslo *</span>
          <input
            ref="pinInputRef"
            v-model="pin"
            type="password"
            required
            autocomplete="current-password"
            placeholder="Zadej svůj současný PIN / heslo"
          >
        </label>

        <div class="dialog-footer-block">
          <button
            class="win-btn-accent full-width-btn"
            type="submit"
          >
            Potvrdit operaci
          </button>
          <button
            class="win-btn-standard full-width-btn"
            type="button"
            style="margin-top: 6px;"
            @click="cancel"
          >
            Zrušit
          </button>
        </div>
      </form>
    </div>
  </dialog>
</template>

<script setup>
import { nextTick, ref } from 'vue';

defineProps({
  username: {
    type: String,
    default: ''
  }
});

const dialogRef = ref(null);
const pinInputRef = ref(null);
const pin = ref('');
const reason = ref('Potvrď citlivou administrátorskou operaci.');
let resolver = null;

function finish(value) {
  const resolve = resolver;
  resolver = null;
  pin.value = '';
  if (dialogRef.value?.open) dialogRef.value.close();
  resolve?.(value);
}

function request(message = 'Potvrď citlivou administrátorskou operaci.') {
  if (resolver) {
    resolver(null);
    resolver = null;
  }
  pin.value = '';
  reason.value = message;
  dialogRef.value?.showModal();
  nextTick(() => pinInputRef.value?.focus());
  return new Promise((resolve) => {
    resolver = resolve;
  });
}

function submit() {
  if (!pin.value) return;
  finish(pin.value);
}

function cancel() {
  finish(null);
}

function onBackdropClick(event) {
  if (event.target === dialogRef.value) cancel();
}

defineExpose({ request });
</script>
