import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const SAFE_ENV_TEMPLATES = new Set([
  '.env.example',
  '.env.sample',
  '.env.template'
]);

function normalizePath(path) {
  return String(path || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function isEnvironmentSecret(path) {
  const name = path.split('/').at(-1)?.toLowerCase() || '';
  if (SAFE_ENV_TEMPLATES.has(name)) return false;
  return name === '.env' || name.startsWith('.env.');
}

function isPrivateKeyOrExport(path) {
  const name = path.split('/').at(-1)?.toLowerCase() || '';
  return name.endsWith('.key')
    || name.endsWith('.pfx')
    || name.endsWith('.p12')
    || name.endsWith('.pem')
    || name === 'id_rsa'
    || name === 'id_ed25519';
}

function isDatabaseBackup(path) {
  const lower = path.toLowerCase();
  const segments = lower.split('/');
  const inBackupDirectory = segments.some((segment) => segment === 'backup' || segment === 'backups');
  const name = segments.at(-1) || '';

  if (name.endsWith('.dump') || name.endsWith('.backup')) return true;
  return inBackupDirectory && (name.endsWith('.sql') || name.endsWith('.dump') || name.endsWith('.backup'));
}

export function findSensitiveTrackedFiles(paths) {
  return paths
    .map(normalizePath)
    .filter(Boolean)
    .filter((path) => isEnvironmentSecret(path) || isPrivateKeyOrExport(path) || isDatabaseBackup(path));
}

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return output.split('\0').filter(Boolean);
}

function main() {
  const offenders = findSensitiveTrackedFiles(trackedFiles());
  if (offenders.length === 0) {
    console.log('Tracked sensitive-file check passed.');
    return;
  }

  console.error('Potentially sensitive tracked files detected:');
  for (const path of offenders) console.error(`- ${path}`);
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main();
}
