<template>
  <dialog
    ref="dialogRef"
    class="win11-dialog"
    @click="onBackdropClick"
  >
    <div class="win11-dialog-surface compact">
      <header class="dialog-header">
        <div>
          <span class="dialog-subtitle">Správa týmu</span>
          <h2>Vytvoření pozvánky pro kolegu</h2>
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
        @submit.prevent="generateInvite"
      >
        <p class="dialog-info-text">
          Vygeneruj jednorázový odkaz pozvánky. Nový uživatel získá účet s rolí zaměstnance. Povýšení na správce můžeš provést kdykoliv v přehledu týmu.
        </p>

        <div
          v-if="generatedUrl"
          class="dialog-subcard"
          style="margin-top: 14px;"
        >
          <span class="field-sub-label">Vygenerovaný odkaz s pozvánkou:</span>
          <div
            class="win-input-suffix"
            style="margin-top: 6px;"
          >
            <input
              :value="generatedUrl"
              type="text"
              readonly
            >
            <button
              class="win-btn-accent compact-btn"
              type="button"
              @click="copyUrl"
            >
              Kopírovat
            </button>
          </div>
          <small
            class="muted"
            style="margin-top: 4px; display: block;"
          >
            Kód pozvánky: <strong>{{ generatedCode }}</strong>
          </small>
        </div>

        <div class="dialog-footer-block">
          <button
            class="win-btn-accent full-width-btn"
            type="submit"
            :disabled="loading"
          >
            {{ loading ? 'Generování...' : 'Vygenerovat pozvánku' }}
          </button>
          <button
            class="win-btn-standard full-width-btn"
            type="button"
            style="margin-top: 6px;"
            @click="close"
          >
            Zavřít
          </button>
        </div>
      </form>
    </div>
  </dialog>
</template>

<script setup>
import { ref } from 'vue';

const emit = defineEmits(['generate-invite', 'toast']);

const dialogRef = ref(null);
const generatedUrl = ref('');
const generatedCode = ref('');
const loading = ref(false);

function open() {
  generatedUrl.value = '';
  generatedCode.value = '';
  loading.value = false;
  dialogRef.value?.showModal();
}

function close() {
  dialogRef.value?.close();
}

function setGenerated(code, url) {
  generatedCode.value = code;
  generatedUrl.value = url;
}

function generateInvite() {
  emit('generate-invite');
}

function copyUrl() {
  if (!generatedUrl.value) return;
  navigator.clipboard?.writeText(generatedUrl.value).then(() => {
    emit('toast', 'Odkaz zkopírován do schránky', '✓');
  }).catch(() => {
    prompt('Odkaz pozvánky:', generatedUrl.value);
  });
}

function onBackdropClick(e) {
  if (e.target === dialogRef.value) {
    close();
  }
}

defineExpose({ open, close, setGenerated, setLoading: (l) => { loading.value = l; } });
</script>

