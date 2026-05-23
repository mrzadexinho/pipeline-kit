# Brief — M10 Release Flow Hardening (entry)

> **Summary (decisions front-loaded):**
> - 3 units, all touching `.github/workflows/release.yml`; single milestone.
> - Wave 1 is sequential: U3 GHA bitrot first (lowest risk baseline), then U2 PyPI publish step,
>   then U1 TP-OIDC NPM_TOKEN cutover last (destructive; must land after U2 proves release.yml works).
> - U1 STOP-and-bump policy: if OIDC publish 404s/403s, executor freezes branch and escalates to
>   brain. No automatic rollback. Evidence preservation over silent recovery.
> - U2 first publish: `pkit-process 0.1.0` (locked in pyproject.toml; no version bump unless 0.1.0
>   fails for a recoverable reason). Tooling: `uv publish` (no special flag; OIDC from
>   `permissions: id-token: write` + `environment: pypi`).
> - U3 action pins: bump by SHA + semver comment, matching existing
>   `astral-sh/setup-uv@08807647e7069bb48b6ef5acd8ec9567f424441b # v8.1.0` pattern.
> - ADR ledger stays 55/55. No new ratification expected.
> - Changeset: one no-op patch changeset to trigger publish and verify U1 OIDC path.
> - Verification gates: 8 existing M9 gates + Gate 9 (OIDC-only npm publish) + Gate 10 (pkit-process on PyPI).

**Branch prefix:** `m10-u{N}-<slug>` per unit (see unit table below).
**Author (brain):** 2026-05-23
**Estimated executor effort:** 8-16 hours (1-2 sessions)
**Status:** Ready for executor pickup. Cut each unit branch from master tip `745dd5c`.
**Predecessor:** M9 shipped + published 2026-05-23; master tip `745dd5c`; 55/55 ADRs.

Per-unit detail in [`m10_executor_brief_units.md`](m10_executor_brief_units.md).

---

## State at M10 start

- Master tip: `745dd5c` (post-M9 release).
- Tests: 1373+ passing (exact count from `pnpm test` at session start; 26 Bun-skipped unchanged).
- ADRs: 55/55 — fully ratified; no new ADR surface expected in M10.
- Packages on npm: 33 `@idriszade/*` packages with sigstore provenance attestations.
- npm Trusted Publishing: configured on all 33 packages; `NODE_AUTH_TOKEN` still active (TP-OIDC
  404 unresolved from M9; U1 addresses this).
- Python: `packages/adapter-python-process/` exists; `pkit-process 0.1.0` built and tested but NOT
  yet published; PyPI pending publisher configured (M9 Unit 5 STOP gate — confirm with user before
  U2).
- GHA actions: `ci.yml` and `release.yml` both still on Node 20-compatible versions (U3 target).

## What ALREADY exists (do not recreate)

- `.github/workflows/release.yml` — current state; see U1 + U3 scope.
- `.github/workflows/ci.yml` — current state; see U3 scope.
- `packages/adapter-python-process/pyproject.toml` — `name = "pkit-process"`, `version = "0.1.0"`.
- `docs/development/pypi-publisher-setup.md` — M9 doc; U2 builds on this directly.
- `docs/development/tp-oidc-claim-diagnosis.md` — TP-OIDC diagnosis recipe from M8.

---

## Package surface

| Package | Tier | Change | Version bump |
|---------|------|--------|--------------|
| `@idriszade/*` (all 33) | 1-3 | no new package; U1 no-op patch changeset only | patch on one pkg |
| `pkit-process` (PyPI) | Python | first PyPI publish | 0.1.0 (no bump) |

---

## Scope — 3 units (one-liner table)

| Unit | Name | Branch | Detail |
|------|------|--------|--------|
| 3 | GHA Node 20 bitrot fix | `m10-u3-gha-bitrot` | Bump all GHA actions to Node 24-compatible versions; SHA-pin; verify ci.yml + release.yml green |
| 2 | PyPI publish workflow | `m10-u2-pypi-publish` | Add Python publish step to release.yml; `uv publish`; `environment: pypi`; verify pkit-process 0.1.0 on PyPI |
| 1 | TP-OIDC NPM_TOKEN cutover | `m10-u1-tpoidc-cutover` | Remove `NPM_TOKEN` + `NODE_AUTH_TOKEN` env vars; no-op patch changeset; verify OIDC-only npm publish |

---

## Wave sequencing

```
Wave 1 — sequential (all 3 units in order; brain gates between each):

  Step 1: U3 GHA bitrot  (m10-u3-gha-bitrot)
          Lowest risk. Action version bumps only. FF-merge after ci.yml + release.yml green.

  Step 2: U2 PyPI publish step  (m10-u2-pypi-publish)
          Adds new publish job. Depends on U3 baseline being clean.
          STOP gate: confirm pypi-publisher-setup.md pending publisher configured before push.
          FF-merge after pkit-process 0.1.0 verified on PyPI.

  Step 3: U1 TP-OIDC cutover  (m10-u1-tpoidc-cutover)
          Removes NPM_TOKEN. Lands LAST — any post-cutover failure attributed cleanly.
          STOP-and-bump policy applies (see Risk section).
          FF-merge only after OIDC-only npm publish confirmed via run log.
```

---

## ADR ledger after M10

| Item | Status after M10 |
|------|-----------------|
| All 55 ADRs | UNCHANGED — M10 is infrastructure, not spec work |
| ADR IX-6 (idempotencyKey wire shape) | Still informal; defer to M11 when ≥2 adapters use it |

ADR count stays 55/55. If executor session surfaces an ADR-tier decision during build, STOP and
escalate to brain.

---

## Risk / ADR-surface

**U1 STOP-and-bump policy (binding):**
If OIDC publish returns 404 or 403 after removing `NODE_AUTH_TOKEN`:
- Do NOT re-add `NODE_AUTH_TOKEN` automatically.
- Freeze branch at last clean state.
- Capture the full publish step log.
- Brain prompts user with exact diagnosis path (per `docs/development/tp-oidc-claim-diagnosis.md`).
- No milestone close until root cause identified and evidenced.

**U2 PyPI pending publisher pre-check (blocking):**
Before running U2, confirm the PyPI pending publisher from M9 Unit 5 is configured. If it was
not completed (user STOP gate may have been skipped), executor must halt at U2 start and prompt
user to complete the form at `https://pypi.org/manage/account/publishing/` before proceeding.

**No ADR surface expected.** If executor finds a new design-forcing constraint in any unit, STOP and
escalate rather than deciding inline.

---

## Carry-forwards expected into M11+

- ADR IX-6: formalize `idempotencyKey` wire shape (needs ≥2 adapters; deferred).
- 26 Bun-incompatible skipped tests (explicit M11 unit).
- Cat IX cf #1/#2/#3/#5 (research-spike-heavy; separate brain session).
- `packages/core/src/wire/lsp-frame.ts` 456-LOC split (under 500 hard limit; M11 preventive only).
- `process-extract` Python mirror (LLM complexity; M11+).
- PEP 740 PyPI attestations (defer until M11 after M10 baseline OIDC publish validates).
- Renovate/Dependabot (own M11+ unit; not covered by U3 manual bump).
- Branch protection / require-PR-for-master (separate discussion; invalidates FF-merge pattern).

---

## Non-goals (explicit — reject in review if raised)

- New ADR ratification in M10.
- `process-extract` Python mirror.
- PEP 740 / `uv publish --attestations` (defer to M11).
- Bun-compat skipped test fixes.
- Renovate/Dependabot setup.
- Branch protection rules.
- `packages/core/src/wire/lsp-frame.ts` refactor.
- Cat IX cf spikes.

---

## Changeset guidance

```bash
# U1 only — after TP-OIDC cutover is confirmed working:
pnpm changeset
# Select: @idriszade/core (patch)
# Summary: "M10: verify OIDC-only npm publish (no-op patch)"
```

U2 (PyPI) and U3 (GHA action bumps) generate no changeset. Python package has no `package.json`.

---

## Verification gates

All 10 must be green before M10 ship:

```bash
pnpm typecheck                                         # Gate 1
pnpm biome check . --max-diagnostics=500               # Gate 2 (NOT pnpm lint)
pnpm test                                              # Gate 3 — Vitest 1373+ passing
pnpm build                                             # Gate 4
pnpm format                                            # Gate 5
uv run --frozen pytest packages/adapter-python-process/  # Gate 6
pnpm --filter @idriszade/cli build && node packages/cli/dist/index.js gen-py-schema \
  --in packages/cli/fixtures/wire-schemas/sample-error-frame.ts \
  --out packages/cli/fixtures/wire-schemas/__snapshot__/sample-error-frame.py --check  # Gate 7
# Gate 8: ci.yml green on PR (gh run view <run-id> --log; both Node 20+22 + python matrix)
# Gate 9 (NEW): release.yml publish step shows "publishing via trusted publisher" or equivalent
#   OIDC success indicator in the run log — no NODE_AUTH_TOKEN, no NPM_TOKEN in env
# Gate 10 (NEW): curl https://pypi.org/pypi/pkit-process/json returns version "0.1.0"
```

---

## Working rules (BINDING)

- **Model routing:** sonnet = CRUD/tests/scaffolding; haiku = trivial git lookups; opus = judgment.
  Always pass `model:` explicitly.
- **Brain never writes inline:** all file mutations via sonnet-executor subagents.
- **Branch discipline:** each unit has its own branch; executor bound to branch explicitly.
- **Biome check before every commit:** `pnpm biome check . --max-diagnostics=500` (NOT `pnpm lint`).
- **SHA-pin GHA actions:** match existing `@<SHA> # <semver>` pattern; no `@v6` floating pins.
- **U1 STOP-and-bump:** never auto-rollback on 404/403; freeze + escalate (see Risk section).
- **U2 pending publisher pre-check:** halt if PyPI pending publisher not confirmed configured.
- **File-size limits:** 300 LOC soft, 500 LOC hard (TS/YAML files).
- **No `--amend`, `--force`, `--no-verify`, `--no-edit` on commits.**

---

## Report-back format

On completion, executor writes `docs/briefs/m10_report_back.md` with:
- Commits table (hash + description, one row per commit).
- Per-unit summary paragraph.
- Gates table (gate name / status / detail).
- GHA action versions table (action / old version / new SHA+tag).
- TP-OIDC status (Gate 9 log indicator verbatim or 404 diagnosis).
- PyPI publish status (Gate 10 curl output or failure evidence).
- Carry-forwards (new from M10 + outstanding from M9+).

---

*M10 brief locked 2026-05-23. Cut each unit branch from master tip `745dd5c`. Confirm 1373+ test
baseline and ci.yml green before Wave 1 step 1 (U3).*
