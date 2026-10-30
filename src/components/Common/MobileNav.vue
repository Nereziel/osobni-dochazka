<template>
  <nav
    class="win-mobile-nav no-print"
    aria-label="Mobilní navigace"
  >
    <button
      class="m-nav-btn"
      :class="{ active: currentView === 'dashboard' }"
      type="button"
      @click="$emit('navigate', 'dashboard')"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
      >
        <rect
          x="3"
          y="3"
          width="7"
          height="9"
          rx="1"
        /><rect
          x="14"
          y="3"
          width="7"
          height="5"
          rx="1"
        /><rect
          x="14"
          y="12"
          width="7"
          height="9"
          rx="1"
        /><rect
          x="3"
          y="16"
          width="7"
          height="5"
          rx="1"
        />
      </svg>
      <small>Dnes</small>
    </button>

    <button
      class="m-nav-btn"
      :class="{ active: currentView === 'calendar' }"
      type="button"
      @click="$emit('navigate', 'calendar')"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
      >
        <rect
          x="3"
          y="4"
          width="18"
          height="18"
          rx="2"
        /><line
          x1="16"
          y1="2"
          x2="16"
          y2="6"
        /><line
          x1="8"
          y1="2"
          x2="8"
          y2="6"
        /><line
          x1="3"
          y1="10"
          x2="21"
          y2="10"
        />
      </svg>
      <small>Kalendář</small>
    </button>

    <button
      class="m-nav-btn"
      :class="{ active: currentView === 'timesheet' }"
      type="button"
      @click="$emit('navigate', 'timesheet')"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
      >
        <line
          x1="18"
          y1="20"
          x2="18"
          y2="10"
        /><line
          x1="12"
          y1="20"
          x2="12"
          y2="4"
        /><line
          x1="6"
          y1="20"
          x2="6"
          y2="14"
        />
      </svg>
      <small>Výkaz</small>
    </button>

    <button
      class="m-nav-btn"
      :class="{ active: currentView === 'settings' || currentView === 'team' }"
      type="button"
      @click="$emit('navigate', 'settings')"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
      >
        <circle
          cx="12"
          cy="12"
          r="3"
        />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
      <small>Nastavení</small>
    </button>
  </nav>
</template>

<script setup>
defineProps({
  currentView: {
    type: String,
    required: true
  }
});

defineEmits(['navigate']);
</script>

