# Dependency Upgrade Policy

This document defines the cadence for routine dependency upgrades and the
response-time targets ("SLA") for security patches. It is the policy
referenced by [Improvement.md](../Improvement.md) P1.6 step 6, closing out
the last item of that section (steps 1-5 — Dependabot grouping, Node 24/26,
Electron 37→43, React 19.2, Express 5 — are already implemented; see that
file for details).

## Scope

Applies to all npm dependencies across the monorepo's workspaces (single
root `package-lock.json`) plus the base OS images used by the three
Dockerfiles (`bruno-server`, `bruno-cli` debian/alpine variants).

## Routine upgrades: quarterly window

Non-security dependency upgrades (minor/patch bumps that Dependabot opens
PRs for automatically, and any deliberate major-version bump such as the
Electron/React/Express work already done) are batched into a **quarterly
upgrade window**, one calendar week per quarter:

| Quarter | Window |
|---|---|
| Q1 | Second full week of January |
| Q2 | Second full week of April |
| Q3 | Second full week of July |
| Q4 | Second full week of October |

During the window:

1. Review and merge accumulated Dependabot PRs, grouped by the same three
   risk buckets already defined in `.github/dependabot.yml`
   (`runtime` → `ui-libraries` → `build-tooling`, in that order — lowest
   blast-radius group last so a bad merge earlier in the week has more time
   to surface before the week closes).
2. For any major-version bump not already covered by a grouped PR (e.g. a
   new Electron or Node LTS major), follow the same per-major,
   own-commit-with-its-own-smoke-test pattern used for the Electron
   37→43 and Express 5 migrations in P1.6 steps 3 and 5 — never bump
   `runtime` and `ui-libraries` majors in the same commit.
3. Run the full monorepo test suite (`npm test --workspaces --if-present`)
   and the `browser-bridge` Playwright suite before merging anything from
   the window into `main`.
4. Update `engines.node` / Dockerfile base images only as a deliberate,
   separately-documented step (as step 2 did for Node 24), not as a
   side-effect of an unrelated bump.

Outside the window, Dependabot PRs may still be opened and reviewed, but
merges are deferred to the next window unless they qualify as a security
patch (below).

## Security patches: SLA by severity

Security advisories are triaged by CVSS/GHSA severity as reported by
`npm audit` / Dependabot security alerts, independent of the quarterly
window:

| Severity | Target time to patch merged on `main` |
|---|---|
| Critical | 48 hours from advisory publication |
| High | 7 calendar days |
| Moderate | Next quarterly window (or sooner if it can ride along with an unrelated change touching the same package) |
| Low | Next quarterly window |

Rules for Critical/High patches:

- They are handled as a standalone commit/PR, not folded into quarterly
  window batching — the goal is the smallest possible diff that resolves
  the advisory, even if that means pinning a single transitive dependency
  via `overrides` (the same mechanism already used for `axios`/`rollup`/
  `pbkdf2`/`react`/`react-dom` in this repo) rather than waiting for an
  upstream major bump.
- The full monorepo test suite must still pass before merging — the SLA
  clock is about triage-to-merge speed, not about skipping verification.
- If a Critical/High advisory has no available fix upstream within the SLA
  window, the mitigation (e.g. disabling an affected code path, adding a
  runtime guard) is documented in `find bug and Improvement.md` as an
  interim measure until a real patch lands.

## Non-goals

This policy governs cadence and response time, not which specific versions
to target — that remains a per-upgrade decision made when the window (or
advisory) is reached, following the existing "upgrade one risk bucket at a
time, in its own commit" principle already established in P1.6.
