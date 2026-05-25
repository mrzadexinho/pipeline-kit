# M13 Executor Brief — Operational consolidation + Python adapter expansion

> **Status: READY.** 5 units / 2 waves. ADR surface 55/55 → 56/56 (IX-6 ratified). Scorecard 4.3 → ~5.5–6.5. Dependabot 9 → 0. NPM_TOKEN bridge 2/6 → 3/6. Master tip `02b8d9e`.

**Branch prefix:** `m13-u{N}-<slug>` per unit.
**Author (brain):** 2026-05-25
**Estimated executor effort:** 12-18 hours (2-3 sessions)
**Status:** Ready for executor pickup. Cut each unit branch from master tip `02b8d9e`.
**Predecessor:** M12 shipped 2026-05-25 at `76b5723`; 32 pkgs via TP-OIDC + sigstore; pkit-process 0.1.1 on PyPI with PEP 740; ADR M12-1 ratified Accepted; NPM_TOKEN bridge 2/6.

Per-unit detail in [`m13_executor_brief_units.md`](m13_executor_brief_units.md).

---

## Theme

M12 shipped 4 supply-chain hygiene units + 1 ADR (M12-1 Accepted). M13 consolidates the M12
footprint by clearing the Dependabot triage queue, capturing the OpenSSF Scorecard baseline +
deepening with CodeQL, and advancing the cross-runtime story with a second Python adapter
(`adapter-python-process-extract`) plus ratification of the long-deferred ADR IX-6
(idempotencyKey wire shape). Theme: operational consolidation + first substantive Python adapter
expansion. Hybrid flavor A+B+C (triage + adapter substance + static analysis depth).

---

## State at brief authoring (2026-05-25)

- Master tip: `02b8d9e` (M12 report-back + ADR M12-1 ratified Status Accepted).
- Tests: 1373 Vitest passing / 2 skipped + 69 pytest. Baseline with `pnpm test`.
- ADRs: 55/55 Cat-scoped — fully ratified. M11-1 + M12-1 Accepted (infra ADRs). M13 produces
  1 new ADR (IX-6) in the Cat IX ledger, bumping surface to 56/56.
- Packages on npm: 33 `@idriszade/*` packages with sigstore provenance; TP-OIDC auth.
  NPM_TOKEN bridge counter 2/6.
- Python: `pkit-process 0.1.1` on PyPI with PEP 740 attestation (rekor logIndex 1628344184).
- GHA: `ci.yml` + `release.yml` + `scorecard.yml` on master; CodeQL does NOT yet exist.
- Dependabot: 9 PRs open (#17-25). Double-prefix cosmetic bug in commit titles confirmed.
- Scorecard: baseline 4.3/10 (SAST=0, Token-Permissions=0 — M13 targets).

---

## Waves table

| Wave | Unit | Theme | Closes |
|------|------|-------|--------|
| 1 (parallel) | U1 | Dependabot triage + cosmetic config fix | 6 of 9 PRs |
| 1 (parallel) | U2 | Scorecard baseline + CodeQL + Token-Permissions hardening | SAST 0→10, Token-Perms 0→9+ |
| 1 (parallel) | U3 | `process-extract` Python mirror | 2nd Python adapter |
| 2 (sequential) | U4 | ADR IX-6 ratify (gate relaxed) | Oldest deferred ADR |
| 2 (sequential) | U5 | zod 4 → fast-check 4 → vitest 4 batch | 3 of 9 PRs (#23 #20 #25) |

---

## Per-unit checklist

### U1 — Dependabot triage + cosmetic config fix

**Action:** Merge 6 safe Dependabot PRs and fix the double-prefix commit-message bug in
`.github/dependabot.yml`; defer PRs #20, #23, #25 to U5.

- Edit `.github/dependabot.yml`: drop `include: scope` from npm, github-actions, and uv blocks
- Merge #17 (actions/github-script 7→9) directly — low risk
- Verify group PRs #18 (js-dev) and #19 (js-prod) don't contain vitest/fast-check/zod patches
  before merging; if clean, merge
- Merge #21 + #22 together (testcontainers + @testcontainers/redis 10→11 shared major); grep
  constructor usage first
- Merge #24 (google-auth-library 9→10) after verifying `GoogleAuth` API stability in v10
- DO NOT merge #20, #23, #25 — deferred to U5

**STOP after U1:** confirm 6 PRs closed (#17, #18, #19, #21, #22, #24); 3 deferred to U5;
double-prefix titles gone on next Dependabot scan.

**Verification:** `gh pr list --author "app/dependabot" --json number,title` returns exactly
PRs #20, #23, #25 open.

---

### U2 — Scorecard baseline + CodeQL + Token-Permissions hardening

**Action:** Create `docs/development/scorecard-baseline.md`, add `.github/workflows/codeql.yml`,
and add job-level `permissions:` blocks to all workflows missing them.

- Create `scorecard-baseline.md` with 2026-05-25 per-check breakdown and post-M13 projection
- Create `.github/workflows/codeql.yml` — push/PR/schedule/dispatch; language matrix TS+Python;
  SHA-pinned to `github/codeql-action@7211b7c8077ea37d8641b6271f6a365a22a5fbfa` (v4.36.0);
  `permissions: read-all` top-level; job `security-events: write` + `actions: read` + `contents: read`
- Audit all `.github/workflows/*.yml` for missing job-level `permissions:` blocks; add as needed
- Add CodeQL README badge near existing Scorecard badge

**STOP after U2:** CodeQL first run green on push to master (TS + Python); scorecard-baseline.md
committed; all workflows have job-level permissions blocks. Do NOT wait for Scorecard rescan.

**Verification:** Code-scanning tab at `github.com/mrzadexinho/pipeline-kit/security/code-scanning`
populated; `scorecard-baseline.md` exists; all workflows have job-level `permissions:` blocks.

---

### U3 — `process-extract` Python mirror

**Action:** Create `packages/adapter-python-process-extract/` with a full Python port of the TS
`process-extract` adapter, publish `pkit-process-extract 0.1.0` to PyPI with PEP 740 attestation.

- Scaffold `pyproject.toml` (name `pkit-process-extract`, hatchling, pydantic>=2, anyio>=4, OTel)
- Port `ExtractProcessConfig` Pydantic model + `create_extract_process()` function from TS source
- Add `publish-python-process-extract` job to `release.yml` (mirror `publish-python` job pattern)
- Register Trusted Publisher for `pkit-process-extract` on PyPI BEFORE pushing release.yml change
- Write tests: round-trip with mocked provider; schema-failure retry path; provider-missing error

**STOP after U3:** `pkit-process-extract 0.1.0` published to PyPI with PEP 740 attestation;
sigstore rekor entry present; local pytest passes.

**Verification:** `uv run --directory packages/adapter-python-process-extract pytest` passes;
package exists on PyPI; attestation at `https://pypi.org/integrity/pkit-process-extract/0.1.0/<wheel>/provenance`.

---

### U4 — ADR IX-6 idempotencyKey wire-shape ratification

**Action:** Append ADR IX-6 to `docs/research-notes-v1-cat-IX.md` with Status: Accepted and
update the spec index from 55 → 56 ADRs. Docs-only, no code changes.

- Write ADR IX-6 in `docs/research-notes-v1-cat-IX.md` — decision: `SerializableContext` is
  canonical wire shape; LSP header `x-pipeline-idempotency-key`; NDJSON body field
  `body.metadata.idempotencyKey`; gate relaxed to "2nd adapter any language" (rationale: wire
  shape is language-neutral; Python consumers at M9 + M13 U3 satisfy consensus intent)
- Update spec index (locate in `docs/spec.md` or research-notes header) — increment IX count 5→6
- Add revisit triggers and cross-references to ADR-v1-IX-1..IX-5 and `serializable-context.ts`

**STOP after U4:** ADR IX-6 Status: Accepted in file; spec index shows 56/56; no code changes.

**Verification:** `grep -A2 "IX-6" docs/research-notes-v1-cat-IX.md` shows Status: Accepted.

---

### U5 — High-impact major v-bumps batch (zod 4 + fast-check 4 + vitest 4)

**Action:** Merge Dependabot PRs #23, #20, #25 in order (zod → fast-check → vitest), patching
any breaking-change fallout before each merge.

- Merge #23 (zod 3→4): grep `ZodIssueCode|ZodError` across packages; reference `9d57b38` for
  prior zod4 fix patterns; `pnpm -r build && pnpm test` must pass after merge
- Merge #20 (fast-check 3→4): search `fc.uuid()` and `fc.scheduler` usages; 0-3 files expected;
  `pnpm test` property tests must pass
- Merge #25 (vitest 3→4): grep `vi.restoreAllMocks` (semantics changed); check `.toMatchSnapshot`
  mock-name snapshots; full test pass + biome clean
- Trigger release.yml for one TP-OIDC publish — advances NPM_TOKEN bridge counter 2/6 → 3/6

**STOP after U5:** all 9 Dependabot PRs closed; `pnpm test` green on master; CI green; bridge
counter advances.

**Verification:** `gh pr list --author "app/dependabot"` returns empty; `pnpm -r build &&
pnpm typecheck && pnpm test && pnpm biome check . --max-diagnostics=500` all pass.

---

## Verification gates (17 total)

```bash
pnpm typecheck                                          # Gate 1
pnpm biome check . --max-diagnostics=500                # Gate 2 (NOT pnpm lint)
pnpm test                                               # Gate 3 — Vitest 1373+ passing
pnpm build                                              # Gate 4
pnpm format                                             # Gate 5
uv run --frozen pytest packages/adapter-python-process/ # Gate 6
pnpm --filter @idriszade/cli build && node packages/cli/dist/index.js gen-py-schema \
  --in packages/cli/fixtures/wire-schemas/sample-error-frame.ts \
  --out packages/cli/fixtures/wire-schemas/__snapshot__/sample-error-frame.py --check  # Gate 7
# Gate 8: ci.yml green on PR (gh run view <run-id> --log)
# Gate 9: release.yml npm publish step shows OIDC indicator in run log
# Gate 10: docs/development/release-auth-posture.md exists; ADR M11-1 Status Accepted
```

| # | Gate | Pass criteria |
|---|------|---------------|
| 1 | typecheck | `pnpm typecheck` exit 0 |
| 2 | biome check | `pnpm biome check . --max-diagnostics=500` exit 0 |
| 3 | test (Vitest) | 1373+ passed, 0 unexpected failures |
| 4 | build | All packages build clean |
| 5 | format | Covered by biome check |
| 6 | pytest (Python) | 69+ tests pass; 0 deprecation warnings |
| 7 | gen-py-schema --check | Snapshot unchanged |
| 8 | ci.yml on push | All CI matrix jobs green |
| 9 | release.yml OIDC | npm publish shows OIDC + sigstore in log |
| 10 | M11-1 posture doc | ADR M11-1 Status Accepted unchanged |
| 11 | Dependabot config valid | No double-prefix titles on next scan |
| 12 | Scorecard first run | Workflow green; baseline score captured |
| 13 | PEP 740 (pkit-process) | Attestation live at PyPI integrity endpoint |
| 14 | lsp-frame split | All wire tests pass; all derived files ≤300 LOC |
| 15 | CodeQL first run | TS + Python matrix green; code-scanning dashboard populated |
| 16 | Scorecard recapture | Score ≥ 5.5 at M13 close (regression-floor 4.3) |
| 17 | pkit-process-extract PyPI | `pkit-process-extract 0.1.0` published; PEP 740 sigstore entry present |

---

## Working rules (BINDING)

- Brain never writes inline; sonnet-executor for ALL mutations.
- Always pass `model:` explicitly on Agent dispatches (sonnet=CRUD/tests; haiku=trivial; opus=judgment).
- Worktree isolation for code/doc mutations; branch prefix `m13-u{N}-<slug>` per unit.
- `pnpm biome check . --max-diagnostics=500` before every commit (NOT `pnpm lint`).
- No `--amend`, `--force`, `--no-verify`, `--no-edit` on commits.
- SHA-pin GHA actions to commit SHA (not tag-object SHA — changesets/action M11 lesson applies).
- `secrets.NPM_TOKEN` stays until 6/6 (currently 2/6); do NOT remove before then.
- `biome.json` has `useIgnoreFile: false` — `.gitignore` alone won't exclude artifacts.
- Parallel push race-safety: rebase-retry pattern (fetch + rebase + push, up to 3 attempts).
- `uv publish` does NOT generate PEP 740 attestations; `pypa/gh-action-pypi-publish@v1.11+` is canonical.
- GHA security-hook: warn-once retry pattern, never bypass with `--no-verify`.
- U3 STOP-and-bump: if PyPI publish 403/404s, freeze branch + escalate to brain before revert.
- Wave 2 dependency: U4 and U5 start only after Wave 1 (U1 + U2 + U3) all FF-merged to master.
- U3 requires manual TP registration on PyPI BEFORE pushing `release.yml` change.

---

## Out of scope (rejected — do not raise)

| Candidate | Why rejected |
|-----------|-------------|
| Branch protection / require-PR-for-master | User separate session |
| SLSA L3 ADR M13-1 | No concrete pressure; revisit if CodeQL findings drive structural decision |
| Bun-incompatible skipped tests | Unbounded scope; upstream Bun fixes needed |
| Cat IX cf #1/#2/#3/#5 | Separate research session, not brief work |
| Pre-emptive `process-classify` Python mirror | U3 is sufficient for M13 |
| Adding a 2nd JS adapter | Would balloon scope; U4 ratifies IX-6 with gate already relaxed |
| OIDC publish loop accumulate variant | Fail-fast holds; no incident |
| Hook governance hardening | Claude Code plugin, out-of-repo |

---

## References

- M12 report-back at `docs/briefs/m12_report_back.md`
- ADR M11-1 (npm auth posture) at `docs/development/release-auth-posture.md`
- ADR M12-1 (PyPI auth posture) at `docs/development/release-auth-posture-pypi.md`
- Drilldown at `docs/briefs/m13_executor_brief_units.md`
- ADR IX-6 wire shape: `packages/core/src/serializable-context.ts:8-12`

---

*M13 brief locked 2026-05-25. Cut each unit branch from master tip `02b8d9e`. Confirm 1373+
Vitest + 69 pytest baseline and Gates 1-7 green before Wave 1.*

*Drilldown at [`m13_executor_brief_units.md`](m13_executor_brief_units.md).*
