# Weekly Repository Security Scan Design

**Intent:** Add an independent, recurring security check for `Nereziel/osobni-dochazka` without changing the existing PR merge CI.

**Goals:**
- run automatically once per week and support manual runs,
- analyze Vue/JavaScript code with GitHub CodeQL,
- audit all npm dependencies, including development/build dependencies,
- run the existing PostgreSQL/Supabase security regression suite,
- fail if obviously sensitive local/config files are accidentally tracked,
- keep findings visible in GitHub Actions and Code Scanning where supported.

**Non-goals:**
- no third-party scanners or external SaaS,
- no production penetration testing,
- no automatic mutation of Supabase/Cloudflare resources,
- do not make the scheduled workflow a required merge check.

**Constraints:**
- use GitHub-hosted runners,
- pin GitHub Actions to immutable commit SHAs; Dependabot already updates GitHub Actions weekly,
- minimum permissions; CodeQL job gets `security-events: write`, other jobs remain read-only,
- reuse the same migration order and `supabase/tests/security.sql` runner as normal CI.

## Approaches

1. **GitHub-native workflow — selected.** CodeQL + npm audit + repository hygiene + existing database tests. Best fit because the repository is public, GitHub Code Scanning is available for public repositories, and no additional vendor/action trust is introduced.
2. **Lightweight workflow.** npm audit + DB tests only. Rejected because it misses source-level vulnerability analysis.
3. **Extended third-party scanning.** Add tools such as Trivy/Gitleaks. Rejected for now because it adds supply-chain dependencies and complexity disproportionate to this repository.

## Schedule and output

Create `.github/workflows/security.yml` with `schedule` (Monday weekly) and `workflow_dispatch`. CodeQL uploads findings to GitHub Code Scanning. Dependency/database/repository-hygiene failures remain visible as failed Actions jobs.

## Repository hygiene check

Use a small repository-owned Node script rather than a third-party action. It inspects tracked filenames from Git and fails for high-risk patterns such as `.env`, private keys/certificates, database dumps/backups, and common secret export files. Explicit safe templates such as `.env.example` remain allowed.

## Validation

The existing CI continues unchanged. The hygiene script gets unit tests. Database security uses the existing PostgreSQL test runner. After merge, manually dispatch the new workflow on `main` and require all jobs to complete successfully before considering the feature deployed.
