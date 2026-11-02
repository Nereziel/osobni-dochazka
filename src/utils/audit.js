const ACTION_LABELS = {
  admin_change_user_role: 'Změna role uživatele',
  admin_reset_user_pin: 'Reset PINu uživatele',
  admin_delete_user: 'Smazání uživatele',
  admin_create_invite: 'Vytvoření pozvánky',
  admin_delete_invite: 'Smazání pozvánky',
  admin_step_up: 'Ověření správce'
};

function stripUserPrefix(value) {
  const text = String(value || '').trim();
  return text.startsWith('user:') ? text.slice(5) : text;
}

function roleLabel(role) {
  if (role === 'admin') return 'Správce';
  if (role === 'employee') return 'Zaměstnanec';
  return String(role || '').trim();
}

export function auditActionLabel(action) {
  const value = String(action || '').trim();
  if (!value) return 'Neznámá událost';
  return ACTION_LABELS[value] || value.replaceAll('_', ' ');
}

export function auditActorLabel(entry = {}) {
  return entry.actor_display_name
    || entry.actor_username
    || stripUserPrefix(entry.actor_user_key)
    || 'Systém';
}

export function auditTargetLabel(entry = {}) {
  return entry.target_display_name
    || entry.target_username
    || stripUserPrefix(entry.target_user_key)
    || '—';
}

export function auditDetailLabel(entry = {}) {
  const details = entry.details && typeof entry.details === 'object' ? entry.details : {};

  if (entry.action === 'admin_change_user_role' && (details.from || details.to)) {
    return `${roleLabel(details.from) || '—'} → ${roleLabel(details.to) || '—'}`;
  }

  if (entry.action === 'admin_create_invite' && details.expires_at) {
    const date = new Date(details.expires_at);
    if (!Number.isNaN(date.getTime())) {
      return `Platnost do ${date.toLocaleString('cs-CZ')}`;
    }
  }

  if (entry.action === 'admin_delete_user' && details.role) {
    return `Role: ${roleLabel(details.role)}`;
  }

  return '';
}
