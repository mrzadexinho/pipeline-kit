# M12 Executor Brief — Supply-chain hygiene consolidation

> **Summary (decisions front-loaded):**
> - 4 units, 2 waves. Wave 1 parallel: Dependabot (U1) + OpenSSF Scorecard (U2) + lsp-frame.ts
>   split (U4). Wave 2: PEP 740 PyPI attestations + uv dev-deps migration (U3, sequential, touches
>   release.yml).
> - Post-M11 npm TP-OIDC posture extended to Python; `pypa/gh-action-pypi-publish` with
>   `attestations: true` replaces `uv publish` in release.yml `publish-python` job. 1 new infra ADR
>   (M12-1, sister to M11-1).
> - Base SHA: `26d97bc9e065c40029f05515c6b563658890bd13` (master tip at M12 brief authoring).
> - Cat-scoped ADR ledger (55/55) is UNCHANGED; M12 produces 1 new infrastructure ADR only.
> - Out of scope: hook governance, OIDC loop accumulate variant, branch protection, ADR IX-6,
>   26 Bun-skipped tests, `npm token list` OTP counter advancement.

**Branch prefix:** `m12-u{N}-<slug>` per unit.
**Author (brain):** 2026-05-24
**Estimated executor effort:** 8-14 hours (1-2 sessions)
**Status:** Ready for executor pickup. Cut each unit branch from master tip `26d97bc`.
**Predecessor:** M11 shipped 2026-05-25 at `1acf1ca`; 32 pkgs republished via TP-OIDC + sigstore;
ADR M11-1 ratified Status Accepted; NPM_TOKEN bridge counter 1/6.

Per-unit detail in [`m12_executor_brief_units.md`](m12_executor_brief_units.md).

---

## State at M12 start

- Master tip: `26d97bc` (M11 close-out: set -euo pipefail in OIDC publish loop).
- Tests: 1176+ passing (26 Bun-skipped unchanged). Confirm baseline with `pnpm test`.
- ADRs: 55/55 Cat-scoped — fully ratified. M12 produces 1 NEW infrastructure ADR (M12-1) tracked
  separately in `docs/development/release-auth-posture-pypi.md`.
- Packages on npm: 32 `@idriszade/*` packages with sigstore provenance; TP-OIDC auth (M11
  success path). NPM_TOKEN bridge counter 1/6.
- Python: `pkit-process 0.1.0` live on PyPI; published via `uv publish` WITHOUT PEP 740
  attestations (M10 U2 via pypa-action with `attestations: false`, then re-confirmed M11).
- GHA: `ci.yml` + `release.yml` on Node 24-compatible SHAs; `scorecard.yml` does not yet exist.
- Dependabot: `.github/dependabot.yml` does not yet exist.
- `packages/core/src/wire/lsp-frame.ts`: 462 LOC (over 300-soft, under 500-hard — preventive split).

---

## Scope — 4 units (2 waves)

| Unit | Name | Branch | Detail |
|------|------|--------|--------|
| U1 | Dependabot setup | `m12-u1-dependabot` | `.github/dependabot.yml` for npm + GHA + uv; weekly schedule |
| U2 | OpenSSF Scorecard | `m12-u2-scorecard` | `scorecard.yml` workflow + README badge; SARIF upload |
| U3 | PEP 740 attestations + uv dev-deps migration | `m12-u3-pypi-attestations` | pypa-action replace `uv publish`; pyproject.toml `[dependency-groups]`; ADR M12-1 |
| U4 | lsp-frame.ts preventive split | `m12-u4-lsp-frame-split` | Split 462-LOC file; barrel re-export; tests untouched |

---

## Wave plan

```
Wave 1 — parallel (U1, U2, U4 can run simultaneously; no shared mutable state):

  U1: Dependabot setup  (m12-u1-dependabot)
      .github/dependabot.yml only. Pure config, no code.
      FF-merge after Gate 11 (YAML parses; no "invalid config" in GitHub UI).

  U2: OpenSSF Scorecard  (m12-u2-scorecard)
      .github/workflows/scorecard.yml + README.md badge line.
      FF-merge after Gate 12 (first run green; SARIF uploaded; baseline score captured).

  U4: lsp-frame.ts preventive split  (m12-u4-lsp-frame-split)
      packages/core/src/wire/* — pure refactor; no test edits.
      FF-merge after Gate 14 (each file ≤300 LOC; wire/* tests pass; typecheck + biome green).

Wave 2 — sequential (after Wave 1 complete; touches release.yml):

  U3: PEP 740 attestations + uv dev-deps migration  (m12-u3-pypi-attestations)
      release.yml publish-python job + pyproject.toml + ADR M12-1 + changeset.
      FF-merge after Gate 13 (PyPI Provenance tab shows attestation; sigstore entry searchable).
      ADR M12-1 flipped to Status: Accepted post-verification.
```

---

## ADR surface

| Item | Status after M12 |
|------|-----------------|
| All 55 Cat-scoped ADRs (I-X) | UNCHANGED |
| ADR M11-1 (npm publish auth posture) | UNCHANGED — Status Accepted; bridge counter 1/6 |
| ADR M12-1 (PyPI publish auth posture) | NEW — `docs/development/release-auth-posture-pypi.md` |
| ADR IX-6 (idempotencyKey wire shape) | Still informal; deferred (no 2nd JS adapter yet) |

ADR M12-1 is infrastructure only, tracked separately from the 55/55 Cat-scoped ledger. It is the
Python sister to M11-1: same identity flow (GitHub OIDC token → sigstore signing → PyPI Provenance
tab + transparency log entry).

---

## Verification gates

All 14 must be green before M12 ship. Gates 1-10 inherited from M11; Gates 11-14 are new.

```bash
pnpm typecheck                                         # Gate 1
pnpm biome check . --max-diagnostics=500               # Gate 2 (NOT pnpm lint)
pnpm test                                              # Gate 3 — Vitest 1176+ passing
pnpm build                                             # Gate 4
pnpm format                                            # Gate 5
uv run --frozen pytest packages/adapter-python-process/  # Gate 6
pnpm --filter @idriszade/cli build && node packages/cli/dist/index.js gen-py-schema \
  --in packages/cli/fixtures/wire-schemas/sample-error-frame.ts \
  --out packages/cli/fixtures/wire-schemas/__snapshot__/sample-error-frame.py --check  # Gate 7
# Gate 8: ci.yml green on PR (gh run view <run-id> --log; Node 20+22 + python matrix)
# Gate 9: release.yml npm publish step shows OIDC indicator in run log
# Gate 10: docs/development/release-auth-posture.md exists; ADR M11-1 Status Accepted
```

| # | Gate | Pass criteria |
|---|------|---------------|
| 11 | Dependabot config valid | `.github/dependabot.yml` parses; first scheduled run completes without "invalid config" error in GitHub UI dependency-update logs |
| 12 | Scorecard workflow first run | Pushes SARIF; result visible at `https://scorecard.dev/viewer/?uri=github.com/mrzadexinho/pipeline-kit`; baseline score captured in M12 report-back |
| 13 | PEP 740 attestations on PyPI | `pkit-process` patch re-publish produces sigstore attestation visible at `https://pypi.org/project/pkit-process/#provenance` or via `pypi-attestations inspect`; transparency log entry searchable at `search.sigstore.dev` |
| 14 | lsp-frame split | `packages/core/src/wire/lsp-frame.ts` ≤300 LOC; all derived files ≤300 LOC; ALL wire/* tests pass UNMODIFIED; barrel re-export preserves existing import paths from consumers |

---

## Out of scope

| Candidate | Why deferred |
|-----------|-------------|
| Hook governance hardening | `hooks/security_reminder_hook.py` is a Claude Code plugin (`${CLAUDE_PLUGIN_ROOT}/hooks/`), not in pipeline-kit repo. Out of scope by definition. |
| OIDC publish loop accumulate variant | Fail-fast just landed at `26d97bc`; no partial-failure incident yet. Defer pending evidence. |
| Branch protection / require-PR-for-master | User flagged for separate session. |
| ADR IX-6 idempotencyKey wire shape | Still no 2nd JS adapter. Deferred. |
| 26 Bun-skipped tests | Unbounded scope (needs upstream Bun fixes or test rewrites). Deferred. |
| Cat IX cf #1/#2/#3/#5 | Research-session work, not brief unit. |
| `npm token list` OTP check (counter 1/6) | User-driven operational task, not a unit. |

---

## Carry-forwards still shelved

- ADR IX-6 idempotencyKey wire shape (no 2nd adapter)
- 26 Bun-incompatible skipped tests
- `process-extract` Python mirror
- Cat IX cf #1/#2/#3/#5
- (NEW M12 deferral) OIDC publish loop accumulate-vs-fail-fast variant
- (NEW M12 deferral) Hook governance hardening (out-of-repo)
- (USER-SCOPED) Branch protection, NPM_TOKEN OTP check, 6/6 counter advancement

---

## Working rules (BINDING)

- **Model routing:** sonnet = CRUD/tests/scaffolding; haiku = trivial git lookups; opus = judgment.
  Always pass `model:` explicitly.
- **Brain never writes inline:** all file mutations via sonnet-executor subagents.
- **Branch discipline:** each unit has its own branch; executor bound to branch explicitly.
- **Biome check before every commit:** `pnpm biome check . --max-diagnostics=500` (NOT `pnpm lint`).
- **SHA-pin GHA actions:** match existing `@<SHA> # <semver>` pattern; no floating pins.
- **U3 STOP-and-bump:** if pypa/gh-action-pypi-publish 404s/403s, do NOT revert to `uv publish`
  automatically. Freeze branch. Capture full log. Escalate to brain before any remediation.
- **U4 test immutability:** existing test files in `packages/core/test/wire/` MUST NOT be modified.
- **U4 import stability:** all existing import paths must continue to resolve via barrel re-export.
- **File-size limits:** 300 LOC soft, 500 LOC hard (TS/YAML files).
- **No `--amend`, `--force`, `--no-verify`, `--no-edit` on commits.**
- **Wave 2 dependency:** U3 starts only after Wave 1 (U1 + U2 + U4) all FF-merged to master.

---

## Report-back format

On completion, executor writes `docs/briefs/m12_report_back.md` with:
- Commits table (hash + description, one row per commit).
- Per-unit summary paragraph.
- Gates table (gate name / status / detail).
- ADR M12-1 ratified direction (Accepted vs deferred) with evidence.
- PyPI Provenance tab URL or attestation inspect output (Gate 13 evidence).
- Scorecard baseline score + scorecard.dev viewer URL (Gate 12 evidence).
- Carry-forwards (new from M12 + outstanding from M11+).

---

*M12 brief locked 2026-05-24. Cut each unit branch from master tip `26d97bc`. Confirm 1176+ test
baseline and Gates 1-7 green before Wave 1.*

*Drilldown at [`m12_executor_brief_units.md`](m12_executor_brief_units.md).*
