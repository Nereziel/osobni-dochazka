# Cloudflare Session Migration Plan

Goal: move the attendance session credential from browser JavaScript into a same-origin Cloudflare Pages Function cookie boundary while preserving the existing database auth model.

## Tasks

- Add regression tests proving browser code no longer stores or forwards the session credential and that API traffic is same-origin.
- Add a Pages Function gateway for the currently used REST/RPC operations, with strict route and method allowlists and same-origin checks.
- On login, registration and PIN change, move the returned session credential into an HttpOnly Secure SameSite=Strict host cookie and remove it from JSON sent to the browser.
- On authenticated requests, inject the cookie credential into the upstream attendance-session header.
- On logout, revoke the server session and clear the cookie.
- Update Vue auth state to persist only non-secret profile metadata.
- Restrict Pages Functions routing to `/api/*` and browser CSP connections to same-origin.
- Run lint, unit tests and production build in CI before merging.
