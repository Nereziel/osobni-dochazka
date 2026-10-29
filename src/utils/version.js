export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '3.1.0';
export const APP_BUILD_DATE = typeof __APP_BUILD_DATE__ !== 'undefined' ? __APP_BUILD_DATE__ : '2026-10-29';

export const VERSION_HISTORY = [
  {
    version: '3.1.0',
    date: '2026-10-29',
    changes: [
      'Možnost úpravy vlastního celého jména (zobrazovaného na výkazu) v nastavení profilu',
      'Možnost mazání pozvánek správcem týmu (RPC admin_delete_invite)',
      'Automatická detekce prázdné databáze s přímým otevřením registrace prvního správce',
      'Oprava zobrazení počtu evidovaných dnů a dovolené v měsíčním přehledu týmu',
      'Výpočet předpokládaného času odchodu podle skutečného denního a víkendového fondu',
      'Přidáno automatické verzování a přehled změn (Changelog)'
    ]
  },
  {
    version: '3.0.0',
    date: '2026-10-26',
    changes: [
      'Nová architektura postavená na Vue 3 + Vite + PWA Offline-First',
      'Vlastní bezpečný session systém s Bcrypt hashováním PINu a ochranou proti brute-force',
      'Invite-Only registrace (první uživatel = správce, ostatní přes jednorázovou pozvánku)',
      'Atomická Last-Write-Wins (LWW) synchronizace a podpora mazání přes tombstones',
      'Per-user izolace dat v IndexedDB a 10s synchronizace v popředí'
    ]
  }
];

