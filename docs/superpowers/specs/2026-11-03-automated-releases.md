# Automated Release Versioning Design

## Intent

Automate semantic versioning and GitHub releases for `osobni-dochazka` without changing application runtime behavior.

## Decisions

- Use Release Please in manifest mode.
- Treat the current application version `3.1.3` as the release baseline.
- Bootstrap history from main commit `1cebb3d90c854632c5ccff6f009de202cc7d9e23` so older commits are not released again.
- Use Conventional Commit semantics: `fix:` = patch, `feat:` = minor, `!` / `BREAKING CHANGE` = major.
- Release Please maintains the release PR, `CHANGELOG.md`, `package.json`, `package-lock.json`, git tag, and GitHub Release.
- The workflow runs only on pushes to `main` (plus manual dispatch) and does not deploy the application itself; Cloudflare remains the deployment system.
- Pin the Release Please action to the immutable commit for `v5.0.0`.

## Non-goals

- No npm publication.
- No automatic merge of release PRs.
- No GitHub Pages deployment.
- No application feature or runtime change.
