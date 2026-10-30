<template>
  <div
    v-if="needRefresh"
    class="pwa-update-bar"
    role="alert"
  >
    <div class="pwa-update-content">
      <span class="pwa-update-icon">✨</span>
      <span class="pwa-update-text">Je dostupná nová verze aplikace.</span>
    </div>
    <button
      class="win-btn-accent compact-btn update-btn"
      type="button"
      @click="updateApp"
    >
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
  background: var(--surface-card, #202020);
  color: var(--text-primary, #ffffff);
  border: 1px solid var(--line-strong, rgba(255, 255, 255, 0.18));
  border-radius: var(--radius, 8px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-sizing: border-box;
}

.pwa-update-content {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.pwa-update-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.pwa-update-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #ffffff);
  white-space: normal;
  line-height: 1.35;
}

.update-btn {
  flex-shrink: 0;
  white-space: nowrap;
}

/* Na mobilních zařízeních lištu umístíme bezpečně nad spodní navigační lištu */
@media (max-width: 768px) {
  .pwa-update-bar {
    left: 12px;
    right: 12px;
    bottom: calc(76px + var(--safe-bottom, 0px));
    padding: 12px 14px;
    gap: 10px;
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }

  .pwa-update-text {
    font-size: 12.5px;
  }
}

@media (max-width: 480px) {
  .pwa-update-bar {
    left: 8px;
    right: 8px;
    bottom: calc(74px + var(--safe-bottom, 0px));
    padding: 10px 12px;
    gap: 8px;
  }

  .pwa-update-text {
    font-size: 12px;
  }
}
</style>
