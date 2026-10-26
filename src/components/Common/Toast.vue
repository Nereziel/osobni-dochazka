<template>
  <div
    class="win11-toast"
    :class="{ show: visible }"
    role="status"
    aria-live="polite"
  >
    <span class="toast-status-icon">{{ icon }}</span>
    <span>{{ message }}</span>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const visible = ref(false);
const message = ref('');
const icon = ref('ℹ️');
let timer = null;

function show(msg, ic = 'ℹ️', duration = 2400) {
  message.value = msg;
  icon.value = ic;
  visible.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    visible.value = false;
  }, duration);
}

defineExpose({
  show
});
</script>

