# M10 Executor Brief — Unit Drilldown

> **Summary (drilldown only — entry brief at [`m10_executor_brief.md`](m10_executor_brief.md)):**
> - Unit 3 = bump all GHA actions in `ci.yml` + `release.yml` to Node 24-compatible versions;
>   SHA-pin each; lowest risk; lands first.
> - Unit 2 = add PyPI publish step to `release.yml` using `uv publish` (no flags; OIDC from
>   `environment: pypi` + `permissions: id-token: write`); publishes `pkit-process 0.1.0`.
> - Unit 1 = remove `NPM_TOKEN` + `NODE_AUTH_TOKEN` from `release.yml` publish env block; trigger
>   no-op patch changeset; verify OIDC-only npm publish via run log.
> - Sequential order: U3 → U2 → U1 (brain gates between each).
> - U1 STOP-and-bump policy is binding — no auto-rollback on 404/403.
> Read entry brief for wave sequencing, risk flags, working rules, verification gates.

---

## Unit 3 — GHA Node 20 Bitrot Fix

**State:** `ci.yml` and `release.yml` both reference GHA actions running on Node 20 runtimes.
GitHub deprecating Node 20 on GHA runners 2025-09-19
(ref: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/).
No code changes — mechanical version bumps only.

**Scope:** Update all action references in `ci.yml` and `release.yml` to their latest Node
24-compatible versions. SHA-pin each, matching the `@<SHA> # <semver>` comment style already in use
for `astral-sh/setup-uv`. Do NOT introduce any new actions. Do NOT change workflow logic, job
names, triggers, or run commands.

**Resolved SHA pins (research complete — use these exact values):**

| Action | Old version | New version | New commit SHA |
|--------|-------------|-------------|----------------|
| `actions/checkout` | `@v4` | `@v6.0.2` | `de0fac2e4500dabe0009e67214ff5f5447ce83dd` |
| `actions/setup-node` | `@v4` | `@v6.4.0` | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` |
| `pnpm/action-setup` | `@v4` | `@v6.0.8` | `0e279bb959325dab635dd2c09392533439d90093` |
| `oven-sh/setup-bun` | `@v2` | `@v2.2.0` | `0c5077e51419868618aeaa5fe8019c62421857d6` |
| `astral-sh/setup-uv` | `@08807647e7069bb48b6ef5acd8ec9567f424441b # v8.1.0` | UNCHANGED | UNCHANGED |

`astral-sh/setup-uv` is already at the latest version and already SHA-pinned. No change needed.

**Tasks:**

1. Read `ci.yml` (already done — see State section). Confirm current action versions match the
   "Old version" column above before editing. If they differ, STOP and report discrepancy.

2. Edit `ci.yml` — replace all 4 action references:
   ```yaml
   # Before:
   - uses: actions/checkout@v4
   - uses: pnpm/action-setup@v4
   - uses: actions/setup-node@v4
   - uses: oven-sh/setup-bun@v2

   # After (apply to every occurrence):
   - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
   - uses: pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093 # v6.0.8
   - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
   - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
   ```
   `ci.yml` has 3 jobs (`test`, `test-python`, `bun`). `actions/checkout` appears in all 3.
   `pnpm/action-setup` and `actions/setup-node` appear in `test` and `bun`.
   `oven-sh/setup-bun` appears in `bun` only.
   `astral-sh/setup-uv` in `test-python` — leave unchanged.

3. Edit `release.yml` — replace 3 action references:
   ```yaml
   # Before:
   - uses: actions/checkout@v4
   - uses: pnpm/action-setup@v4
   - uses: actions/setup-node@v4

   # After:
   - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
   - uses: pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093 # v6.0.8
   - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
   ```

4. Run `pnpm biome check . --max-diagnostics=500` — should be clean (YAML files not biome-checked,
   but confirm no stray TS changes). Commit on `m10-u3-gha-bitrot`.

**Verification:**
- Diff confirms only version strings changed; no logic, trigger, or job-name changes.
- Push branch; open PR to master; `gh run view <run-id> --log` shows ci.yml `test` + `test-python`
  + `bun` jobs all green with new action versions.
- `release.yml` dry-run: the Version Packages flow triggers if a changeset is present; if not,
  only the changeset/action "no-op" path runs — both are acceptable.

**Out-of-scope:** Adding `actions/setup-bun`, `changesets/action`, or any other action. Changing
trigger branches, job logic, run commands. Adding Renovate/Dependabot config.

**LOC budget:** ~10 line changes across 2 YAML files.

**Commit policy:** single commit; message `chore(ci): bump GHA actions to Node 24-compatible SHAs`.

---

## Unit 2 — PyPI Publish Workflow + First Publish

**State:** `release.yml` has one job (`release`) covering npm. No Python publish step exists.
`docs/development/pypi-publisher-setup.md` documents the pending publisher STOP gate from M9.
`packages/adapter-python-process/pyproject.toml` is at `name = "pkit-process"`,
`version = "0.1.0"`, with a `hatchling` build backend.

**STOP gate (before any code changes):** Confirm with user that the PyPI pending publisher is
configured at `https://pypi.org/manage/account/publishing/`. Required fields:
- PyPI project name: `pkit-process`
- GitHub owner: `mrzadexinho`
- GitHub repository: `pipeline-kit`
- GitHub workflow filename: `release.yml`
- Environment name: `pypi`

If not confirmed, HALT. Do not push to trigger the workflow without the pending publisher in place.
The first publish creates the package and binds the trust relationship — it cannot be retried in the
same way if PyPI rejects the OIDC request due to missing publisher config.

**Scope:** Add a `publish-python` job to `release.yml`. The job runs after the existing `release`
(npm) job. It builds and publishes `pkit-process 0.1.0` to PyPI using `uv publish` with OIDC
trusted publishing. The GitHub Environment `pypi` must exist (create it under
Settings → Environments if not yet present).

**Tooling choice rationale:** `uv publish` preferred over `pypa/gh-action-pypi-publish` — kit is
uv-native (pyproject.toml + hatchling); `uv publish` is a single command with no extra action
dependency; aligns with "infrastructure deepening" principle. The uv GitHub integration guide
(https://docs.astral.sh/uv/) documents this as the canonical pattern. No `--trusted-publishing`
flag needed — OIDC is automatic when `id-token: write` permission + `environment: pypi` are set.

**Tasks:**

1. Confirm GitHub Environment `pypi` exists in the repository. If it does not:
   ```bash
   gh api --method POST /repos/mrzadexinho/pipeline-kit/environments/pypi
   ```
   No protection rules required for M10; add reviewer protection in M11 if desired.

2. Add `publish-python` job to `release.yml` after the existing `release` job block:
   ```yaml
   publish-python:
     needs: release
     runs-on: ubuntu-latest
     environment:
       name: pypi
     permissions:
       id-token: write
       contents: read
     steps:
       - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
       - uses: astral-sh/setup-uv@08807647e7069bb48b6ef5acd8ec9567f424441b # v8.1.0
       - name: Build
         run: uv build
         working-directory: packages/adapter-python-process
       - name: Publish to PyPI
         run: uv publish
         working-directory: packages/adapter-python-process
   ```
   The `needs: release` dependency ensures Python publish only runs after the npm publish step
   completes. If the npm step fails (e.g., no changeset), `publish-python` will be skipped — this
   is correct behaviour; a failed npm step should not gate a Python publish in M11+, but for M10
   the coupling is acceptable.

3. Run `pnpm biome check . --max-diagnostics=500` — clean. Commit on `m10-u2-pypi-publish`.

4. Push branch; merge to master (FF) after Gate 8 green. The merge to master triggers `release.yml`
   and the `publish-python` job runs. Monitor with:
   ```bash
   gh run list --workflow=release.yml --limit 3
   gh run view <run-id> --log | grep -A 20 "publish-python"
   ```

5. Verify Gate 10:
   ```bash
   curl -s https://pypi.org/pypi/pkit-process/json | python3 -m json.tool | grep '"version"'
   ```
   Expect: `"0.1.0"`. Allow up to 5 minutes post-publish for PyPI index to propagate.

**Version note:** publish `0.1.0` exactly as locked in `pyproject.toml`. Do NOT bump to `0.1.1`
unless `0.1.0` fails for a recoverable reason (e.g., partial upload — `uv publish` handles retries
automatically via its built-in check-url logic; the `dist/` content is deterministic). If PyPI
rejects with `400 File already exists`, the package already published — treat as success, verify
with Gate 10 curl.

**Verification:**
- `gh run view <run-id> --log` shows `publish-python` job completed with exit 0.
- Gate 10: `curl https://pypi.org/pypi/pkit-process/json` returns `"0.1.0"`.
- `pip install pkit-process==0.1.0` (optional smoke check; not required for gate).

**Out-of-scope:** PEP 740 attestations (`uv publish --attestations`; defer to M11). PyPI API token
secrets. `uv publish --trusted-publishing automatic` flag (redundant — automatic is the default when
`id-token: write` + environment are set). Multiple Python packages. Bumping `pyproject.toml`
version.

**LOC budget:** ~25 lines added to `release.yml`.

**STOP trigger:** If `publish-python` job 403s or 404s on the PUT request, STOP. Do not retry with
token auth. Document the exact HTTP error in the report-back and carry forward to M11.

**Commit policy:** single commit; message `feat(release): add PyPI publish job for pkit-process`.

---

## Unit 1 — TP-OIDC NPM_TOKEN Cutover

**State:** `release.yml` publishes npm packages via `NODE_AUTH_TOKEN` (set to `secrets.NPM_TOKEN`).
Trusted Publishing was configured on all 33 npm packages in an earlier milestone but has never
been exercised due to a TP claim mismatch (documented in M8/M9 briefs and
`docs/development/tp-oidc-claim-diagnosis.md`). U3 and U2 must be merged before this unit starts —
the workflow must already be proven functional before removing token auth.

**Scope:** Remove the two `env:` lines from the `changesets/action` step in `release.yml` that
provide token-based npm auth. Trigger a no-op patch changeset. Verify OIDC-only auth succeeds by
examining the run log.

**U1 STOP-and-bump policy (binding):**
- If the publish step returns 404 or 403 after removing `NODE_AUTH_TOKEN`:
  - Do NOT add `NODE_AUTH_TOKEN` back.
  - Freeze branch. Capture the full publish step log.
  - Run `docs/development/tp-oidc-claim-diagnosis.md` recipe to identify the claim mismatch.
  - Brain prompts user with findings + corrected `npm trust github` command.
  - No milestone close until root cause is evidenced.
- This policy exists because silent recovery hides the TP configuration state — we need to know
  whether TP is actually working before relying on it.

**Exact diff — lines to remove from `release.yml`:**

Current `release.yml` env block in the `changesets/action` step (lines 46-56):
```yaml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          # NODE_AUTH_TOKEN is what `actions/setup-node` interpolates into the
          # ~/.npmrc auth line (//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}).
          # TP-OIDC migration attempted 2026-05-22 — all 33 pkgs have npm trust
          # configured, but a TP claim mismatch (likely workflow_ref or update-
          # permission scope) caused a 404 on publish PUT. Keeping NPM_TOKEN as
          # the sole auth path until the TP-OIDC issue is diagnosed (post-M8).
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_CONFIG_PROVENANCE: true
```

After cutover — remove `NPM_TOKEN` line, the 5-line comment block, and `NODE_AUTH_TOKEN` line:
```yaml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_CONFIG_PROVENANCE: true
```

Two effective removals (plus the comment block that accompanied `NODE_AUTH_TOKEN`):
```diff
-          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
-          # NODE_AUTH_TOKEN is what `actions/setup-node` interpolates into...
-          # (5 comment lines)
-          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Tasks:**

1. Read `release.yml` (current state post-U3 + post-U2) before editing. Confirm lines match the
   State description above. If the env block differs, STOP and report discrepancy before editing.

2. Edit `release.yml`: remove `NPM_TOKEN: ...` line, the 5-line comment block describing the
   TP-OIDC 404 history, and `NODE_AUTH_TOKEN: ...` line from the `changesets/action` env block.
   Retain `GITHUB_TOKEN` and `NPM_CONFIG_PROVENANCE`.

3. Run `pnpm biome check . --max-diagnostics=500`. Commit on `m10-u1-tpoidc-cutover`.

4. Create a no-op patch changeset:
   ```bash
   pnpm changeset
   # Select: @idriszade/core (patch)
   # Summary: "M10: verify OIDC-only npm publish (no-op patch)"
   git add .changeset/
   git commit -m "chore: add no-op changeset to trigger TP-OIDC verification publish"
   ```

5. Push branch; open PR; merge (FF) to master. Monitor release.yml run:
   ```bash
   gh run list --workflow=release.yml --limit 3
   gh run view <run-id> --log | grep -i "oidc\|trusted\|token\|401\|403\|404\|200"
   ```
   Look for the npm CLI's "publishing via trusted publisher" log indicator (exact string varies by
   npm CLI version; the key signal is a successful PUT to the registry returning 200 without
   `_authToken` in the request).

6. **Gate 9:** If publish succeeds — document in report-back as "TP-OIDC VERIFIED". M10 closed.
   If publish 404s/403s — execute STOP-and-bump policy (see above).

**Verification:**
- `release.yml` env block contains only `GITHUB_TOKEN` and `NPM_CONFIG_PROVENANCE`.
- `gh run view <run-id> --log` shows the publish step completed with exit 0 and no auth error.
- Gate 9: npm publish run log does NOT contain `_authToken` usage; OIDC indicator present.
- `npm view @idriszade/core version` returns the bumped version (allow 10+ min per
  `feedback_npm_view_stale_cache`).

**Out-of-scope:** Removing `secrets.NPM_TOKEN` from GitHub repository secrets (keep as fallback
until M11 confirms TP stable across multiple releases). Diagnosing the TP claim mismatch beyond
the STOP-and-bump gate. Modifying `changesets/action` version or publish script. Updating trust
configuration for the 33 packages (that is Phase 2 of M9 Unit 6, user-OTP-gated).

**LOC budget:** 7 lines removed from `release.yml`.

**STOP trigger:** 404 or 403 on publish PUT — freeze, capture log, escalate (do NOT rollback).

**Commit policy:** 2 commits — one for `release.yml` edit, one for the changeset file.

---

*Drilldown companion to m10_executor_brief.md. Working rules, wave sequencing, risk flags, and
verification gates are in the entry brief.*
