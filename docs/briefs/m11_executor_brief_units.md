# M11 Executor Brief — Unit Drilldown

> **Summary (drilldown only — entry brief at [`m11_executor_brief.md`](m11_executor_brief.md)):**
> - Unit 2 = rewrite `tp-oidc-claim-diagnosis.md` to correct falsified Hyp A+B conclusions from
>   M9/M10; add confirmed root cause sections + community working pattern. Pure docs, lands first.
> - Unit 3 = point `packages/observe/package.json` exports map to `./dist/index.js`; resolves
>   Gate 7 failure under Node 26. Single-file edit, lands second.
> - Unit 1 = implement npm/cli #8976 community working pattern: drop `registry-url` from
>   setup-node, strip `publish:` from changesets/action, add bare-shell `npm publish` step with
>   `id-token: write`; ratify ADR M11-1 in `docs/development/release-auth-posture.md`.
> - Sequential order: U2 -> U3 -> U1 (brain gates between each).
> - U1 STOP-and-bump policy is binding — no auto-rollback on 404/403; <= 3 variants before bridge.
> Read entry brief for wave sequencing, risk flags, working rules, verification gates.

---

## Unit 2 — TP-OIDC Diagnosis Doc Rewrite

**State:** `docs/development/tp-oidc-claim-diagnosis.md` is 301 lines. Phase 2 findings section
(lines 261-300) contains conclusions built on falsified hypotheses: Hyp A (`updatePackage` missing)
was disproved because npm/cli source has NO `updatePackage` permission at all — `createPackage` is
the sole publish permission. Hyp B (full-path `workflow_ref`) was disproved because npm CLI
rejects `--file` with a path, enforcing basename only. These falsified blocks would mislead the U1
investigation. Diagnostic recipe (Steps 1-4) remains valid and is preserved.

**STOP gate:** None for U2. Pure markdown; no code, no release.yml, no publish.

**Scope:** Edit `docs/development/tp-oidc-claim-diagnosis.md` in place. Net ~80 lines change
(add ~120, strike ~40). Target: 320-380 lines after edits.

**Tasks:**

1. Read current file. Confirm it is 301 lines with Phase 2 findings section at ~lines 226-301.

2. Add new section near top (after `## Symptom`, before `## Diagnosis steps`):
   `## Falsified hypotheses (M10 attempts, evidence)` with entries:
   - Hyp A: npm CLI source has NO `updatePackage` permission; `createPackage` is the sole publish
     permission. The compound `createPackage + updatePackage` assumption was false.
     (Cite: https://github.com/npm/cli/issues/8730)
   - Hyp B: npm CLI rejects `--file` with a path. Error: "GitHub Actions workflow must be just a
     file not a path". CLI enforces basename only (e.g., `release.yml` not
     `.github/workflows/release.yml`).
   - Hyp C: `ref` claim `refs/heads/master` confirmed matching. Not the root cause.
   - Hyp D: Stripping `git+` prefix from `package.json` did not fix the 404 in M10 U1;
     necessary-but-not-sufficient if related at all.

3. In `## Expected fix paths` / `Step 5 — Re-run npm trust github` (lines ~104-128): remove all
   `--file .github/workflows/release.yml` references; replace with `--file release.yml` (basename
   only — CLI enforces this).

4. In `## Rollback` section (line ~218): replace `npm trust delete "@idriszade/<pkg>"` with
   `npm trust revoke --id <id>` (correct CLI verb).

5. Strike the `### Matched hypothesis` and `### Recommended Phase 2 command shape` blocks
   (lines ~261-300 — built on falsified Hyp A+B). Replace both blocks with a single cross-reference
   paragraph: "See `docs/briefs/m11_executor_brief.md` U1 for confirmed root causes + community
   working pattern."

6. Add new section: `## Confirmed root causes (M11 community evidence)`:
   - npm/cli #8730 (closed via community workarounds): `actions/setup-node` `registry-url` writes
     `_authToken=${NODE_AUTH_TOKEN}` to `.npmrc` that npm CLI prioritizes over OIDC even when env
     unset. URL: https://github.com/npm/cli/issues/8730
   - npm/cli #8976 (open): `changesets/action` `publish:` subprocess does NOT inherit
     `ACTIONS_ID_TOKEN_REQUEST_TOKEN` / `_URL` env vars; OIDC context lost in subprocess.
     URL: https://github.com/npm/cli/issues/8976
   - actions/setup-node PR #1477 (unmerged): upstream fix not shipped.
     URL: https://github.com/actions/setup-node/pull/1477

7. Add new section: `## Working pattern (npm/cli #8976 jovicheng comment)` with this YAML block:
   ```yaml
   # Drop registry-url from setup-node (prevents _authToken injection into .npmrc)
   - uses: actions/setup-node@<sha> # v6.4.0
     with:
       node-version: 24
   # Strip publish: from changesets/action (prevents OIDC-losing subprocess)
   - uses: changesets/action@<sha>
     with:
       version: "pnpm changeset version"
     env:
       GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   # Add bare-shell npm publish step with id-token: write (inherits full OIDC context)
   - name: Publish to npm via OIDC
     if: steps.changesets.outputs.hasChangesets == 'false'
     run: |
       for pkg_dir in packages/*/; do
         # ... (see m11_executor_brief_units.md U1 for full script)
       done
     env:
       NPM_CONFIG_PROVENANCE: true
   ```

8. Run `pnpm biome check . --max-diagnostics=500` — should be clean (markdown not biome-checked;
   verify no stray TS changes leaked).

9. Confirm net result is 320-380 lines.

**Verification:**
- Lines 261-300 (old `### Matched hypothesis` + `### Recommended Phase 2 command shape`) replaced.
- No `--file .github/workflows/release.yml` references remain in the file.
- `npm trust delete` replaced with `npm trust revoke --id <id>`.
- New sections present: `## Falsified hypotheses`, `## Confirmed root causes`, `## Working pattern`.
- `pnpm biome check` clean.

**Out-of-scope:** Re-running diagnostic workflows; capturing new OIDC tokens; modifying release.yml
or any other file outside `tp-oidc-claim-diagnosis.md`.

**LOC budget:** ~80 lines net change; target 320-380 total lines.

**STOP trigger:** None for pure docs work. If a biome error surfaces, investigate before committing.

**Commit policy:** single commit; message
`docs(release): rewrite TP-OIDC diagnosis with M10 falsifications + community evidence`.

---

## Unit 3 — @idriszade/observe Exports Fix

**State:** `packages/observe/package.json` exports map main entry is `./src/index.ts`. This causes
Gate 7 (`pk gen-py-schema check`) to fail under Node 26 because `./src/index.ts` imports
`./exporter.js` which does not exist in src (only in dist after build). CI passes on Node 20/22 due
to looser ESM resolution in older runtimes. The fix is a 1-3 line change.

**STOP gate (before editing):** Confirm `exports` map in `packages/observe/package.json` currently
has `"."` → `"./src/index.ts"`. If it already points to `./dist/index.js`, the bug is resolved and
this unit is a no-op — report discrepancy to brain.

**Scope:** Edit `packages/observe/package.json` exports map only. No source file changes. No other
`package.json` files.

**Tasks:**

1. Read `packages/observe/package.json`. Confirm `exports` map main entry. If a `types` field is
   present in the exports map, note its current value.

2. Change main export entry:
   - `"./src/index.ts"` -> `"./dist/index.js"`
   - If `types` field exists: `"./src/index.ts"` -> `"./dist/index.d.ts"`
   - Apply to every occurrence in the exports map (e.g., `"."`, `"./import"`, `"./require"` if
     present — use judgment; the canonical shape is the `"."` entry).

3. Run build to confirm dist output exists:
   ```bash
   pnpm --filter @idriszade/observe build
   ```
   Expect exit 0. Confirm `packages/observe/dist/index.js` and `packages/observe/dist/index.d.ts`
   are present.

4. Run Gate 7:
   ```bash
   pnpm --filter @idriszade/cli build && node packages/cli/dist/index.js gen-py-schema \
     --in packages/cli/fixtures/wire-schemas/sample-error-frame.ts \
     --out packages/cli/fixtures/wire-schemas/__snapshot__/sample-error-frame.py --check
   ```
   Expect exit 0 (previously failed under Node 26 with resolution error).

5. Run `pnpm biome check . --max-diagnostics=500`. Run `pnpm typecheck`. Both must be clean.

**Verification:**
- `packages/observe/dist/index.js` exists post-build.
- Gate 7 exits 0 under current Node version.
- `pnpm typecheck` clean.
- Gate 8 (CI): push branch; confirm ci.yml `test` + `test-python` + `bun` jobs green.
- No other package.json files modified.

**Out-of-scope:** Refactoring observe's source layout; updating consumers; modifying any other
package.json; bumping observe version (exports map is a build config fix, not a behaviour change).

**LOC budget:** 1-3 lines changed in `packages/observe/package.json`.

**STOP trigger:** If consumers break after exports change (e.g., observe-vercel can't resolve
symbols), STOP. Capture the import error verbatim. Escalate to brain before any remediation.

**Commit policy:** single commit; message
`fix(observe): point exports to built dist for cross-runtime resolution`.

---

## Unit 1 — TP-OIDC Structural Fix + ADR M11-1

**State:** `release.yml` publishes npm packages via `NODE_AUTH_TOKEN` (set to `secrets.NPM_TOKEN`)
restored in M10 rollback. `changesets/action` has `publish:` param active. `actions/setup-node`
has `registry-url: 'https://registry.npmjs.org'`. These three together form the structural barrier
to OIDC auth. Community working pattern from npm/cli #8976 (jovicheng comment) addresses all three.
U2 and U3 must be FF-merged before this unit starts.

**U1 STOP-and-bump policy (binding):**
- If publish returns 404 or 403: do NOT add NPM_TOKEN back. Freeze branch. Capture full log.
- Attempt up to 3 variant fixes if root cause suggests one.
- After 3 failed publish variants: STOP. Brain ratifies ADR M11-1 'Bridge' path.

**Pre-flight tasks (BEFORE editing release.yml):**

1. Re-run `.github/workflows/oidc-token-debug.yml` from master:
   ```bash
   gh workflow run .github/workflows/oidc-token-debug.yml -F audience=npm:registry.npmjs.org
   gh run list --workflow=oidc-token-debug.yml --limit 1
   gh run view <run-id> --log | grep -A 200 'OIDC token claims'
   ```
   Diff captured claims against M9 baseline (`sub`, `aud`, `ref`, `repository`, `workflow_ref`,
   `workflow`, `event_name`, `runner_environment`). Document any drift in report-back.

2. Verify current NPM_TOKEN type (OTP-gated):
   ```bash
   npm token list
   ```
   Confirm token type (granular vs automation). Note expiry date. Record in report-back as
   ADR M11-1 context input.

**Implementation tasks (release.yml edits):**

3. Read `release.yml` (current state post-U3). Confirm `actions/setup-node` step has
   `registry-url: 'https://registry.npmjs.org'` and `node-version: 20`. If divergent from
   expected, STOP and report discrepancy before editing.

4. Drop `registry-url` from `actions/setup-node`; bump `node-version` to `24`:
   ```yaml
   # Before:
   - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
     with:
       node-version: 20
       registry-url: 'https://registry.npmjs.org'

   # After:
   - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
     with:
       node-version: 24
   ```

5. Restructure `changesets/action` step. Four required changes:
   - **Strip `publish:` param** (and the inline `pnpm changeset publish` command). Retain
     `version: pnpm changeset version`.
   - **ADD `id: changesets`** — current step has NO id field; the bare-shell publish step in
     task 6 references `steps.changesets.outputs.hasChangesets` and REQUIRES this id. This is
     a NEW addition, not a modification.
   - **SHA-pin `changesets/action@v1`** — current floating pin violates project working rule.
     Resolve current latest SHA via `gh api repos/changesets/action/releases/latest --jq .tag_name`
     then `gh api repos/changesets/action/git/refs/tags/<tag> --jq .object.sha`. Use the
     `@<SHA> # v<latest>` pattern matching the M10 U3 SHA-pin discipline.
   - **Remove `NPM_TOKEN`, `NODE_AUTH_TOKEN`, AND `NPM_CONFIG_PROVENANCE`** from this step's env
     block. Provenance var is publish-time only; this step now only creates Version PR (no
     publish), so it does not need provenance. The bare-shell publish step in task 6 carries
     `NPM_CONFIG_PROVENANCE: true` instead. Retain only `GITHUB_TOKEN` here.

   Example after:
   ```yaml
   - name: Create Release Pull Request
     uses: changesets/action@<SHA> # v<latest> -- resolve at edit time
     id: changesets
     with:
       version: pnpm changeset version
       commit: "chore(release): version packages"
       title: "chore(release): version packages"
     env:
       GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
   ```

   NOTE: the step `name` should change from "Create Release Pull Request or Publish" to
   "Create Release Pull Request" since it no longer publishes.

6. Add bare-shell `npm publish` step after `changesets/action`, gated on
   `steps.changesets.outputs.hasChangesets == 'false'`. The `id-token: write` permission is
   ALREADY set at workflow level (release.yml line 12) — no job-level addition required.
   Depends on task 5's `id: changesets` addition. Full script:
   ```yaml
   - name: Publish to npm via OIDC
     if: steps.changesets.outputs.hasChangesets == 'false'
     run: |
       for pkg_dir in packages/*/; do
         if [ ! -f "${pkg_dir}package.json" ]; then continue; fi
         PKG_NAME=$(node -p "require('./${pkg_dir}package.json').name")
         PKG_VERSION=$(node -p "require('./${pkg_dir}package.json').version")
         PKG_PRIVATE=$(node -p "require('./${pkg_dir}package.json').private || false")
         if [ "${PKG_PRIVATE}" = "true" ]; then
           echo "${PKG_NAME} is private, skipping"
           continue
         fi
         if npm view "${PKG_NAME}@${PKG_VERSION}" version >/dev/null 2>&1; then
           echo "${PKG_NAME}@${PKG_VERSION} already on npm, skipping"
         else
           (cd "${pkg_dir}" && npm publish --access public --provenance)
         fi
       done
     env:
       NPM_CONFIG_PROVENANCE: true
   ```
   NOTE: do NOT remove `secrets.NPM_TOKEN` from GitHub repo secrets (ADR bridge fallback requires
   it remain reachable for 6 months minimum).

7. Verify YAML syntax: `gh workflow view release.yml` should parse cleanly (or use local
   `npx js-yaml` if gh command unavailable for offline lint).

8. Run `pnpm biome check . --max-diagnostics=500`. Commit on `m11-u1-tpoidc-fix`.

**No-op changeset trigger:**
```bash
pnpm changeset
# Select: @idriszade/core (patch)
# Summary: 'M11: verify TP-OIDC publish via plumbing fix (no-op patch)'
git add .changeset/
git commit -m "chore: add no-op changeset to trigger TP-OIDC plumbing verification"
```

**Monitor publish run:**
```bash
gh run list --workflow=release.yml --limit 3
gh run view <run-id> --log | grep -iE 'oidc|trusted|token|401|403|404|200|publish'
```

**ADR M11-1 ratification (NEW file `docs/development/release-auth-posture.md`):**

Create after publish outcome is known. Required sections:

- `## Status` — set to `Accepted` (Success path) or `Bridge` per outcome.
- `## Decision`:
  - Success: "kit publishes via npm Trusted Publishing (OIDC) with sigstore provenance;
    NPM_TOKEN retained in repo secrets 6 months as fallback; auto-removed at M-future once
    6 clean TP-OIDC publishes observed."
  - Bridge: "kit publishes via granular NPM_TOKEN with sigstore provenance; rotation cadence
    <= 90 days; TP-OIDC re-attempt forced by any of the 3 revisit triggers below."
- `## Context`: classic tokens revoked 2025-12-09; granular tokens 90-day max; npm TP GA
  2025-07-31; M7-M10 attempted TP-OIDC 4x; M11 implements npm/cli #8976 community pattern.
- `## Consequences`:
  - Success: SLSA L2 attestation via sigstore; no rotation overhead; aligned with OpenSSF posture.
  - Bridge: SLSA L2 attestation retained (sigstore independent of auth method); 90-day rotation
    cost; explicit re-attempt triggers prevent indefinite drift.
- `## Revisit triggers (apply to both paths)`:
  1. npm/cli #8544 closes (initial-version OIDC unblocked — new packages).
     URL: https://github.com/npm/cli/issues/8544
  2. npm/cli #8976 closes (scoped E404 in changesets fixed upstream).
     URL: https://github.com/npm/cli/issues/8976
  3. changesets/action #515 ships first-class split version-PR + publish workflow.
     URL: https://github.com/changesets/action/issues/515
- `## Cross-references`: `docs/development/tp-oidc-claim-diagnosis.md`,
  `docs/briefs/m11_executor_brief.md`,
  npm Trusted Publishers: https://docs.npmjs.com/trusted-publishers/

**Verification:**
- `release.yml`: `setup-node` has no `registry-url`; `node-version: 24`; `changesets/action`
  has no `publish:` param; bare-shell publish step present.
- `release.yml` env block for changesets/action: only `GITHUB_TOKEN` + `NPM_CONFIG_PROVENANCE`.
- `docs/development/release-auth-posture.md` exists with Status + Decision + 3 revisit triggers.
- Gate 9: publish run log shows OIDC indicator OR ADR M11-1 'Bridge' ratified with evidence.
- Gate 10: `release-auth-posture.md` ratifies M11-1 with correct Status field.

**Out-of-scope:** Removing `secrets.NPM_TOKEN` from GitHub repo secrets. Diagnosing beyond STOP
gate. Modifying `changesets/action` version. Updating npmjs.com trust configuration for 33 packages
(that remains OTP-gated user action). Updating observe or any other package.

**LOC budget:** release.yml ~30 lines net change; `release-auth-posture.md` ~100 lines new.

**STOP trigger:** 404 or 403 on first publish PUT. Capture log, attempt up to 2 more variants,
then freeze + escalate. No auto-rollback.

**Commit policy:** 2-3 commits — (a) `release.yml` plumbing edits, (b) no-op changeset,
(c) `release-auth-posture.md` ADR after publish outcome confirmed.

---

*Drilldown companion to m11_executor_brief.md. Working rules, wave sequencing, risk flags, and
verification gates are in the entry brief.*
