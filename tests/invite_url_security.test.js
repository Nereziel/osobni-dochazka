import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.vue'), 'utf8');

describe('Invite URL security boundary', () => {
  it('never lets the URL invite value choose the registration flow', () => {
    const mountedStart = appSource.indexOf('onMounted(async () => {');
    const mountedEnd = appSource.indexOf('onUnmounted(', mountedStart);
    const mountedSource = appSource.slice(mountedStart, mountedEnd);

    expect(mountedSource).not.toContain('if (inviteParam)');
    expect(mountedSource).not.toContain('openRegisterModal(inviteParam');
    expect(mountedSource).toContain('pendingInviteCode.value = readInviteCodeFromLocation()');
    expect(mountedSource).toContain('await openLoginModal()');
  });

  it('treats URL invite input only as normalized prefill data', () => {
    expect(appSource).toContain("const INVITE_CODE_PATTERN = /^INV-[A-Z0-9]{6,64}$/;");
    expect(appSource).toContain('function normalizeInviteCode(value)');
    expect(appSource).toContain('function readInviteCodeFromLocation()');
    expect(appSource).toContain("hashParams.get('invite')");
    expect(appSource).toContain("url.searchParams.get('invite')");
    expect(appSource).toContain('registerModalRef.value?.open(isFirst, invitePrefill)');
  });
});
