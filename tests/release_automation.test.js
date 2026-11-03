import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = (relativePath) => path.resolve(root, relativePath);
const read = (relativePath) => fs.readFileSync(file(relativePath), 'utf8');

describe('Automated releases', () => {
  it('keeps the release manifest aligned after the 3.1.3 bootstrap', () => {
    expect(fs.existsSync(file('release-please-config.json'))).toBe(true);
    expect(fs.existsSync(file('.release-please-manifest.json'))).toBe(true);

    if (!fs.existsSync(file('release-please-config.json')) || !fs.existsSync(file('.release-please-manifest.json'))) {
      return;
    }

    const config = JSON.parse(read('release-please-config.json'));
    const manifest = JSON.parse(read('.release-please-manifest.json'));
    const pkg = JSON.parse(read('package.json'));

    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest['.']).toBe(pkg.version);
    expect(config['bootstrap-sha']).toBe('1cebb3d90c854632c5ccff6f009de202cc7d9e23');
    expect(config.packages?.['.']?.['release-type']).toBe('node');
    expect(config.packages?.['.']?.['package-name']).toBe('osobni-dochazka');
  });

  it('runs a pinned Release Please action only for the main release flow', () => {
    const workflowPath = '.github/workflows/release-please.yml';
    expect(fs.existsSync(file(workflowPath))).toBe(true);

    if (!fs.existsSync(file(workflowPath))) return;

    const workflow = read(workflowPath);

    expect(workflow).toContain('branches:\n      - main');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('issues: write');
    expect(workflow).toContain('pull-requests: write');
    expect(workflow).toContain('googleapis/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7');
    expect(workflow).toContain('config-file: release-please-config.json');
    expect(workflow).toContain('manifest-file: .release-please-manifest.json');
    expect(workflow).not.toContain('deploy-pages');
    expect(workflow).not.toContain('npm publish');
  });
});
