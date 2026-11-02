# Weekly Repository Security Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a weekly/manual GitHub-native repository security scan using CodeQL, npm audit, tracked-file hygiene checks, and the existing Supabase security regression suite.

**Architecture:** Keep `.github/workflows/ci.yml` unchanged. Add a separate `.github/workflows/security.yml` with independent least-privilege jobs. Repository hygiene is implemented by a small Node module so it can be regression-tested by Vitest and reused from Actions.

**Tech Stack:** GitHub Actions, CodeQL Action v4, Node.js 24, npm/Vitest, PostgreSQL 17.

**Spec:** `docs/superpowers/specs/2026-11-02-weekly-security-scan-design.md`

## Global Constraints

- Scheduled weekly + manual runs only.
- No third-party scanner actions.
- Pin actions to immutable commit SHAs; Dependabot maintains them.
- Do not alter existing required PR checks.
- Database migration order must match `.github/workflows/ci.yml` exactly.

## Review Focus

- `.env.example` must not be reported as a secret while real `.env` files must fail.
- private key/certificate/database dump filenames must fail regardless of directory.
- ordinary source/assets must not produce false positives.
- CodeQL must analyze `javascript-typescript` and upload SARIF with `security-events: write` only in its job.
- database scan must apply all current migrations, including `20261102_admin_audit_read.sql`, before running `supabase/tests/security.sql`.

---

### Task 1: Tracked sensitive-file guard

**Files:**
- Create: `scripts/check-sensitive-files.mjs`
- Create: `tests/security-files.test.js`

**Interfaces:**
- Produces: `findSensitiveTrackedFiles(paths: string[]): string[]`
- CLI: reads `git ls-files`, exits non-zero and prints offenders when any are found.

- [ ] Write Vitest cases for safe `.env.example`, unsafe `.env`/`.env.local`, private keys/certs, SQL/dump files under `backups/`, and ordinary source files.
- [ ] Run `npm test -- tests/security-files.test.js` and confirm failure because the module does not exist.
- [ ] Implement the matcher and CLI without external packages.
- [ ] Re-run the focused test and confirm PASS.

### Task 2: Weekly security workflow

**Files:**
- Create: `.github/workflows/security.yml`

**Interfaces:**
- Consumes: `node scripts/check-sensitive-files.mjs` and existing `supabase/tests/security.sql`.
- Produces: Actions jobs `Repository hygiene`, `Dependency audit`, `CodeQL`, and `Database security scan`.

- [ ] Add `schedule` for Mondays and `workflow_dispatch`.
- [ ] Add repository-hygiene and full `npm audit --audit-level=high` jobs using Node 24.
- [ ] Add CodeQL `javascript-typescript` job using pinned `github/codeql-action` v4 commit and `security-extended` queries.
- [ ] Add PostgreSQL 17 database job reproducing current migration/test order from `ci.yml`.
- [ ] Keep default workflow permissions read-only; elevate only CodeQL job to `security-events: write`.

### Task 3: Documentation and verification

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] Document weekly/manual security scan and where findings appear.
- [ ] Run/verify normal PR CI remains green.
- [ ] Review PR diff for permissions, action pinning, and false-positive patterns.
- [ ] Merge after required checks pass.
- [ ] Manually dispatch `Security` workflow on `main` and verify every job succeeds; inspect CodeQL result/alerts.
