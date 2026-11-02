import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./TeamView.vue', import.meta.url), 'utf8');

describe('TeamView admin step-up UI', () => {
  it('does not collect admin credentials through a plaintext browser prompt', () => {
    expect(source).not.toMatch(/\bprompt\s*\(/);
  });

  it('uses the masked AdminStepUpModal for privileged role and delete actions', () => {
    expect(source).toContain('AdminStepUpModal');
    expect(source).toContain('stepUpModalRef');
  });
});
