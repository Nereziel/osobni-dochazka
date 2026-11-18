import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('CodeQL workflow integrity', () => {
  it('pins init and analyze to the same immutable release commit', () => {
    const workflow = fs.readFileSync(path.resolve('.github/workflows/security.yml'), 'utf8');
    const actions = [...workflow.matchAll(
      /^\s*uses: github\/codeql-action\/(init|analyze)@([a-f0-9]{40}) # v(\d+\.\d+\.\d+)$/gm
    )];
    expect(actions).toHaveLength(2);
    const byName = Object.fromEntries(actions.map(([, name, sha, version]) => [
      name, { sha, version }
    ]));
    expect(Object.keys(byName).sort()).toEqual(['analyze', 'init']);
    expect(byName.analyze).toEqual(byName.init);
  });
});
