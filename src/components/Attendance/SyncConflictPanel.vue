<template>
  <section class="win-infobar" aria-label="Konflikty synchronizace">
    <div class="infobar-body">
      <strong>Neodeslané změny: {{ pendingCount }}</strong>
      <p>Konflikty zůstávají uložené v tomto zařízení. Porovnej verze, než zvolíš cloudovou.</p>
      <button class="win-btn-standard" type="button" :disabled="busy" @click="loadDates">
        Zobrazit konflikty
      </button>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="loaded && !dates.length">Žádné zaznamenané konflikty.</p>
      <div v-if="dates.length" class="win-field">
        <span>Datum konfliktu</span>
        <select v-model="selectedDate" class="win-select" :disabled="busy" @change="review = null">
          <option v-for="date in dates" :key="date" :value="date">{{ date }}</option>
        </select>
        <button class="win-btn-standard" type="button" :disabled="busy || !selectedDate" @click="loadReview">
          Porovnat lokální a cloudovou verzi
        </button>
      </div>
      <div v-if="review" class="win-field">
        <strong>{{ review.date }}</strong>
        <div v-for="version in versions" :key="version.label">
          <strong>{{ version.label }}</strong>
          <template v-if="version.day && !version.day.deletedAt">
            <p>{{ TYPE_LABELS[version.day.type] || version.day.type }} · {{ version.day.start || '—' }} – {{ version.day.end || '—' }}</p>
            <p>Přestávka: {{ version.day.manualBreak ? version.day.breakMinutes + ' min' : 'automatická' }}</p>
            <p v-if="version.day.type === 'doctor'">Lékař: {{ version.day.doctorFullDay ? 'celý den' : (version.day.doctorStart || '—') + ' – ' + (version.day.doctorEnd || '—') }}</p>
            <p v-if="version.day.type === 'other'">Omluveno: {{ version.day.otherMinutes || 0 }} min</p>
            <p v-if="version.day.note" class="conflict-note">{{ version.day.note }}</p>
          </template>
          <p v-else>Odstraněný nebo chybějící záznam</p>
        </div>
        <p>Převzetím cloudu se zahodí neodeslané změny pouze tohoto dne. Export obsahuje obě verze a frontu; není určen k přímému importu.</p>
        <button class="win-btn-standard" type="button" :disabled="busy" @click="exportReview">Exportovat obě verze</button>
        <button class="win-btn-standard" type="button" :disabled="busy" @click="acceptCloud">Převzít cloudovou verzi</button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onBeforeUnmount } from 'vue';
import { listConflictDates, reviewConflict, adoptReviewedCloudVersion } from '../../services/conflictReview.js';
import { TYPE_LABELS } from '../../utils/attendance.js';

const props = defineProps({
  userId: { type: String, required: true },
  pendingCount: { type: Number, default: 0 }
});
const emit = defineEmits(['resolved', 'toast']);
const busy = ref(false);
const loaded = ref(false);
const dates = ref([]);
const selectedDate = ref('');
const review = ref(null);
const error = ref('');
let disposed = false;
onBeforeUnmount(() => { disposed = true; });

const versions = computed(() => review.value ? [
  { label: 'Lokální verze', day: review.value.local },
  { label: 'Cloudová verze', day: review.value.server }
] : []);

async function run(task) {
  if (busy.value || disposed) return;
  busy.value = true;
  error.value = '';
  try { await task(); }
  catch (err) { if (!disposed) error.value = err.message || 'Operace se nezdařila.'; }
  finally { if (!disposed) busy.value = false; }
}

function loadDates() {
  return run(async () => {
    review.value = null;
    dates.value = await listConflictDates(props.userId);
    selectedDate.value = dates.value[0] || '';
    loaded.value = true;
  });
}
function loadReview() {
  return run(async () => {
    review.value = null;
    review.value = await reviewConflict(props.userId, selectedDate.value);
  });
}
function exportReview() {
  if (!review.value) return;
  const { userId, date, local, server, queue } = review.value;
  const file = new Blob([JSON.stringify({ userId, date, local, server, pending: JSON.parse(queue) }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `dochazka-konflikt-${date}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function acceptCloud() {
  return run(async () => {
    const snapshot = review.value;
    if (!snapshot || !confirm(`Převzít cloudovou verzi dne ${snapshot.date} a zahodit jeho neodeslané lokální změny? Doporučujeme nejdříve export.`)) return;
    await adoptReviewedCloudVersion(snapshot, props.userId);
    if (disposed) return;
    review.value = null;
    dates.value = await listConflictDates(props.userId);
    selectedDate.value = dates.value[0] || '';
    emit('resolved');
    emit('toast', 'Cloudová verze převzata.', '✓');
  });
}
</script>

<style scoped>
.conflict-note { white-space: pre-wrap; overflow-wrap: anywhere; }
.win-field { margin-top: 0.75rem; }
</style>
