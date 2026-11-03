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
  it('does not lock minimatch versions affected below 11.0.1', () => {
    const minimatchEntries = Object.entries(lock.packages || {})
      .filter(([location]) => location === 'node_modules/minimatch' || location.endsWith('/node_modules/minimatch'));

    expect(minimatchEntries.length).toBeGreaterThan(0);

    for (const [location, minimatch] of minimatchEntries) {
      expect(isAtLeast(minimatch.version, '11.0.1'), `${location} is ${minimatch?.version}`).toBe(true);
    }
  });

  it('does not lock vulnerable deepmerge 4.2.0 through 4.3.1', () => {
    const vulnerableDeepmerge = Object.entries(lock.packages || {})
      .filter(([location, pkg]) =>
        (location === 'node_modules/deepmerge' || location.endsWith('/node_modules/deepmerge'))
        && pkg?.version
        && isAtLeast(pkg.version, '4.2.0')
        && !isAtLeast(pkg.version, '4.3.2')
      );

    expect(vulnerableDeepmerge, JSON.stringify(vulnerableDeepmerge)).toEqual([]);
  });
});
