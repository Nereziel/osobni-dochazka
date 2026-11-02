import { describe, expect, it } from 'vitest';
import { findSensitiveTrackedFiles } from '../scripts/check-sensitive-files.mjs';

describe('findSensitiveTrackedFiles', () => {
  it('allows safe environment templates and ordinary source files', () => {
    expect(findSensitiveTrackedFiles([
      '.env.example',
      'src/App.vue',
      'public/icon.svg',
      'docs/BACKUP_RECOVERY.md'
    ])).toEqual([]);
  });

  it('rejects tracked environment files containing real configuration', () => {
    expect(findSensitiveTrackedFiles([
      '.env',
      '.env.local',
      'config/.env.production'
    ])).toEqual([
      '.env',
      '.env.local',
      'config/.env.production'
    ]);
  });

  it('rejects private keys, certificates and PKCS exports', () => {
    expect(findSensitiveTrackedFiles([
      'secrets/server.key',
      'certs/client.pfx',
      'certs/client.p12',
      'certs/private.pem'
    ])).toEqual([
      'secrets/server.key',
      'certs/client.pfx',
      'certs/client.p12',
      'certs/private.pem'
    ]);
  });

  it('rejects database dumps and files under backup directories', () => {
    expect(findSensitiveTrackedFiles([
      'backups/20261102/data.sql',
      'backup/prod.dump',
      'exports/database.backup',
      'src/schema.sql'
    ])).toEqual([
      'backups/20261102/data.sql',
      'backup/prod.dump',
      'exports/database.backup'
    ]);
  });
});
