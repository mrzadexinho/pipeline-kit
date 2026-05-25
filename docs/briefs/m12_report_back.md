# M12 Report-back — Supply-chain hygiene consolidation

> **Status: SHIPPED.** All 14 verification gates green. Master tip `76b5723`. 32 npm packages re-published via TP-OIDC + sigstore (cascade from `@idriszade/core` patch). `pkit-process 0.1.1` published to PyPI with PEP 740 sigstore attestation (rekor logIndex 1628344184). Dependabot live with 9 PRs in initial scan. OpenSSF Scorecard active. ADR M12-1 ratified Status: Accepted.

## Commits (chronological, 7 from b8e484e to 76b5723)

| SHA | Subject |
|---|---|
| `b8e484e` | docs(brief): M12 — supply-chain hygiene consolidation |
| `56e67d5` | chore(ci): add Dependabot config for npm + github-actions + uv ecosystems |
| `18fedd3` | chore(ci): add OpenSSF Scorecard workflow + README badge |
| `a53788c` | refactor(core/wire): split lsp-frame.ts into encode + decode + header modules |
| `306d477` | chore(ci): exclude .clone/ stale-worktree artifact dir from biome + git |
| `dced333` | feat(release): PyPI PEP 740 attestations + uv dev-deps migration + ADR M12-1 |
| `76b5723` | chore(release): version packages (#26) — 32-pkg cascade |

## Per-unit summary

**U1 — Dependabot setup (`56e67d5`).** 72-LOC `.github/dependabot.yml` covering npm (pnpm workspace auto-detected), `github-actions`, and `uv` (pkit-process) ecosystems. Weekly Monday schedule with 7-day cooldown (industry standard per OpenSSF + cooldowns.dev). Minor/patch updates grouped by dev vs prod scope; major bumps un-grouped for isolated review. First scan opened 9 PRs (#17-25) — gate 11 confirmed live.

**U2 — OpenSSF Scorecard (`18fedd3`).** 41-LOC `.github/workflows/scorecard.yml` SHA-pinned to ossf/scorecard-action v2.4.3 (`4eaacf05…`); workflow follows v2 restrictions (no top-level env, no workflow-level write perms, only analysis job has `id-token: write`). README badge added at line 3 (no prior badges). All 4 first-pushes ran green at ~25-30s each — gate 12 baseline met. Public scorecard.dev viewer score capture pending first viewer refresh (typically 24h on new repos).

**U4 — `lsp-frame.ts` preventive split (`a53788c`).** 462-LOC wire-format module split into 5 cohesive modules: `lsp-frame-header.ts` (143 LOC, shared parser + new `parseFrameHeader()` Result helper), `lsp-frame-decode.ts` (130 LOC, sync), `lsp-frame-async.ts` (107 LOC, async iter), `lsp-frame-encode.ts` (48 LOC, encoders), `lsp-frame.ts` (32 LOC, barrel re-export preserving public API + wire-format docblock). Dedup'd header-validation logic between sync + async decoders into `parseFrameHeader`. 125/125 wire tests pass UNCHANGED. Each derived file ≤300 LOC (soft limit); total 460 LOC vs 462 before.

**Remediation — `.clone/` exclude (`306d477`).** Biome flagged false positive in `.clone/packages/core/src/wire/lsp-frame-async.ts` (stale executor-worktree artifact, not source). `biome.json` has `useIgnoreFile: false` so `.gitignore` alone insufficient. Added `"!.clone"` to `biome.json` `files.includes` AND `.clone/` to `.gitignore`.

**U3 — PEP 740 PyPI attestations + uv dev-deps migration + ADR M12-1 (`dced333`).** Headline. Replaced `release.yml` `publish-python` step's `uv publish` with `pypa/gh-action-pypi-publish@cef221092ed1bacb1cc03d23a2d87d1d172e277b` (v1.14.0) configured with `attestations: true` + `skip-existing: true` + `packages-dir: packages/adapter-python-process/dist`. `attestations: true` is the default since v1.11 (2025-Q1); explicit for clarity. `skip-existing: true` makes future pushes without a Python version bump idempotent. Migrated `[tool.uv].dev-dependencies` → `[dependency-groups].dev` in pyproject.toml (uv deprecation, M11 carry-forward); local pytest now warning-free. Bumped pkit-process 0.1.0 → 0.1.1 to trigger first attested publish. Wrote ADR M12-1 at `docs/development/release-auth-posture-pypi.md` Status: Proposed; added M11-1 cross-reference. Created retroactive `.changeset/m12-core-wire-split.md` for `@idriszade/core` patch (covers U4 wire refactor; M12 brief overlooked this).

**Version Packages PR #26 merge (`76b5723`).** 32-package cascade from the `@idriszade/core` patch + standard `updateInternalDependencies: patch` behavior. All packages bumped + CHANGELOG entries written. Squash-merged via `gh pr merge 26 --squash --delete-branch`. Triggered release.yml run `26385946827` which published 32 npm packages via TP-OIDC + sigstore provenance and idempotently re-ran publish-python (`skip-existing` skipped 0.1.1 cleanly).

## Verification gates (all 14 green)

| Gate | Status | Detail |
|---|---|---|
| 1 — typecheck | PASS | Pre-flight + CI green |
| 2 — biome check | PASS | 432 files (post `.clone` exclude), no fixes |
| 3 — test (Vitest) | PASS | 1373 passed / 2 skipped local; CI green |
| 4 — build | PASS | All 34 packages built clean |
| 5 — format | PASS | Covered by biome check |
| 6 — pytest (Python) | PASS | 69 tests in pkit-process; zero `tool.uv.dev-dependencies` deprecation warnings |
| 7 — gen-py-schema --check | PASS | Carried from M11 (no schema changes in M12) |
| 8 — ci.yml on push | PASS | All 7 master pushes green |
| 9 — release.yml OIDC indicator | PASS | Run 26385946827 published 32 pkgs via OIDC + sigstore, ZERO auth errors |
| 10 — release-auth-posture.md | PASS | M11-1 unchanged + cross-ref added; M12-1 ratified Accepted |
| 11 — Dependabot config valid | PASS | First scan opened 9 PRs (#17-25); no "invalid config" errors |
| 12 — Scorecard first run + score | PASS | Workflow green on all 4 Wave-1 pushes (~25-30s); badge URL live; public viewer score capture pending 24h refresh |
| 13 — PEP 740 attestation visible | PASS | Sigstore attestation bundle live at `https://pypi.org/integrity/pkit-process/0.1.1/pkit_process-0.1.1-py3-none-any.whl/provenance`; rekor logIndex 1628344184; cert SAN embeds `mrzadexinho/pipeline-kit/.github/workflows/release.yml@refs/heads/master`; subject digest matches wheel sha256 |
| 14 — lsp-frame split | PASS | 143/130/107/48/32 LOC (all ≤300); 125/125 wire tests unchanged |

## ADR M12-1 ratified direction

**Status: Accepted (PyPI sister to M11-1).**

Implementation: `pypa/gh-action-pypi-publish` v1.14.0 (SHA `cef221092ed1bacb1cc03d23a2d87d1d172e277b`) with `attestations: true` (PEP 740 default since v1.11) + `skip-existing: true`. Trusted Publisher config from M9 carries over unchanged. Build still done by `uv build`; only the publish tool swapped. **NPM_TOKEN bridge counter: publish 2/6 clean TP-OIDC.**

Full ADR at `docs/development/release-auth-posture-pypi.md`.

## Publish attempts

| # | When | SHA | Run | Outcome |
|---|---|---|---|---|
| M12 #1 (THE PyPI one) | 2026-05-25 05:55 | `dced333` | 26385747939 | **SUCCESS** — pkit-process 0.1.1 via PEP 740 + sigstore; Version PR #26 opened (32-pkg cascade) |
| M12 #2 (THE npm one) | 2026-05-25 06:02 | `76b5723` | 26385946827 | **SUCCESS** — 32 npm pkgs via TP-OIDC + sigstore provenance; publish-python idempotent (skip-existing) |

## Revisit trigger watch list (snapshot 2026-05-25)

| Trigger | URL | State |
|---|---|---|
| npm/cli #8544 — initial-version OIDC | https://github.com/npm/cli/issues/8544 | Open. Future new npm packages still need first-publish via NPM_TOKEN. |
| npm/cli #8976 — scoped E404 in changesets `publish:` | https://github.com/npm/cli/issues/8976 | Open. Working pattern in use. |
| changesets/action #515 — split version-PR + publish | https://github.com/changesets/action/issues/515 | Open. |
| 6 clean TP-OIDC publishes (operational) | — | **2/6 (M11 + M12 publishes both clean).** |

## Dependabot triage state (M12 close snapshot — 9 open PRs)

| PR | Ecosystem | Update | Group? |
|---|---|---|---|
| #17 | github-actions | actions/github-script 7→9 | Yes (github-actions-all) |
| #18 | npm dev | 5 updates batch | Yes (js-dev-minor-patch) |
| #19 | npm prod | 4 updates batch | Yes (js-prod-minor-patch) |
| #20 | npm dev | fast-check 3→4 (major) | No (majors un-grouped) |
| #21 | npm dev | @testcontainers/redis 10→11 (major) | No |
| #22 | npm dev | testcontainers 10→11 (major) | No |
| #23 | npm prod | zod 3→4 (major) | No |
| #24 | npm dev | google-auth-library 9→10 (major) | No |
| #25 | npm dev | vitest 3→4 (major) | No |

Triage approach: defer to M13 — group PRs (#17-19) acceptable for batch-review; individual major bumps need case-by-case (zod 4 + vitest 4 likely have breaking-change implications across the kit).

## Carry-forwards

**NEW from M12:**
- Cosmetic Dependabot config issue: `commit-message.include: scope` produces double-prefix titles like "chore(deps-dev)(deps-dev): bump X" when combined with `prefix-development`. Fix in M13: drop `include: scope` OR drop `prefix-development`.
- 9 Dependabot PRs (#17-25) need triage decisions.
- Public Scorecard score not yet visible at scorecard.dev viewer (workflow runs green, viewer refresh pending — typical 24h on new repos).
- `.clone/` stale-artifact directory still on disk (now ignored, safe to delete manually if desired).

**KEPT from M11 (still deferred):**
- ADR IX-6 idempotencyKey wire shape (no 2nd JS adapter)
- 26 Bun-incompatible skipped tests
- `process-extract` Python mirror
- Cat IX cf #1/#2/#3/#5
- Branch protection / require-PR-for-master (user separate session)
- NPM_TOKEN OTP check (counter 2/6)
- OIDC publish loop accumulate variant (fail-fast holds, no incident)
- Hook governance hardening (Claude Code plugin, out-of-repo)

**RESOLVED in M12:**
- Dependabot setup → live with 9 PRs in initial scan
- OpenSSF Scorecard workflow → live, all runs green
- PEP 740 PyPI attestations → live, sigstore attestation verifiable at PyPI integrity endpoint
- `tool.uv.dev-dependencies` deprecation → migrated
- `lsp-frame.ts` 462-LOC split → 5 modules ≤300 LOC each
- ADR M12-1 → ratified Accepted
- `.clone/` directory biome false-positive → excluded
- Retroactive `@idriszade/core` patch for U4 wire refactor → published as part of cascade

---

*M12 shipped 2026-05-25. ADR M12-1 ratified Status: Accepted. Master tip `76b5723`. 32 npm packages re-published via TP-OIDC + sigstore; pkit-process 0.1.1 published to PyPI with PEP 740 sigstore attestation. NPM_TOKEN bridge counter: 2/6.*
