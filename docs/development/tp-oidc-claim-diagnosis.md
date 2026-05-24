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

## Falsified hypotheses (M10 attempts, evidence)

The following hypotheses from M8-M9 were disproved during M10 publish attempts:

### Hyp A — `updatePackage` permission missing (FALSIFIED)

The M9 framing assumed the perl-patched npm CLI 11.12.1 was missing an `updatePackage`
permission alongside `createPackage`. M10 source inspection of npm CLI revealed there is
**no `updatePackage` permission at all** — `createPackage` is the sole publish permission
in the registry contract. The compound `createPackage + updatePackage` assumption was false.

Cite: https://github.com/npm/cli/issues/8730

### Hyp B — `workflow_ref` full-path required (FALSIFIED)

The M9 framing called for `--file` with the full path `.github/workflows/release.yml` in
`npm trust github`. M10 attempts revealed npm CLI **rejects `--file` with a path**,
returning: `GitHub Actions workflow must be just a file not a path`. The CLI enforces
basename only (e.g., `release.yml`, never the full `.github/workflows/` prefix).

### Hyp C — `ref` claim mismatch (CONFIRMED NOT ROOT CAUSE)

OIDC token claims captured in M9 (Phase 1 findings below) confirmed `ref: refs/heads/master`.
No `refs/heads/main` default mismatch. Not the root cause.

### Hyp D — `git+` prefix in `package.json` repository URL (FALSIFIED)

M10 U1 stripped `git+https://github.com/...` → `https://github.com/...` from `package.json`
`repository.url` fields on the assumption this affected OIDC subject claim matching. The
404 persisted after the strip. Necessary-but-not-sufficient if related at all.

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
  --file release.yml \
  --repo mrzadexinho/pipeline-kit \
  --allow-publish
# Note: npm CLI rejects --file with a path; use basename only. Hyp B is falsified (see top of doc).
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
   npm trust revoke --id <id>            # revoke the bad config (look up <id> via `npm trust list --json`)
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

> M10 attempts falsified the matched-hypothesis conclusion above. See `docs/briefs/m11_executor_brief.md` U1 for confirmed root causes + community working pattern. The M11 sections below (`## Confirmed root causes` + `## Working pattern`) summarise the canonical answer; the brief carries the full bare-shell publish script.

## Confirmed root causes (M11 community evidence)

Three structural barriers prevent TP-OIDC publish in changesets-based workflows. All three
must be removed simultaneously; partial fixes leave the OIDC path broken.

### Cause 1 — `actions/setup-node` `registry-url` writes `_authToken` to `.npmrc`

When `actions/setup-node` is invoked with `registry-url: 'https://registry.npmjs.org'`,
the action writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` to a generated
`.npmrc`. npm CLI prioritises `_authToken` lookup **even when `NODE_AUTH_TOKEN` env is
unset** — the placeholder string itself is treated as an auth attempt, suppressing OIDC.

URL: https://github.com/npm/cli/issues/8730

### Cause 2 — `changesets/action` `publish:` subprocess loses OIDC env

The `changesets/action` `publish:` parameter spawns a subprocess to run `pnpm changeset
publish`. That subprocess **does not inherit** the `ACTIONS_ID_TOKEN_REQUEST_TOKEN` and
`ACTIONS_ID_TOKEN_REQUEST_URL` env vars from the GitHub Actions runner. OIDC context is
lost in the publish subprocess; npm CLI falls back to non-OIDC auth (which is now absent
per Cause 1's revoked classic tokens), 404ing the registry PUT.

URL: https://github.com/npm/cli/issues/8976

### Cause 3 — upstream `actions/setup-node` fix unmerged

A community PR removing the `_authToken=${VAR}` placeholder injection has been open since
2025 without merge. Until shipped, every workflow using `setup-node` + `registry-url` hits
Cause 1.

URL: https://github.com/actions/setup-node/pull/1477

## Working pattern (npm/cli #8976 jovicheng comment)

The community working pattern (verified by multiple OSS publishers in npm/cli #8976
follow-up comments) drops all three structural barriers:

````yaml
# 1. Drop registry-url from setup-node (prevents _authToken injection into .npmrc).
- uses: actions/setup-node@<sha> # v6.4.0
  with:
    node-version: 24

# 2. Strip publish: from changesets/action (prevents OIDC-losing subprocess).
#    The action now only opens the Version PR; publish is a separate bare-shell step.
- uses: changesets/action@<sha>
  id: changesets
  with:
    version: "pnpm changeset version"
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# 3. Add bare-shell `npm publish` step with id-token: write at workflow level
#    (inherits full OIDC context; no subprocess env loss).
- name: Publish to npm via OIDC
  if: steps.changesets.outputs.hasChangesets == 'false'
  run: |
    for pkg_dir in packages/*/; do
      # ... (see docs/briefs/m11_executor_brief_units.md U1 for full script)
    done
  env:
    NPM_CONFIG_PROVENANCE: true
````

The `id: changesets` field is REQUIRED for the bare-shell step's
`steps.changesets.outputs.hasChangesets` gate. `id-token: write` permission must be set
at workflow level (already present in pipeline-kit's `release.yml` line 12).

This pattern is implemented in pipeline-kit M11 Unit 1.
