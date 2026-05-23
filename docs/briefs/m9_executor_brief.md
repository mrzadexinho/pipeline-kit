# Brief — M9 Python Adapter (entry)

> **Summary (decisions front-loaded):**
> - Wave 1a (parallel): Unit 1 `pkit_wire` Python helpers + Unit 2 discriminated-union codegen fixture.
> - Wave 1b (sequential): Unit 3 reference Python `process-classify` adapter (depends on Unit 1).
> - Wave 1c (parallel after 1b): Unit 4 CI matrix expansion + Unit 5 PyPI pending publisher docs.
> - Wave 2 (independent): Unit 6 TP-OIDC 404 remediation (Phase 1 agent-runnable; Phase 2 user-OTP-gated).
> - New packages: 1 Python-only (`packages/adapter-python-process/`; NO `package.json`; NOT on npm).
> - Changeset: `@idriszade/cli` patch bump only (Unit 2 fixture).
> - ADR surface: `idempotencyKey` wire shape is an informal convention not covered by IX-1..IX-5 — see Risk / ADR-surface section below. Default to Option A (ship informal; formalize as IX-6 in M10).
> - Verification gates: 5 existing Node gates + 3 new Python gates (pytest / gen-py-schema check / CI job green) = 8 total.

**Branch:** `m9-python-adapter`
**Author (brain):** 2026-05-23
**Estimated executor effort:** 24-32 hours (2-3 sessions)
**Status:** Ready for executor pickup. Cut `m9-python-adapter` from master tip `7640603`.
**Predecessor:** M8 shipped + published 2026-05-23; 1373 Vitest tests passing + 2 skipped; 55/55 ADRs.

Per-unit detail in [`m9_executor_brief_units.md`](m9_executor_brief_units.md).

---

## State at M9 start

- Master tip: `7640603` (post-M8 release).
- Tests: 1373 passing + 2 skipped at last green run.
- ADRs: 55/55 — all ratified in Phase 2 spec; IX-1..IX-5 kit-impls shipped in M8.
- Packages on npm: 33 `@idriszade/*` packages with sigstore provenance attestations.
- npm Trusted Publishing: configured on all 33 packages; UNUSED — `NODE_AUTH_TOKEN` remains active; TP-OIDC 404 unresolved (Unit 6 addresses).
- Python: NO Python code anywhere in this repo at M9 start.

## What does NOT exist yet (confirm before Wave 1a)

- `packages/adapter-python-process/` does NOT exist.
- `packages/cli/fixtures/wire-schemas/sample-error-frame.ts` does NOT exist (discriminated-union fixture).
- `.github/workflows/ci.yml` has no Python job.
- `docs/development/pypi-publisher-setup.md` does NOT exist.

## What ALREADY exists (do not recreate)

- `packages/core/src/wire/` — full wire module (NDJSON + LSP codecs, canonical JSON, timestamps, decode_result, trace-wire). Primary reference for Python parity.
- `packages/core/src/wire/README.md` — implementor reference; Python adapter must match semantics.
- `packages/cli/src/commands/gen-py-schema.ts` + `packages/cli/fixtures/wire-schemas/sample-atom.ts` — M8 codegen pipeline; Unit 2 adds a discriminated-union fixture alongside, not replacing.
- `docs/development/tp-oidc-claim-diagnosis.md` — Wave 2 recipe doc (Unit 6 Phase 1 executes against this).

---

## Package surface

| Package | Tier | New / Extend | Version bump |
|---------|------|--------------|--------------|
| `packages/adapter-python-process/` | Python-only | NEW | PyPI pending; no npm bump |
| `@idriszade/cli` | 2 | extend (new discriminated-union fixture + snapshot) | patch |

---

## Scope — 6 units (one-liner table)

| Unit | Name | Detail |
|------|------|--------|
| 1 | `pkit_wire` Python helper package | 5 modules: decode_result, ndjson, lsp_frame, canonical_json, timestamp; ADR IX-3 namedtuple shape; see drilldown §unit-1 |
| 2 | Codegen discriminated-union fixture | `sample-error-frame.ts` Zod fixture + committed `sample-error-frame.py` snapshot; `--check` CI gate; see drilldown §unit-2 |
| 3 | Reference Python adapter (process-classify) | End-to-end stdin NDJSON → classify → stdout; OTel child span; idempotencyKey pickup; subprocess pytest harness; see drilldown §unit-3 |
| 4 | CI matrix expansion | New `test-python` job in `.github/workflows/ci.yml`; `["3.12","3.13"]` matrix; `astral-sh/setup-uv@v8.1.0`; see drilldown §unit-4 |
| 5 | PyPI pending publisher config + docs | Package name pick; pending publisher web-UI STOP gate; `docs/development/pypi-publisher-setup.md`; see drilldown §unit-5 |
| 6 | TP-OIDC 404 remediation | Phase 1 agent-runnable (trigger debug workflow, capture claims); Phase 2 user-OTP-gated STOP (re-run `npm trust` for 33 packages); Phase 3 verification; see drilldown §unit-6 |

---

## Wave sequencing

```
Wave 1a (2 parallel — fully independent):
  ├─ Unit 1: pkit_wire Python helpers  (packages/adapter-python-process/src/pkit_wire/)
  └─ Unit 2: discriminated-union fixture  (packages/cli/fixtures/wire-schemas/)

Wave 1b (sequential after 1a; both units committed):
  └─ Unit 3: reference Python adapter  (packages/adapter-python-process/examples/classify/)

Wave 1c (2 parallel after Unit 3 committed):
  ├─ Unit 4: CI matrix expansion  (.github/workflows/ci.yml)
  └─ Unit 5: PyPI pending publisher docs  (docs/development/pypi-publisher-setup.md)

Wave 2 (independent — start any time; Phase 2 user-gated):
  └─ Unit 6: TP-OIDC remediation  (.github/workflows/, user OTP)
```

---

## ADR ledger after M9

| Item | Status after M9 |
|------|----------------|
| IX-1..IX-5 | ALREADY SHIPPED (M8) — M9 implements Python side |
| IX-6 (idempotencyKey wire shape) | INFORMAL in M9; formalize in M10 if pattern holds |

ADR count stays 55/55. No new ratification in M9 — Python adapter implements shipped ADRs.

---

## Risk / ADR-surface

**idempotencyKey wire shape is NOT covered by a ratified ADR.**

Current informal convention: `x-pipeline-idempotency-key` LSP header; `body.metadata.idempotencyKey` NDJSON field. These are not in IX-1..IX-5.

- **Option A (default):** ship in M9 as informal convention; freeze naming now; formalize as ADR IX-6 in M10 after real usage validates the shape.
- **Option B:** pause M9 and add ADR IX-6 first via brain-spec cycle.

Default to Option A unless user pushes back before executor pickup.

No other ADR surface expected. If executor session surfaces an ADR-tier decision during build, STOP and escalate to brain.

---

## Carry-forwards expected into M10+

- **TP-OIDC Phase 2** — user-OTP-gated; may complete during M9 window or land as M10 carry.
- **PyPI publish** — `uv publish` + OIDC in M10; pending publisher configured in M9 (Unit 5).
- **Cat IX cf #1 partial** — `idempotencyKey` shipped; `signal.aborted` + `memory` crossing deferred.
- **Cat IX cf #2** — cancellation semantics across runtimes deferred.
- **Cat IX cf #3** — Python adapter performance budgets deferred.
- **Cat IX cf #5** — enumerated error-code taxonomy deferred.
- **Bun-compat skipped tests** — 26 markers across 7 `packages/core/tests/` files; explicit M10 unit.
- **process-extract Python mirror** — deferred; LLM-call complexity not appropriate for M9 demo.
- **ADR IX-6 formalization** — idempotencyKey wire shape; formalize in M10.

---

## Non-goals (explicit — reject in review if raised)

- PyPI publishing in M9 (`uv publish`; defer to M10).
- `decode_result()` TS-side refactor (already shipped in M8).
- OTel Python kit-side shim (per ADR IX-4; reference adapter demonstrates direct SDK usage).
- `signal.aborted` / `memory` crossing the wire (only `idempotencyKey` in M9).
- Bun-compat skipped test fixes (carry to M10; 26 markers unchanged).
- `packages/core/src/wire/lsp-frame.ts` 456-LOC refactor (under 500 hard limit; premature).
- Additional Python adapters beyond Unit 3 single reference (process-classify only).
- `process-extract` Python mirror.

---

## Changeset guidance

```bash
pnpm changeset
# Select: @idriszade/cli (patch — new discriminated-union fixture + snapshot)
# Summary: "M9: add discriminated-union Zod fixture + Pydantic snapshot for codegen CI gating"
```

Wave 2 (Unit 6) and Python package changes generate no changeset. Python package has no `package.json`.

---

## Verification gates

All 8 must be green before M9 ship:

```bash
pnpm typecheck                                   # Gate 1
pnpm biome check . --max-diagnostics=500         # Gate 2 (NOT pnpm lint — see feedback_biome_lint_vs_check)
pnpm test                                        # Gate 3 — Vitest 1373+ passing
pnpm build                                       # Gate 4
pnpm format                                      # Gate 5
uv run --frozen pytest packages/adapter-python-process/  # Gate 6 (NEW)
pnpm --filter @idriszade/cli build && node packages/cli/dist/index.js gen-py-schema \
  --in packages/cli/fixtures/wire-schemas/sample-error-frame.ts \
  --out packages/cli/fixtures/wire-schemas/__snapshot__/sample-error-frame.py --check  # Gate 7 (NEW)
# Gate 8: .github/workflows/ci.yml test-python job green on PR (verified via gh run view)
```

Risk: `pk` CLI dev-env invocation (`pnpm exec pk`) broken per research note open question. Use `node packages/cli/dist/index.js` shim for Gate 7.

---

## Working rules (BINDING)

- **Model routing:** sonnet = CRUD/tests/scaffolding; haiku = trivial git lookups; opus = judgment-heavy design. Always pass `model:` explicitly.
- **Parallel dispatch:** Wave 1a = 2 parallel Agent calls; Wave 1c = 2 parallel after Unit 3 lands.
- **Brain never writes inline:** all file mutations via sonnet-executor subagents.
- **Branch discipline:** all subagents bound to `m9-python-adapter` explicitly.
- **Biome check before every commit:** `pnpm biome check . --max-diagnostics=500` (NOT `pnpm lint`).
- **NPM_TOKEN preserved:** do NOT remove `NODE_AUTH_TOKEN` from `release.yml` in M9; dual auth until TP-OIDC proof lands.
- **File-size limits:** 300 LOC soft, 500 LOC hard (TS files); Python LOC budgets per unit drilldown.
- **No `any` in TS stage signatures.** `Result<T,E>` at all public stage boundaries.
- **Fake-timer constraint:** pin system time + advance ≤ 2_000ms per step (per `feedback_fake_timer_gha_flake`).
- **Changeset required:** for `@idriszade/cli` patch only.
- **Out-of-scope files untouched:** `.claude/commands/brain.md`, `.claude/projects/`, `.clone/`.

---

## Report-back format

On completion, executor writes `docs/briefs/m9_report_back.md` with:
- Commits table (hash + description, one row per commit).
- Per-unit summary paragraph.
- Gates table (gate name / status / detail).
- Package bumps table.
- Carry-forwards (new from M9 + outstanding from M8+ earlier).
- TP-OIDC status (Phase 1 complete / Phase 2 pending user OTP / Phase 3 verified or deferred).

---

*M9 brief locked 2026-05-23. Cut `m9-python-adapter` from `7640603`. Confirm 1373+2 test baseline green before Wave 1a.*
