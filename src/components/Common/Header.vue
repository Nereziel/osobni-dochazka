<template>
  <header class="win11-header no-print">
    <div class="header-breadcrumb">
      <div class="header-eyebrow">{{ greeting }}</div>
      <h1 class="header-title">{{ viewTitle }}</h1>
    </div>

    <div class="header-right">
      <!-- Živý stav cloudu & outbox fronty -->
      <div class="cloud-status-widget" :class="statusClass" :title="statusTooltip">
        <span class="status-pulse-dot"></span>
        <span>{{ statusLabel }}</span>
        <button
          class="icon-tiny-btn"
          :class="{ spinning: syncState === 'syncing' }"
          type="button"
          title="Synchronizovat nyní"
          @click="$emit('sync')"
        >
          ↻
        </button>
      </div>

      <!-- Uživatelská pilulka -->
      <button class="win-user-pill" type="button" title="Uživatelský účet" @click="$emit('user-click')">
        <span class="mini-avatar">{{ userInitials }}</span>
        <span class="header-user-text">{{ userDisplayName }}</span>
      </button>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  viewTitle: {
    type: String,
    default: 'Dnešní přehled'
  },
  currentUser: {
    type: Object,
    default: null
  },
  syncState: {
    type: String,
    default: 'local' // 'local' | 'online' | 'syncing' | 'error'
  },
  pendingCount: {
    type: Number,
    default: 0
  },
  isOnline: {
    type: Boolean,
    default: true
  }
});

defineEmits(['sync', 'user-click']);

const greeting = computed(() => {
  const h = new Date().getHours();
  let greet = 'Dobré odpoledne';
  if (h >= 5 && h < 9) greet = 'Dobré ráno';
  else if (h >= 9 && h < 12) greet = 'Dobré dopoledne';
  else if (h >= 12 && h < 18) greet = 'Dobré odpoledne';
  else greet = 'Dobrý večer';

  const name = props.currentUser?.displayName || props.currentUser?.username;
  return name ? `${greet}, ${name}` : greet;
});

const userDisplayName = computed(() => {
  if (props.currentUser?.displayName) return props.currentUser.displayName;
  if (props.currentUser?.username) return props.currentUser.username;
  return 'Přihlásit se';
});

const userInitials = computed(() => {
  const name = props.currentUser?.displayName || props.currentUser?.username;
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
});

const statusClass = computed(() => {
  if (!props.isOnline) return 'error';
  if (props.syncState === 'syncing') return 'syncing';
  if (props.syncState === 'error') return 'error';
  if (props.syncState === 'online') return 'online';
  return 'local';
});

const statusLabel = computed(() => {
  if (!props.isOnline) {
    return props.pendingCount > 0 ? `Offline (${props.pendingCount})` : 'Offline';
  }
  if (props.syncState === 'error') return 'Chyba';
  if (props.pendingCount > 0) return `Čeká (${props.pendingCount})`;
  if (props.syncState === 'online' || props.syncState === 'syncing') return 'Cloud';
  return 'Lokální';
});

const statusTooltip = computed(() => {
  if (!props.isOnline) return 'Připojení k internetu je nedostupné. Změny se ukládají lokálně.';
  if (props.syncState === 'syncing') return 'Probíhá synchronizace...';
  if (props.syncState === 'error') return 'Poslední synchronizace selhala. Kliknutím spustíte synchronizaci znovu.';
  if (props.pendingCount > 0) return `${props.pendingCount} položek čeká ve frontě na odeslání do cloudu.`;
  if (props.syncState === 'online') return 'Cloud synchronizován (aktuální stav)';
  return 'Lokální režim';
});
</script>

