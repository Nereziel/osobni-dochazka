export function extractInviteCode(locationLike = {}) {
  const parse = (raw) => {
    const value = String(raw || '').trim().toUpperCase();
    return /^INV-[A-Z0-9]+$/.test(value) ? value : '';
  };

  const hash = String(locationLike.hash || '').replace(/^#/, '');
  const hashParams = new URLSearchParams(hash);
  const fromHash = parse(hashParams.get('invite'));
  if (fromHash) return fromHash;

  const search = String(locationLike.search || '').replace(/^\?/, '');
  const searchParams = new URLSearchParams(search);
  return parse(searchParams.get('invite'));
}

export function sanitizeSpreadsheetCell(value) {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}
