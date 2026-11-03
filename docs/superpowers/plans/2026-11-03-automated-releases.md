# Automated Release Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Release Please based SemVer automation starting from version 3.1.3.

**Architecture:** A GitHub Actions workflow runs Release Please on pushes to `main`. Manifest/config files establish the current version and bootstrap commit so only future Conventional Commits affect the next version. A unit regression test pins the intended release configuration and immutable action reference.

**Tech Stack:** GitHub Actions, Release Please v5.0.0, Vitest, npm/Node.js

**Spec:** `docs/superpowers/specs/2026-11-03-automated-releases.md`

## Global Constraints

- Current release baseline is exactly `3.1.3`.
- Bootstrap SHA is exactly `1cebb3d90c854632c5ccff6f009de202cc7d9e23`.
- Release workflow must not deploy to GitHub Pages or publish to npm.
- Release Please action must be pinned to immutable commit `45996ed1f6d02564a971a2fa1b5860e934307cf7` (`v5.0.0`).
- Cloudflare remains the only application deployment system.

## Review Focus

- First run must not include historical commits before the baseline.
- Release workflow must have only the write permissions Release Please needs.
- Release automation must operate on `main` and preserve manual dispatch for recovery.
- Root Node package version and Release Please manifest must start aligned at `3.1.3`.
- No GitHub Pages deployment action may be introduced.

---

### Task 1: Pin release automation contract

**Files:**
- Create: `tests/release_automation.test.js`

**Interfaces:**
- Consumes: repository files and package metadata.
- Produces: regression checks for Task 2 configuration.

- [ ] **Step 1: Write failing tests** asserting the Release Please config, manifest, workflow, baseline version, bootstrap SHA, permissions, and pinned action.
- [ ] **Step 2: Open the PR/run CI and verify the new tests fail because release automation files do not exist.**
- [ ] **Step 3: Commit the RED test.**

### Task 2: Add Release Please configuration

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Create: `.github/workflows/release-please.yml`

**Interfaces:**
- Consumes: the contract from Task 1.
- Produces: automated Release Please PRs/releases from Conventional Commits on `main`.

- [ ] **Step 1: Add manifest-mode config for root package `osobni-dochazka`, release type `node`, baseline `3.1.3`, and bootstrap SHA.**
- [ ] **Step 2: Add GitHub Actions workflow on `push: main` and `workflow_dispatch`, with `contents`, `issues`, and `pull-requests` write permissions.**
- [ ] **Step 3: Pin `googleapis/release-please-action` to `45996ed1f6d02564a971a2fa1b5860e934307cf7`.**
- [ ] **Step 4: Run full CI and verify lint, tests, build, production audit, and database security all pass.**
- [ ] **Step 5: Keep PR unmerged for explicit user merge approval.**
