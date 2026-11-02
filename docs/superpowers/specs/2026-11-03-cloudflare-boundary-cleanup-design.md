# Cloudflare Boundary Cleanup Design

## Intent

Simplify the already-deployed Cloudflare session boundary without adding user-facing functionality. The browser should know only the same-origin `/api/supabase/*` boundary; Supabase URL/key configuration belongs to Cloudflare Pages Functions.

## Goals

- Remove browser-side Supabase URL/key configuration and its dead settings UI.
- Remove `isSupabaseConfigured()` branching from Vue because the browser boundary is always same-origin.
- Rename Cloudflare runtime bindings to `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` and stop accepting legacy `VITE_*`/`ANON` fallbacks.
- Keep the existing custom attendance session, RLS, RPCs, admin step-up, rate limiting and audit behavior unchanged.
- Make the Pages gateway allowlist easier to audit using one explicit route registry.
- Make PWA behavior explicitly exclude `/api/*` from navigation fallback/caching behavior.
- Update documentation and the Settings “O aplikaci” card to describe Cloudflare Pages accurately.

## Non-goals

- No new API operations, screens or attendance behavior.
- No Supabase schema or migration changes.
- No move to Supabase Auth.
- No service-role/secret Supabase key.
- No change to offline attendance semantics.

## Approaches considered

1. **Minimal cleanup only:** delete dead frontend configuration but leave gateway/env compatibility aliases. Lowest risk, but preserves misleading legacy names and future regression paths.
2. **Boundary cleanup with strict runtime contract — chosen:** delete browser config, require server-only `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`, use one route registry, and explicitly keep `/api/*` outside PWA fallback. This removes ambiguity without changing behavior.
3. **Full bespoke endpoint rewrite:** replace `/api/supabase/*` with many domain-specific endpoints. Cleaner long-term API, but unnecessarily large for a no-new-functionality cleanup.

## Browser boundary

`src/services/supabase.js` remains the single same-origin transport helper. It no longer exposes configuration getters/setters or a fake “configured” state. Vue auth and startup code call the boundary directly.

## Cloudflare boundary

The Function accepts only the already-supported combinations of HTTP method + PostgREST/RPC path. Each route entry declares whether it requires the HttpOnly attendance cookie and whether it can issue/replace that cookie. Unknown paths or methods remain rejected before reaching Supabase.

The Function requires these Pages variables in both preview and production:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

The publishable key remains low-privilege and is used only by the Function to reach PostgREST; no privileged Supabase credential is introduced.

## PWA

Static assets remain precached. `/api/*` is explicitly excluded from navigation fallback. API responses continue to carry `Cache-Control: no-store` and are not added to Workbox runtime caches.

## Verification

Regression tests must prove:

- no browser source contains Supabase URL/key configuration or legacy config storage;
- Settings has no manual Supabase credentials form;
- gateway does not accept legacy `VITE_SUPABASE_*` variables;
- supported gateway routes still work and unsupported routes/methods are rejected;
- `/api/*` is excluded from PWA navigation fallback;
- lint, unit tests, production build, npm production audit and existing database-security CI remain green.
