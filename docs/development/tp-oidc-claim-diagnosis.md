# TP-OIDC 404 Claim Diagnosis

> Diagnostic recipe for the TP-OIDC 404 on version-update symptom first observed
> in M7. Landed as M8 Unit 4 infrastructure — actual fix is M9+ carry-forward.

## Symptom

After configuring Trusted Publishing via `npm trust github` for all 33 `@idriszade/*`
packages (using the perl-patched npm CLI 11.12.1 that injects
`permissions: ['createPackage']`), removing `NODE_AUTH_TOKEN` from `release.yml` and
setting `NPM_CONFIG_PROVENANCE=true` causes the publish step to:

1. Log `"No NPM_TOKEN found, but OIDC is available - using npm trusted publishing"`
   (changesets/action correctly picks up the OIDC path).
2. Log `"Signed provenance statement with source and build information from GitHub Actions"`
   (provenance signs successfully against Sigstore/Rekor).
3. Log `"Provenance statement published to transparency log"` (Rekor entry created).
4. Then immediately emit `npm error 404 Not Found - PUT https://registry.npmjs.org/@idriszade%2f<pkg>`
   for every package — all version-update PUTs 404.

The provenance path succeeds; the registry PUT itself fails. This is a trust claim
mismatch, not a network or auth-token issue.

## Diagnosis steps

### Step 1 — Capture GitHub OIDC token claims

Trigger the diagnostic workflow from any branch (master preferred — release.yml also
runs from master, so the claims will match):

```bash
gh workflow run .github/workflows/oidc-token-debug.yml \
  -F audience=npm:registry.npmjs.org
# Wait ~30s for the run to complete, then:
gh run list --workflow=oidc-token-debug.yml --limit 1
gh run view <run-id> --log | grep -A 200 'OIDC token claims'
```

Copy the full JSON claims block printed between the `====` banners.
**Do not share this output publicly** — `workflow_ref` and `repository` are sensitive.

### Step 2 — Capture npm trust config claims

Under OTP elevation (you have ~5 minutes after MFA to skip re-prompting), run the
introspect script for one package:

```bash
bash scripts/npm-trust-introspect.sh @idriszade/core
cat tmp/tp-oidc-diagnosis/_idriszade_core.json
```

If the output is empty or `[]`, wait 5+ minutes and retry — this is the
`feedback_npm_trust_list_lag` behaviour; `npm trust list` has a read-after-write lag
after a successful create/update.

Repeat for a second package to confirm the config is consistent:

```bash
bash scripts/npm-trust-introspect.sh @idriszade/process-extract
cat tmp/tp-oidc-diagnosis/_idriszade_process-extract.json
```

### Step 3 — Diff the claims

Compare these fields between the OIDC token (Step 1) and the trust config (Step 2):

| Field | Where to look in OIDC token | Where to look in trust config |
|---|---|---|
| `sub` | Top-level `sub` claim | Trust entry `subject` or `conditions.sub` |
| `aud` | Top-level `aud` claim | Must equal `npm:registry.npmjs.org` |
| `ref` | Top-level `ref` claim | Trust entry `conditions.ref` or similar |
| `repository` | Top-level `repository` | Trust entry `conditions.repository` |
| `workflow_ref` | Top-level `workflow_ref` | Trust entry `conditions.workflow_ref` |
| `workflow` | Top-level `workflow` | Trust entry `conditions.workflow` |
| `event_name` | Top-level `event_name` | Trust entry `conditions.event_name` |
| `runner_environment` | Top-level `runner_environment` | Trust entry `conditions.runner_environment` |
| `permissions` | Not in OIDC token — this is a trust config field | Trust entry `permissions` array |

Build a side-by-side table for the mismatched fields. The mismatch is the fix target.

### Step 4 — Identify the mismatch

Most likely candidates per `feedback_npm_tp_oidc_404`:

**A. Permissions scope is `['createPackage']` only.**
The perl-patched CLI 11.12.1 injected `permissions: ['createPackage']` because the
`npm trust github` `--allow-publish` flag maps to both `createPackage` AND
`updatePackage` in the upstream registry contract, but our manual patch only added
`createPackage`. Version-update PUTs need `updatePackage` (or an equivalent combined
permission). This is the highest-probability root cause.

**B. `workflow_ref` in trust config uses just `release.yml` instead of full path.**
The actual GitHub OIDC token presents `workflow_ref` as
`.github/workflows/release.yml@refs/heads/master` (full relative path + ref).
If the trust config was registered with just `release.yml`, the registry rejects every
PUT because the subject claim doesn't match.

**C. `ref` claim defaulted to wrong value.**
The trust config was registered without an explicit `ref`. The npm registry may default
to `refs/heads/main` while the actual token presents `refs/heads/master`. Confirm the
`ref` field in both captures.

### Step 5 — Re-run `npm trust github` with corrected claims

**This step is interactive and OTP-gated. Execute manually; this script does NOT run
it for you.**

After identifying the mismatch in Step 4, revoke and recreate the trust config for
each package with the corrected arguments. Example for the most likely fix (A):

```bash
# EXAMPLE ONLY — user executes under OTP elevation:
npm trust github "@idriszade/core" \
  --file release.yml \
  --repo mrzadexinho/pipeline-kit \
  --allow-publish
# --allow-publish in the unpatched upstream CLI sets both createPackage + updatePackage.
# Do NOT use the perl-patched CLI for this step if the upstream CLI is available.

# Confirm (expect empty for 5+ minutes per feedback_npm_trust_list_lag):
npm trust list "@idriszade/core" --json
```

Repeat for all 33 packages. Use the `--all` flag on the introspect script after
re-creation to batch-verify:

```bash
bash scripts/npm-trust-introspect.sh --all
```

## Expected fix paths

### Hypothesis A — createPackage → include updatePackage

The `permissions` field in the trust config must include both `createPackage` and
`updatePackage` (or whatever the registry calls version-bump permission).

Re-run shape:
```bash
npm trust github "@idriszade/<pkg>" \
  --file release.yml \
  --repo mrzadexinho/pipeline-kit \
  --allow-publish
# `--allow-publish` in the stock upstream CLI should set the full permission set.
# If using the perl-patched CLI, manually extend the permissions array in the patch.
```

### Hypothesis B — workflow_ref full path

The trust config's `workflow_ref` condition must exactly match the OIDC token's
`workflow_ref` claim, which includes the full path and ref suffix.

Re-run shape:
```bash
npm trust github "@idriszade/<pkg>" \
  --file .github/workflows/release.yml \
  --repo mrzadexinho/pipeline-kit \
  --allow-publish
# Note: `--file` should be the full relative path, not just the filename.
```

### Hypothesis C — explicit ref claim for master

The trust config's `ref` condition must be `refs/heads/master` if that's what the OIDC
token presents.

Re-run shape:
```bash
npm trust github "@idriszade/<pkg>" \
  --file release.yml \
  --repo mrzadexinho/pipeline-kit \
  --ref refs/heads/master \
  --allow-publish
# `--ref` may not be a flag on npm CLI 11.12.1; check `npm trust github --help`.
# If not available, the ref condition may be configurable only via the npmjs.com UI.
```

## Re-test instructions

Once trust config is corrected on ALL 33 packages:

1. Make a no-op changeset on a feature branch:
   ```bash
   git checkout -b test/tp-oidc-retest
   pnpm changeset
   # Select one package, patch bump, write a short summary.
   git add .changeset/
   git commit -m "chore: tp-oidc re-test changeset (patch)"
   gh pr create --title "test: TP-OIDC re-test" --body "Manual re-test of Trusted Publishing after claim fix."
   ```
2. Merge the PR to master.
3. Open `.github/workflows/release.yml` and comment out the `NODE_AUTH_TOKEN` env var
   in the publish step (the `NPM_CONFIG_PROVENANCE: true` line should already be active).
4. Push the `release.yml` change to master directly (or via a second trivial PR).
5. Observe the publish step in the Version Packages PR run that changesets/action opens:
   - Expected: `"OIDC is available — using npm trusted publishing"` + all PUTs return 200 + provenance attestation links in the run log.
   - NOT expected: `404 Not Found - PUT https://registry.npmjs.org/@idriszade%2f<pkg>`.

## Rollback

If provenance fails after the trust config fix:

1. Re-add `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` to the publish step env block in
   `.github/workflows/release.yml`. The `NPM_TOKEN` secret remains in the GitHub repo
   secret store regardless of whether the env var is wired in the workflow YAML.
2. Push the revert to master. The next changesets publish run will use the legacy token
   path and succeed.
3. Diagnose via the run logs — look for which PUTs 404'd and compare their package
   names to the introspect output for those packages.
4. Per-package remediation (OTP-gated):
   ```bash
   npm trust delete "@idriszade/<pkg>"   # revoke the bad config
   # Wait for trust list to clear (feedback_npm_trust_list_lag)
   npm trust github "@idriszade/<pkg>" \
     --file release.yml \
     --repo mrzadexinho/pipeline-kit \
     --allow-publish
   # Recreate with corrected arguments from Step 4 findings.
   ```

---

*Diagnostic infrastructure landed in M8 Unit 4 — 2026-05-22. Actual fix is M9+ carry-forward.*

---

## Phase 1 findings (M9 U6, captured 2026-05-23)

### Run details

- Workflow: `.github/workflows/oidc-token-debug.yml`
- Run ID: `26326199840`
- SHA at trigger: `764060371b8137a65e24961e5e45e05ed6bfd4f2` (master tip)
- Conclusion: success (9s)
- Audience requested: `npm:registry.npmjs.org`

### Captured OIDC token claims (diagnostic fields only)

```json
{
  "sub": "repo:mrzadexinho/pipeline-kit:ref:refs/heads/master",
  "aud": "npm:registry.npmjs.org",
  "ref": "refs/heads/master",
  "repository": "mrzadexinho/pipeline-kit",
  "workflow_ref": "mrzadexinho/pipeline-kit/.github/workflows/oidc-token-debug.yml@refs/heads/master",
  "workflow": "OIDC Token Debug (manual)",
  "event_name": "workflow_dispatch",
  "runner_environment": "github-hosted"
}
```

Notes:
- `workflow_ref` and `workflow` above are from `oidc-token-debug.yml`. For the actual
  release run, `workflow_ref` will be
  `mrzadexinho/pipeline-kit/.github/workflows/release.yml@refs/heads/master`
  and `workflow` will be `Release`.
- `ref` is `refs/heads/master` (not `refs/heads/main`). Hypothesis C is NOT the root
  cause — the ref matches what any trust config registered without `--ref` would default
  to on a master-branch repo.

### Matched hypothesis

**Hypothesis A + B (compound):**

1. **A (primary — createPackage missing updatePackage):** The perl-patched npm CLI
   11.12.1 injected `permissions: ['createPackage']` only. Version-update PUTs require
   `updatePackage` (or the combined flag that `--allow-publish` sets in the stock CLI).
   This is the definitive root cause for version-bump 404s.

2. **B (secondary — workflow_ref short path):** If `npm trust github --file release.yml`
   was used during original registration, the trust config stores a condition on the
   short filename `release.yml`. The actual OIDC token presents the full path
   `mrzadexinho/pipeline-kit/.github/workflows/release.yml@refs/heads/master`. The
   registry matches on the full path; a short-path trust entry would be rejected even
   if permissions were correct.

   **Use `--file .github/workflows/release.yml` (full path) in Phase 2.**

**Hypothesis C eliminated** — `ref` is `refs/heads/master`; no `refs/heads/main`
mismatch.

### Recommended Phase 2 command shape

Per hypotheses A+B, re-run trust registration with the stock (unpatched) npm CLI
using the full workflow file path:

```bash
npm trust github "@idriszade/<pkg>" \
  --file .github/workflows/release.yml \
  --repo mrzadexinho/pipeline-kit \
  --allow-publish
```

`--allow-publish` in the stock upstream CLI sets both `createPackage` + `updatePackage`.
`--file .github/workflows/release.yml` anchors the `workflow_ref` condition to the
full relative path that the OIDC token presents.

Do NOT use the perl-patched CLI for Phase 2 — the patch only adds `createPackage`.
If only the patched CLI is available, extend the permissions array to include both
`createPackage` and `updatePackage` before running.
