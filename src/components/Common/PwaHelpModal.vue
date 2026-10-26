<template>
  <dialog ref="dialogRef" class="win11-dialog" @click="onBackdropClick">
    <div class="win11-dialog-surface compact">
      <header class="dialog-header">
        <div>
          <span class="dialog-subtitle">Mobil &amp; Počítač</span>
          <h2>Jak aplikaci nainstalovat na plochu</h2>
        </div>
        <button class="win-btn-subtle icon-only" type="button" aria-label="Zavřít" @click="close">
          ×
        </button>
      </header>

      <div class="dialog-body-scroll">
        <div class="dialog-subcard">
          <h4>📱 iPhone / iPad (Safari)</h4>
          <p>
            1. V Safari klepni na tlačítko <strong>Sdílet</strong> (čtvereček se šipkou nahoru).<br>
            2. V nabídce sjeď dolů a zvol <strong>Přidat na plochu</strong>.<br>
            3. Docházka se otevře na celou obrazovku jako nativní aplikace a data zůstávají dostupná offline.
          </p>
        </div>
        <div class="dialog-subcard">
          <h4>💻 Počítač (Edge / Chrome) &amp; Android</h4>
          <p>
            V adresním řádku prohlížeče klikni na ikonu <strong>Instalovat aplikaci</strong> (nebo nabídku tří teček &gt; Nainstalovat docházku).
            Aplikace se otevře v samostatném okně bez lišt prohlížeče a funguje i bez připojení k internetu.
          </p>
        </div>
      </div>
    </div>
  </dialog>
</template>

<script setup>
import { ref } from 'vue';

const dialogRef = ref(null);

function open() {
  dialogRef.value?.showModal();
}

function close() {
  dialogRef.value?.close();
}

function onBackdropClick(e) {
  if (e.target === dialogRef.value) {
    close();
  }
}

defineExpose({ open, close });
</script>

