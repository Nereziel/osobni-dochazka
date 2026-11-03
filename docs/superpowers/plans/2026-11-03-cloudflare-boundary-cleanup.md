# Cloudflare Boundary Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove legacy browser-side Supabase configuration and tighten the existing Cloudflare Pages boundary without adding application features.

**Architecture:** Vue keeps one same-origin API transport and no longer knows Supabase connection details. Cloudflare Pages Functions owns the Supabase URL/publishable key, cookie credential, route allowlist and upstream headers. Workbox continues to precache static assets while explicitly excluding `/api/*` from navigation fallback.

**Tech Stack:** Vue 3, Vite 8, vite-plugin-pwa/Workbox, Cloudflare Pages Functions, Supabase PostgREST/RPC, Vitest, ESLint.

**Spec:** `docs/superpowers/specs/2026-11-03-cloudflare-boundary-cleanup-design.md`

## Global Constraints

- No new user-facing functionality or API operations.
- Keep the custom attendance session/RLS/RPC/admin/rate-limit/audit model unchanged.
- Use only the Supabase publishable key; do not introduce a secret/service-role key.
- Keep browser network access same-origin only.
- Keep `/api/*` outside static Pages Function routing/cache fallbacks except the explicit Function route.

## Review Focus

- Legacy browser config accidentally remains reachable through Settings or storage.
- Preview works while production fails because runtime variables differ.
- A route/method combination becomes broader than the current allowlist.
- PWA navigation fallback serves `index.html` for an `/api/*` URL.
- Logout/PIN-change/login cookie behavior regresses during gateway refactor.

---

### Task 1: Lock the cleanup requirements with failing tests

**Files:**
- Modify: `tests/auth_security.test.js`
- Modify: `tests/pages_functions.test.js`

**Interfaces:**
- Consumes: current browser client and Pages handler.
- Produces: regression assertions for Tasks 2–4.

- [ ] Add assertions that browser source and `.env.example` contain no `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, manual Supabase config storage, or manual credential UI.
- [ ] Add handler tests requiring `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`, rejecting legacy-only env, rejecting unsupported method/path combinations, and preserving login/session/logout behavior.
- [ ] Add an assertion that Vite PWA config explicitly denies `/api/*` navigation fallback.
- [ ] Run CI and confirm the new tests fail for the intended legacy behavior.

### Task 2: Remove browser-side Supabase configuration

**Files:**
- Modify: `src/services/supabase.js`
- Modify: `src/composables/useAuth.js`
- Modify: `src/App.vue`
- Modify: `src/views/SettingsView.vue`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces: `supabaseRequest(path, options)` as the only frontend Supabase-related interface.

- [ ] Remove config getter/setter and `isSupabaseConfigured()` from `src/services/supabase.js`.
- [ ] Remove all configuration guards from auth/startup code; network failures remain handled by existing error paths.
- [ ] Delete the dead manual URL/key form and related state/functions from Settings.
- [ ] Change “Hostováno” to Cloudflare Pages and describe the architecture as IndexedDB + Cloudflare + Supabase.
- [ ] Change `.env.example`/README to server runtime variable names and keep browser-only `VITE_SYNC_INTERVAL_MS` separate.
- [ ] Run the focused tests and full suite.

### Task 3: Tighten the Pages gateway contract

**Files:**
- Modify: `functions/api/supabase/[[path]].js`
- Modify: `tests/pages_functions.test.js`

**Interfaces:**
- Consumes: `context.env.SUPABASE_URL`, `context.env.SUPABASE_PUBLISHABLE_KEY`.
- Produces: same responses/cookies/upstream requests as the current gateway for the existing route surface.

- [ ] Replace separate route sets with one explicit route registry keyed by method/path and metadata (`requiresAuth`, token-issuing behavior).
- [ ] Remove all `VITE_*` and `SUPABASE_ANON_KEY` environment fallbacks.
- [ ] Keep same-origin CSRF checks, IP forwarding, no-store responses, cookie sanitization and logout clearing unchanged.
- [ ] Run focused gateway tests and the full suite.

### Task 4: Make the PWA API exclusion explicit

**Files:**
- Modify: `vite.config.js`
- Modify: `tests/auth_security.test.js`

**Interfaces:**
- Produces: Workbox configuration that never applies SPA navigation fallback to `/api/*`.

- [ ] Add `navigateFallbackDenylist` matching `/api/` while retaining the existing static precache configuration.
- [ ] Run tests and production build; inspect generated service worker for the denylist/no API precache behavior.

### Task 5: Update Cloudflare runtime variables and verify

**Cloudflare configuration:**
- Production and preview: add `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` with the existing values.
- Remove `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` after preview verification.

- [ ] Add the new variables first so preview can test the strict code contract.
- [ ] Deploy/verify preview branch.
- [ ] Remove the legacy variables from preview and production once the new variable names are confirmed.
- [ ] Run GitHub CI: lint, all unit tests, production build, production dependency audit, database-security suite.
- [ ] Review the final diff for legacy session/config references and open a PR without merging it automatically.
