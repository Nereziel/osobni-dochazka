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
          Nastav nový dočasný PIN pro uživatele <strong>{{ targetDisplayName }}</strong> (<code>{{ targetUsername }}</code>). Server po resetu zneplatní všechny jeho aktivní relace.
        </p>

        <label class="win-field">
          <span>Tvůj současný admin PIN / heslo *</span>
          <input
            v-model="adminPin"
            type="password"
            placeholder="Potvrď svoji identitu"
            required
            autocomplete="current-password"
          >
        </label>

        <label class="win-field">
          <span>Nový dočasný PIN (min. 6 znaků) *</span>
          <input
            v-model="newPin"
            type="password"
            placeholder="Zadej nový PIN"
            required
            minlength="6"
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
            minlength="6"
            autocomplete="new-password"
          >
        </label>

        <div class="dialog-footer-block">
          <button
            class="win-btn-accent full-width-btn"
            type="submit"
            :disabled="loading"
          >
            {{ loading ? 'Ověřování...' : 'Uložit nový PIN kolegovi' }}
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
import { supabaseRequest } from '../../services/supabase.js';

const emit = defineEmits(['reset-pin-submit']);

const dialogRef = ref(null);
const targetUserKey = ref('');
const targetUsername = ref('');
const targetDisplayName = ref('');
const adminPin = ref('');
const newPin = ref('');
const newPinConfirm = ref('');
const loading = ref(false);

function open(profile) {
  targetUserKey.value = profile.user_key;
  targetUsername.value = profile.username;
  targetDisplayName.value = profile.display_name || profile.username;
  adminPin.value = '';
  newPin.value = '';
  newPinConfirm.value = '';
  loading.value = false;
  dialogRef.value?.showModal();
}

function close() {
  dialogRef.value?.close();
}

async function handleSubmit() {
  if (!adminPin.value) {
    alert('Pro reset PINu je nutné potvrdit svůj admin PIN / heslo.');
    return;
  }
  if (newPin.value.length < 6) {
    alert('Nový PIN/heslo musí mít alespoň 6 znaků.');
    return;
  }
  if (newPin.value !== newPinConfirm.value) {
    alert('Nové PINy se neshodují.');
    return;
  }

  loading.value = true;
  try {
    await supabaseRequest('/rest/v1/rpc/admin_step_up', {
      method: 'POST',
      body: JSON.stringify({ p_admin_pin: adminPin.value })
    });
    emit('reset-pin-submit', {
      targetUserKey: targetUserKey.value,
      targetUsername: targetUsername.value,
      newPin: newPin.value
    });
  } catch (err) {
    loading.value = false;
    alert(err.message || 'Ověření admin PINu selhalo.');
  } finally {
    adminPin.value = '';
  }
}

function onBackdropClick(e) {
  if (e.target === dialogRef.value) {
    close();
  }
}

defineExpose({ open, close, setLoading: (l) => { loading.value = l; } });
</script>
