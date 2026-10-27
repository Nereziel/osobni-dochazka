<template>
  <section class="win11-view active">
    <div class="team-back-row">
      <button class="win-btn-subtle" type="button" @click="$emit('back-to-settings')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>Zpět do Nastavení</span>
      </button>
    </div>

    <div class="win-toolbar-bar">
      <div class="toolbar-nav-group">
        <div class="team-header-info">
          <h2>Správa týmu a pozvánek</h2>
          <span class="muted">Invite-Only registrace a přehled zaměstnanců</span>
        </div>
      </div>

      <div class="toolbar-actions-group">
        <button class="win-btn-accent" type="button" @click="$emit('open-create-invite')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Vytvořit pozvánku</span>
        </button>
        <button class="win-btn-standard icon-btn" type="button" title="Obnovit data týmu" @click="refreshData">
          ↻
        </button>
      </div>
    </div>

    <div class="team-layout-grid">
      <!-- LEVÝ SLOUPEC: POZVÁNKY A SEZNAM ZAMĚSTNANCŮ -->
      <div class="team-col-main">
        <!-- KARTA POZVÁNEK -->
        <article class="win-card team-card">
          <div class="card-header-row">
            <div>
              <h3>Aktivní a využité pozvánky</h3>
              <p>Jednorázové invite kódy pro nové kolegy.</p>
            </div>
            <span class="win-badge neutral">{{ invites.length }} pozvánek</span>
          </div>

          <div class="table-responsive-wrap">
            <table class="win11-datagrid">
              <thead>
                <tr>
                  <th>Kód pozvánky</th>
                  <th>Cílová role</th>
                  <th>Stav</th>
                  <th>Využil</th>
                  <th>Akce</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="inv in invites" :key="inv.code">
                  <td><strong><code>{{ inv.code }}</code></strong></td>
                  <td>
                    <span class="role-badge" :class="inv.target_role">
                      {{ inv.target_role === 'admin' ? 'Správce' : 'Zaměstnanec' }}
                    </span>
                  </td>
                  <td>
                    <span class="invite-status-badge" :class="inv.is_used ? 'used' : 'unused'">
                      {{ inv.is_used ? 'Využita' : 'Aktivní' }}
                    </span>
                  </td>
                  <td>{{ inv.used_by ? inv.used_by.replace('user:', '') : '—' }}</td>
                  <td>
                    <div class="table-action-cell">
                      <button class="win-btn-standard compact-btn" type="button" title="Kopírovat odkaz pozvánky" @click="copyInviteUrl(inv.code)">
                        🔗 Odkaz
                      </button>
                      <button class="win-btn-subtle compact-btn danger-btn" type="button" title="Smazat pozvánku" @click="deleteInvite(inv)">
                        ✕ Smazat
                      </button>
                    </div>
                  </td>
                </tr>
                <tr v-if="invites.length === 0">
                  <td colspan="5" style="text-align:center; padding: 20px;" class="muted">
                    Zatím nebyly vytvořeny žádné pozvánky. Klikni nahoře na "Vytvořit pozvánku".
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <!-- KARTA ZAMĚSTNANCŮ -->
        <article class="win-card team-card">
          <div class="card-header-row">
            <div>
              <h3>Seznam zaměstnanců</h3>
              <p>Registrovaní uživatelé ve sdílené databázi.</p>
            </div>
            <span class="win-badge neutral">{{ profiles.length }} uživatelů</span>
          </div>

          <div class="table-responsive-wrap">
            <table class="win11-datagrid">
              <thead>
                <tr>
                  <th>Jméno a příjmení</th>
                  <th>Login</th>
                  <th>Role</th>
                  <th>Registrace</th>
                  <th>Správa účtu</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="prof in profiles" :key="prof.user_key">
                  <td>
                    <strong>{{ prof.display_name || prof.username }}</strong>
                    <small v-if="prof.user_key === currentUser?.userKey" class="muted"> (ty)</small>
                  </td>
                  <td><code>{{ prof.username }}</code></td>
                  <td>
                    <span class="role-badge" :class="prof.role === 'admin' ? 'admin' : 'employee'">
                      {{ prof.role === 'admin' ? 'Správce' : 'Zaměstnanec' }}
                    </span>
                  </td>
                  <td>{{ formatDate(prof.created_at) }}</td>
                  <td>
                    <div class="table-action-cell">
                      <button class="win-btn-standard compact-btn" type="button" title="Nastavit nový PIN" @click="$emit('open-reset-pin', prof)">
                        🔑 Reset PIN
                      </button>
                      <template v-if="prof.user_key !== currentUser?.userKey">
                        <button class="win-btn-subtle compact-btn" type="button" title="Změnit roli" @click="toggleRole(prof)">
                          {{ prof.role === 'admin' ? 'Odebrat admin' : 'Dát admin' }}
                        </button>
                        <button class="win-btn-subtle compact-btn danger-btn" type="button" title="Smazat uživatele" @click="deleteUser(prof)">
                          ✕ Smazat
                        </button>
                      </template>
                    </div>
                  </td>
                </tr>
                <tr v-if="profiles.length === 0">
                  <td colspan="5" style="text-align:center; padding: 20px;" class="muted">
                    V databázi zatím nejsou žádní uživatelé.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>
      </div>

      <!-- PRAVÝ SLOUPEC: SOUHRN DOCHÁZKY CELÉHO TÝMU -->
      <div class="team-col-side">
        <article class="win-card team-card">
          <div class="card-header-row">
            <div>
              <h3>Měsíční docházka týmu</h3>
              <p>{{ currentMonthTitle }}</p>
            </div>
          </div>

          <div class="team-summary-list">
            <div
              v-for="s in summaries"
              :key="s.user_key"
              class="team-summary-item"
            >
              <div class="team-user-meta">
                <div class="mini-avatar">{{ (s.display_name || s.username || '?')[0].toUpperCase() }}</div>
                <div>
                  <strong>{{ s.display_name || s.username }}</strong>
                  <small>{{ s.recorded_days }} evidovaných dnů · Dovolená: {{ s.vacation_days_used }} d.</small>
                </div>
              </div>
              <div class="team-user-stats">
                <strong>{{ formatDuration(s.total_worked_minutes || 0) }}</strong>
                <small :class="s.total_balance_minutes > 0 ? 'positive' : s.total_balance_minutes < 0 ? 'negative' : 'muted'">
                  Saldo: {{ formatDuration(s.total_balance_minutes || 0, true) }}
                </small>
              </div>
            </div>

            <p v-if="summaries.length === 0" class="muted" style="font-size: 13px; margin: 10px 0;">
              V tomto měsíci zatím nejsou evidována žádná data docházky týmu.
            </p>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { supabaseRequest } from '../services/supabase.js';
import { formatDuration, pad } from '../utils/time.js';
import { fmtMonthTitle } from '../utils/dates.js';

const props = defineProps({
  currentUser: {
    type: Object,
    default: null
  }
});

const emit = defineEmits([
  'back-to-settings',
  'open-create-invite',
  'open-reset-pin',
  'toast'
]);

const invites = ref([]);
const profiles = ref([]);
const summaries = ref([]);
const loading = ref(false);

const currentMonthTitle = computed(() => fmtMonthTitle(new Date()));

function formatDate(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleDateString('cs-CZ');
}

async function loadInvites() {
  try {
    const rows = await supabaseRequest('/rest/v1/attendance_invites?order=created_at.desc', {}, props.currentUser);
    invites.value = rows || [];
  } catch (err) {
    console.warn('Načtení pozvánek selhalo:', err);
  }
}

async function loadProfiles() {
  try {
    const rows = await supabaseRequest('/rest/v1/attendance_profiles?order=created_at.asc', {}, props.currentUser);
    profiles.value = rows || [];
  } catch (err) {
    console.warn('Načtení profilů selhalo:', err);
  }
}

async function loadSummaries() {
  try {
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const rows = await supabaseRequest(`/rest/v1/v_monthly_attendance_summary?month=eq.${monthStr}`, {}, props.currentUser);
    summaries.value = rows || [];
  } catch (err) {
    console.warn('Načtení souhrnů selhalo:', err);
  }
}

async function refreshData() {
  loading.value = true;
  await Promise.all([loadInvites(), loadProfiles(), loadSummaries()]);
  loading.value = false;
  emit('toast', 'Data týmu obnovena', '✓');
}

onMounted(() => {
  refreshData();
});

function copyInviteUrl(code) {
  const url = `${window.location.origin}${window.location.pathname}?invite=${code}`;
  navigator.clipboard?.writeText(url).then(() => {
    emit('toast', `Odkaz s kódem ${code} zkopírován do schránky`, '✓');
  }).catch(() => {
    prompt('Odkaz pozvánky:', url);
  });
}

async function deleteInvite(inv) {
  if (!confirm(`Opravdu smazat pozvánku ${inv.code}? Tuto akci nelze vrátit.`)) return;

  try {
    try {
      await supabaseRequest('/rest/v1/rpc/admin_delete_invite', {
        method: 'POST',
        body: JSON.stringify({ p_code: inv.code })
      }, props.currentUser);
    } catch (rpcErr) {
      if (rpcErr.message?.includes('404') || rpcErr.message?.includes('not found') || rpcErr.status === 404) {
        await supabaseRequest(`/rest/v1/attendance_invites?code=eq.${encodeURIComponent(inv.code)}`, {
          method: 'DELETE'
        }, props.currentUser);
      } else {
        throw rpcErr;
      }
    }

    emit('toast', `Pozvánka ${inv.code} byla smazána`, '✓');
    await loadInvites();
  } catch (err) {
    alert(err.message || 'Smazání pozvánky selhalo');
  }
}

async function toggleRole(prof) {
  const nextRole = prof.role === 'admin' ? 'employee' : 'admin';
  const roleName = nextRole === 'admin' ? 'Správce' : 'Zaměstnanec';
  if (!confirm(`Opravdu změnit roli uživatele ${prof.username} na "${roleName}"?`)) return;

  try {
    await supabaseRequest('/rest/v1/rpc/admin_change_user_role', {
      method: 'POST',
      body: JSON.stringify({
        p_target_user_key: prof.user_key,
        p_new_role: nextRole
      })
    }, props.currentUser);

    emit('toast', `Role uživatele ${prof.username} změněna`, '✓');
    await loadProfiles();
  } catch (err) {
    alert(err.message || 'Změna role se nezdařila');
  }
}

async function deleteUser(prof) {
  if (!confirm(`OPRAVDU SMAZAT uživatele ${prof.username} (${prof.display_name}) a veškerou jeho docházku? Tuto akci nelze vrátit.`)) return;

  try {
    await supabaseRequest('/rest/v1/rpc/admin_delete_user', {
      method: 'POST',
      body: JSON.stringify({ p_target_user_key: prof.user_key })
    }, props.currentUser);

    emit('toast', `Uživatel ${prof.username} byl smazán`, '✓');
    await loadProfiles();
    await loadSummaries();
  } catch (err) {
    alert(err.message || 'Smazání uživatele selhalo');
  }
}

defineExpose({ refreshData });
</script>

