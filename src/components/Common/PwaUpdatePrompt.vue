<template>
  <div v-if="needRefresh" class="pwa-update-bar" role="alert">
    <div class="pwa-update-content">
      <span class="pwa-update-icon">✨</span>
      <span>Je dostupná nová verze aplikace.</span>
    </div>
    <button class="win-btn-accent compact-btn" type="button" @click="updateApp">
      Aktualizovat
    </button>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';

const needRefresh = ref(false);
let updateSW = null;

onMounted(async () => {
  try {
    const { useRegisterSW } = await import('virtual:pwa-register/vue');
    const sw = useRegisterSW({
      onNeedRefresh() {
        needRefresh.value = true;
      },
      onOfflineReady() {
        // Offline ready
      }
    });
    updateSW = sw.updateServiceWorker;
  } catch {
    // Fallback pokud virtual:pwa-register není k dispozici (např. v čistém dev režimu)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              needRefresh.value = true;
            }
          });
        });
      });
    }
  }
});

function updateApp() {
  if (updateSW) {
    updateSW(true);
  } else {
    window.location.reload();
  }
}
</script>

<style scoped>
.pwa-update-bar {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px;
  background: var(--surface-flyout, #1e293b);
  color: var(--text-primary, #f8fafc);
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
  border-radius: 10px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(20px);
}
.pwa-update-content {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
}
.pwa-update-icon {
  font-size: 16px;
}
@media (max-width: 640px) {
  .pwa-update-bar {
    left: 16px;
    right: 16px;
    bottom: 80px;
    justify-content: space-between;
  }
}
</style>

