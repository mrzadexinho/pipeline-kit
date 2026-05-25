# OpenSSF Scorecard — Baseline (M12 close, 2026-05-25)

**Score:** 4.3 / 10
**Source:** https://scorecard.dev/viewer/?uri=github.com/mrzadexinho/pipeline-kit
**API:** https://api.securityscorecards.dev/projects/github.com/mrzadexinho/pipeline-kit
**Scorecard version:** v5.3.0
**Scan commit:** 5fdc1ddc6b08a556b38361180c786089a2d3e5c8

## Per-check breakdown (at M12 close)

| Check | Score | Notes |
|-------|-------|-------|
| Pinned-Dependencies | 9 | SHA-pinned GHA actions; 1 gap in oidc-token-debug.yml (actions/github-script uses tag, not SHA) |
| Packaging | 10 | npm publish detectable via release.yml |
| License | 10 | MIT license in repo |
| Dangerous-Workflow | 10 | No untrusted input in run: steps |
| Binary-Artifacts | 10 | No committed binaries |
| Fuzzing | 10 | TypeScriptPropertyBasedTesting (fast-check) detected in 25+ test files |
| Dependency-Update-Tool | 10 | Dependabot configured (.github/dependabot.yml) |
| SAST | 0 | No SAST tool running on all commits — CodeQL added in M13 U2 (projected: 10) |
| Token-Permissions | 0 | ci.yml missing top-level permissions; release.yml has top-level contents:write — hardening in M13 U2 (projected: 9+) |
| Code-Review | 0 | 0/27 approved changesets — branch protection intentionally deferred (separate user session) |
| Maintained | 0 | Repository created within 90 days — will rise organically with activity |
| Signed-Releases | -1 | No GitHub Releases found — Scorecard checks git-tag signing; npm/PyPI sigstore provenance (ADR M11-1) not equivalent in Scorecard's model |
| Branch-Protection | 0 | Branch protection not enabled for master — deferred to separate user session |
| CII-Best-Practices | 0 | No OpenSSF best practices badge detected |
| Security-Policy | 0 | No SECURITY.md detected |
| Vulnerabilities | 0 | 15 known vulnerabilities detected (GHSA IDs listed below) |
| CI-Tests | 0 | 0/3 merged PRs checked by CI test (Scorecard only looks at merged PRs, not direct pushes) |
| Contributors | 0 | 0 contributing companies/organizations |

### Vulnerabilities detail (15 open at M12 close)

GHSA-jggg-4jg4-v7c6, GHSA-2pr8-phx7-x9h3, GHSA-66ff-xgx4-vchm, GHSA-685m-2w69-288q,
GHSA-75px-5xx7-5xc7, GHSA-fx83-v9x8-x52w, GHSA-jvwf-75h9-cwgg, GHSA-q6x5-8v7m-xcrf,
GHSA-q8mj-m7cp-5q26, GHSA-2mjp-6q6p-2qxm, GHSA-4992-7rv2-5pvq, GHSA-g9mf-h72j-4rw9,
GHSA-v9p9-hfj2-hcw8, GHSA-vrm6-8vpv-qv8q, GHSA-w5hq-g745-h8pq

These are surfaced from transitive dependency graph. U5 Dependabot merges (M13) will address most.

## Post-M13 projection

| Change | Score delta |
|--------|-------------|
| SAST fix: CodeQL on every PR (M13 U2) | 0 → 10 |
| Token-Permissions fix: job-level perms (M13 U2) | 0 → 9+ |
| **Expected range** | **5.5–6.5 / 10** |

## Intentionally deferred zeros

- **Code-Review (0):** requires branch protection rules. Deferred to separate user session.
- **Maintained (0):** purely activity-heuristic (repo < 90 days old). No action needed — score rises organically.
- **Signed-Releases (-1):** Scorecard looks for GPG/SSH-signed git tags on GitHub Releases.
  npm/PyPI sigstore provenance attestations (ADR M11-1) are not equivalent in Scorecard's model.
  Creating GitHub Releases for every npm publish is not a priority vs. other checks.
- **Branch-Protection (0):** master has no protection rules. Deferred to separate user session.
- **CII-Best-Practices (0):** OpenSSF badge not pursued at this stage.
- **Security-Policy (0):** SECURITY.md not added. Low priority vs. functional checks.
- **CI-Tests (0):** Scorecard only counts CI on merged PRs (not direct pushes to master). Will
  improve naturally as Dependabot PRs are merged through CI.
- **Contributors (0):** single-maintainer project; not actionable.

## Re-capture trigger

Re-run after CodeQL first run lands + Token-Permissions weekly Scorecard cycle completes (~7 days
from M13 merge). Expected rescan date: ~2026-06-01.
