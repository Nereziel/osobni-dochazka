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
  it('does not lock a vulnerable minimatch release', () => {
    const minimatchEntries = Object.entries(lock.packages || {})
      .filter(([location]) => location === 'node_modules/minimatch' || location.endsWith('/node_modules/minimatch'));

    expect(minimatchEntries.length).toBeGreaterThan(0);
    for (const [location, pkg] of minimatchEntries) {
      expect(isAtLeast(pkg.version, '11.0.1'), `${location} is ${pkg.version}`).toBe(true);
    }
  });
});
