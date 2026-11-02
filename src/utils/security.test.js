import { describe, expect, it } from 'vitest';
import { extractInviteCode, sanitizeSpreadsheetCell } from './security.js';

describe('extractInviteCode', () => {
  it('prefers a fragment invite so the token is not sent in the HTTP request', () => {
    expect(extractInviteCode({ search: '', hash: '#invite=INV-ABC123' })).toBe('INV-ABC123');
  });

  it('supports legacy query invite links for backward compatibility', () => {
    expect(extractInviteCode({ search: '?invite=INV-OLD123', hash: '' })).toBe('INV-OLD123');
  });

  it('rejects malformed invite values', () => {
    expect(extractInviteCode({ search: '', hash: '#invite=javascript:alert(1)' })).toBe('');
  });
});

describe('sanitizeSpreadsheetCell', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-1+2', '@SUM(A1:A2)', '\t=1+1', '\r=1+1'])(
    'neutralizes spreadsheet formula input %s',
    (value) => {
      expect(sanitizeSpreadsheetCell(value).startsWith("'")).toBe(true);
    }
  );

  it('leaves ordinary text unchanged', () => {
    expect(sanitizeSpreadsheetCell('běžná poznámka')).toBe('běžná poznámka');
  });
});
