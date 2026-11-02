import { createApp } from 'vue';
import App from './App.vue';
import './styles/main.css';
import { extractInviteCode } from './utils/security.js';

const inviteCode = typeof window !== 'undefined' ? extractInviteCode(window.location) : '';

// Invite links use #invite=... so the secret is never sent in the initial HTTP request.
// App.vue currently consumes the legacy ?invite=... shape, so expose it only locally
// through history.replaceState and remove it again as soon as the dialog opens.
if (inviteCode && typeof window !== 'undefined') {
  const localUrl = new URL(window.location.href);
  localUrl.hash = '';
  localUrl.searchParams.set('invite', inviteCode);
  window.history.replaceState({}, document.title, `${localUrl.pathname}${localUrl.search}`);
}

const app = createApp(App);
app.mount('#app');

if (inviteCode && typeof window !== 'undefined') {
  let attempts = 0;
  const cleanupInviteFromAddressBar = () => {
    attempts += 1;
    const dialogOpened = Boolean(document.querySelector('dialog[open]'));
    if (!dialogOpened && attempts < 100) return false;

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('invite');
    cleanUrl.hash = '';
    window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    return true;
  };

  const timer = window.setInterval(() => {
    if (cleanupInviteFromAddressBar()) {
      window.clearInterval(timer);
    }
  }, 50);
}
