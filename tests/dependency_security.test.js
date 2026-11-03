import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const lock = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'package-lock.json'), 'utf8')
);

function versionTuple(version) {
  return String(version || '')
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function isAtLeast(version, minimum) {
  const a = versionTuple(version);
  const b = versionTuple(minimum);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

describe('Dependency security', () => {
  it('does not lock the vulnerable minimatch used by ESLint and Glob', () => {
    const affectedToolchainPaths = [
      'node_modules/eslint/node_modules/minimatch',
      'node_modules/@eslint/config-array/node_modules/minimatch',
      'node_modules/glob/node_modules/minimatch'
    ];

    for (const location of affectedToolchainPaths) {
      const minimatch = lock.packages?.[location];
      expect(minimatch, `${location} must be present`).toBeTruthy();
      expect(isAtLeast(minimatch.version, '11.0.1'), `${location} is ${minimatch?.version}`).toBe(true);
    }
  });
});
