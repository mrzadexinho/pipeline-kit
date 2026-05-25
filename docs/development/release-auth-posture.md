# ADR M11-1: npm publish auth posture (Trusted Publishing via OIDC)

## Status

Accepted — 2026-05-25 (M11 U1 TP-OIDC verification successful).

## Decision

pipeline-kit publishes its `@idriszade/*` npm packages via **npm Trusted Publishing (OIDC)** with **sigstore provenance**. The publish workflow (`.github/workflows/release.yml`) implements the npm/cli #8976 community working pattern:

- `actions/setup-node` invoked WITHOUT `registry-url` — prevents `_authToken` placeholder injection per npm/cli #8730.
- `changesets/action` invoked WITHOUT `publish:` param + WITH `id: changesets` — prevents OIDC-losing subprocess per npm/cli #8976. SHA-pinned to `63a615b9cd06ba9a3e6d13796c7fbcb080a60a0b` (v1.8.0).
- Publish executed as a bare-shell step (`run: |` block) gated on `steps.changesets.outputs.hasChangesets == 'false'`, inheriting workflow-level `id-token: write` permission and emitting `NPM_CONFIG_PROVENANCE: true` for sigstore attestation.

`NPM_TOKEN` is **retained in GitHub repository secrets as a 6-month bridge fallback** but is NOT wired into `release.yml`. Auto-removal trigger: 6 clean TP-OIDC publishes observed. M11 publish at `fe614d7` is publish 1/6.

## Context

- npm classic tokens revoked 2025-12-09 (no grandfather). Granular tokens capped at 90-day max lifetime.
- npm Trusted Publishing GA 2025-07-31. See https://docs.npmjs.com/trusted-publishers/.
- pipeline-kit attempted TP-OIDC publishes 4× across M7-M10. All four failed; M10 U1 rolled back to NPM_TOKEN auth (commit `a3626f6`).
- Root cause identified at M11 via community evidence:
  - npm/cli #8730 — `actions/setup-node` `registry-url` writes `_authToken=${NODE_AUTH_TOKEN}` placeholder to `.npmrc`; npm CLI prioritises this even when env unset, suppressing OIDC.
  - npm/cli #8976 — `changesets/action` `publish:` parameter spawns a subprocess that does NOT inherit `ACTIONS_ID_TOKEN_REQUEST_TOKEN` / `_URL`; OIDC context lost.
  - actions/setup-node PR #1477 — upstream fix to remove the placeholder injection unmerged as of 2026-05-25.
- M11 U1 implements the npm/cli #8976 jovicheng-comment working pattern.
- Verification: M11 publish run (origin tip `fe614d7`, run ID 26381462292) successfully published 32 of 33 workspace packages via OIDC + sigstore provenance with ZERO 404/403/ENEEDAUTH errors. `@idriszade/cost@0.1.0` correctly skipped (already on npm from M6). 32 unique sigstore transparency log entries captured.

## Consequences

**Positive:**

- SLSA Build L2 attestation via sigstore (transparency log entries verifiable per package).
- No token rotation overhead — OIDC tokens are short-lived + per-run.
- Aligned with OpenSSF / OpenJS 2025-2026 publish-auth posture.
- Future package adds inherit the OIDC pattern automatically via the bare-shell loop iterating `packages/*/`.
- `NPM_TOKEN` retained as fallback gives a rollback path if a future workflow regression breaks OIDC; explicit cleanup trigger (6 clean publishes) prevents the bridge from becoming permanent drift.

**Negative / trade-offs:**

- New packages (first-time publishes, not version bumps) still hit npm/cli #8544 — the initial-version PUT for a brand-new package name does not yet support OIDC. M11 cascade was all VERSION bumps so this didn't surface; new-package adds need temporary NPM_TOKEN until #8544 closes (revisit trigger 1 below).
- npm trust configuration on npmjs.com must remain in sync with the workflow_ref claim. The 33 packages already have correct trust entries (configured in M7-M9 work). Future packages need trust registration at first publish (OTP-gated user action; see `docs/development/tp-oidc-claim-diagnosis.md` Step 5).
- Dependency on the community pattern remaining valid — upstream `changesets/action` or `actions/setup-node` behavior change could re-break OIDC. Tracked via revisit triggers below.
- The bare-shell publish loop has subshell semantics: per-package `npm publish` failures do not abort the step. A future mixed-outcome run could appear "success" overall while some packages 404'd. Detection requires grepping the run log for failure indicators. Acceptable trade-off for v1 (all-or-nothing has been the historical failure mode); revisit if a partial-failure incident occurs.

## Revisit triggers

Any of these conditions REQUIRES re-evaluating this ADR:

1. **npm/cli #8544 closes** — initial-version OIDC unblocked for new packages.
   - URL: https://github.com/npm/cli/issues/8544
   - Action: drop the "first publish needs NPM_TOKEN" carry-forward; new packages can publish via OIDC from the start.

2. **npm/cli #8976 closes** — scoped E404 in `changesets/action` `publish:` subprocess fixed upstream.
   - URL: https://github.com/npm/cli/issues/8976
   - Action: re-evaluate whether `changesets/action` `publish:` can be re-enabled (simpler workflow), or whether the bare-shell split remains preferable for the subshell-semantics + grep-for-failure pattern.

3. **changesets/action #515 ships first-class split version-PR + publish workflow.**
   - URL: https://github.com/changesets/action/issues/515
   - Action: replace the bare-shell publish step with the official split-action pattern.

4. **(operational, not upstream)** 6 clean TP-OIDC publishes observed → remove `secrets.NPM_TOKEN` from GitHub repository secrets.
   - M11 publish at `fe614d7` is publish 1/6.
   - Counter is informal (no automation tracks it); brain checks at each milestone close.

## Cross-references

- `docs/development/tp-oidc-claim-diagnosis.md` — Phase 1 findings + falsified hypotheses (M9-M10) + confirmed root causes (M11).
- `docs/briefs/m11_executor_brief.md` + `docs/briefs/m11_executor_brief_units.md` — M11 unit briefs.
- `docs/development/pypi-publisher-setup.md` — sister doc for PyPI publisher setup (M9 reference, unrelated to npm OIDC).
- `docs/development/release-auth-posture-pypi.md` — ADR M12-1, Python sister to this ADR (Trusted Publishing + PEP 740 attestations for PyPI).
- `.github/workflows/release.yml` — current implementation reference.
- npm Trusted Publishers docs: https://docs.npmjs.com/trusted-publishers/
- M11 verification run: https://github.com/mrzadexinho/pipeline-kit/actions/runs/26381462292

## Authoring + history

- Authored: 2026-05-25 (M11 U1 close).
- Author: brain (Opus 4.7) after sonnet-executor verification run.
- Status track: M7-M10 attempted TP-OIDC → 4× failed (each with different hypothesis class) → M10 rollback to NPM_TOKEN → M11 implements npm/cli #8976 community pattern → SUCCESS at M11 publish run 26381462292.
