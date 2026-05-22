# Trusted Publishing Setup (npm OIDC)

**Trusted Publishing is an OPTIONAL upgrade**, not a publish prerequisite. Provenance
attestations work fine via the existing `NODE_AUTH_TOKEN` + GHA `id-token: write`
path (proven by M7 publish on 2026-05-22 — all 33 packages published with sigstore
provenance without any per-package Trusted Publisher config).

The value of configuring Trusted Publishing is dropping the long-lived `NPM_TOKEN`
secret from GitHub Actions and switching to short-lived OIDC token exchange. This
is the 2025-current best practice for supply-chain security per OpenSSF Scorecard
and the npm team's GA blog (2025-07-31). Configure at your own pace — when all
33 packages have a Trusted Publisher set on npmjs.com, you can remove `NPM_TOKEN`.

**References:**
- [GitHub Changelog: npm trusted publishing with OIDC (GA 2025-07-31)](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc/)
- [npmjs.com Trusted Publishers docs](https://docs.npmjs.com/trusted-publishers)
- [OpenSSF SLSA provenance level 2](https://slsa.dev/spec/v1.0/levels#build-l2)

---

## Prerequisites

- All packages must already exist on npm under the `@idriszade` scope before
  Trusted Publishing can be configured. npmjs.com Trusted Publishers is a
  per-package setting and requires the package record to exist first (a one-time
  bootstrap requirement per npm Trusted Publishers GA docs — Trusted Publishing
  cannot be pre-configured for packages that have never been published).
- Confirm each package is live: `npm view @idriszade/<pkg>` should return
  metadata, not a 404.
- You must be logged into npmjs.com as `mrzadexinho` (or a team member with
  package admin access).

## Per-Package Configuration Steps

Repeat for **every package** in the [Complete Package List](#complete-package-list-post-m7) below:

1. Open `https://www.npmjs.com/package/@idriszade/<pkg>` in your browser.
2. Click **Settings** (top-right of the package page).
3. Scroll to **Trusted Publishers** and click **Add**.
4. Fill in the form fields:

   | Field | Value |
   |-------|-------|
   | Provider | GitHub Actions |
   | Organization or user | `mrzadexinho` |
   | Repository | `pipeline-kit` |
   | Workflow filename | `release.yml` |
   | Environment name | *(leave blank — workflow does not use environments)* |
   | Pin to ref | `refs/heads/master` (use the default; do NOT use `*` — wildcard ref is an attack surface per RF-5) |

5. Click **Add**.
6. Check off the package in the list below.

> **Note on workflow filename:** npmjs.com automatically prepends
> `.github/workflows/` — enter only `release.yml`, not the full path.

## Complete Package List (post-M7)

Configure Trusted Publishing for each package. Tick each as you go.

- [ ] `@idriszade/adapter-inngest`
- [ ] `@idriszade/cli`
- [ ] `@idriszade/core`
- [ ] `@idriszade/cost`
- [ ] `@idriszade/eval`
- [ ] `@idriszade/eval-scorers`
- [ ] `@idriszade/memory`
- [ ] `@idriszade/memory-map`
- [ ] `@idriszade/memory-orchestr8`
- [ ] `@idriszade/memory-sqlite`
- [ ] `@idriszade/observe`
- [ ] `@idriszade/observe-vercel`
- [ ] `@idriszade/process-classify`
- [ ] `@idriszade/process-extract`
- [ ] `@idriszade/process-reviewable`
- [ ] `@idriszade/process-route`
- [ ] `@idriszade/process-validate`
- [ ] `@idriszade/rate-limit-redis`
- [ ] `@idriszade/secrets`
- [ ] `@idriszade/secrets-env`
- [ ] `@idriszade/secrets-oidc`
- [ ] `@idriszade/secrets-sops`
- [ ] `@idriszade/serve-email`
- [ ] `@idriszade/serve-mcp`
- [ ] `@idriszade/serve-slack`
- [ ] `@idriszade/serve-webhook`
- [ ] `@idriszade/source-api`
- [ ] `@idriszade/source-apify`
- [ ] `@idriszade/source-mcp`
- [ ] `@idriszade/source-webhook`
- [ ] `@idriszade/store-pgvector`
- [ ] `@idriszade/store-postgres`
- [ ] `@idriszade/store-sqlite`

33 packages total. All 4 new M7 packages (`rate-limit-redis`, `memory-map`,
`memory-orchestr8`, `memory-sqlite`) are included.

## Verification

After all packages are configured AND the Version-Packages PR merges triggering
a `release.yml` run:

1. **Check GitHub Actions run logs** — look for lines containing:
   - `Provenance generated` or `sigstore attestation` in the publish step output.
   - No `404` or `provenance attestation error` lines.

2. **Verify via npm CLI** — for one or more packages run:
   ```bash
   npm view @idriszade/<pkg> dist.attestations
   ```
   The output should include a sigstore attestation entry (not empty/undefined).

3. **Check npmjs.com package page** — visit
   `https://www.npmjs.com/package/@idriszade/<pkg>` and confirm a provenance
   badge is visible on the package page sidebar.

4. **SLSA level** — `NPM_CONFIG_PROVENANCE: true` produces **SLSA Build Level 2**
   provenance via `sigstore/npm-provenance`. This is the level attested by the
   OpenSSF SLSA docs for GitHub Actions-backed npm publishes.

## Rollback / Failure Modes

**This section applies AFTER you've migrated to Trusted Publishing.** If a future
`release.yml` publish run (with `NPM_TOKEN` removed and Trusted Publishers configured)
fails with an error like:
```
404 / package not configured for Trusted Publishing
```
follow these steps:

1. **Comment out the provenance line** in `.github/workflows/release.yml`:
   ```yaml
   # NPM_CONFIG_PROVENANCE: true
   ```
   Commit and push — this re-enables the legacy `NODE_AUTH_TOKEN` publish path
   immediately (it was never removed; it remains wired as fallback).

2. **Confirm `NODE_AUTH_TOKEN` is still present** — check that
   `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` is still in the `env:` block of
   the `Create Release Pull Request or Publish` step. If it was accidentally
   removed, restore it.

3. **Diagnose via GHA run logs** — common root causes:

   | Symptom | Likely cause |
   |---------|-------------|
   | `404 / not configured` | Package missing from npmjs.com Trusted Publisher list |
   | `ref mismatch` | Ref-pinning on npmjs.com set to something other than `refs/heads/master` |
   | `workflow filename mismatch` | npmjs.com has `release.yml` but workflow file was renamed |
   | Provenance step errors | Transient Sigstore / Fulcio outage — retry the publish |

4. After diagnosing, fix the npmjs.com configuration and re-enable
   `NPM_CONFIG_PROVENANCE: true` in a follow-up commit.
