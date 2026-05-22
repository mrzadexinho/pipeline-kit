# Brief — M8 Cross-Runtime Wire Module (entry)

> **Summary (decisions front-loaded):**
> - Unit 1: NEW `packages/core/src/wire/` framing module — NDJSON + LSP Content-Length encoders/decoders, canonical JSON (RFC 8785), RFC-3339 millisecond-precision timestamp validator, `decode_result` helper, W3C Trace Context wire integration; ~600–900 LOC across 7–9 files; ships ADR IX-1 + closes wire surface for IX-3 + IX-4.
> - Unit 2: `@idriszade/cli` extension — `pk gen-py-schema --in <zod-source> --out <pydantic-file>` subcommand; sample schema + smoke test + regen-stability CI check; ships ADR IX-2.
> - Unit 3: Wire spec docs — `packages/core/src/wire/README.md` + `docs/api-surface/wire.md`; kit-internal protocol reference.
> - Unit 4: TP-OIDC 404 diagnosis prep — `.github/workflows/oidc-token-debug.yml` + `scripts/npm-trust-introspect.sh` + `docs/development/tp-oidc-claim-diagnosis.md`; closes M7 carry-forward (user-gated; executor preps only).
> - Wave 1 (parallel): Units 1 + 4. Wave 2 (after Unit 1 lands; parallel internal): Units 2 + 3.
> - ADRs after M8: IX-1 SHIPPED → 54/55 → **55/55**. IX-2 SHIPPED as separate impl-tooling (does not move the 55-count; flag for brain reconciliation at M8 close).
> - New packages: 0 (all extensions). Extended: `@idriszade/core` (minor — new wire export surface), `@idriszade/cli` (minor — new gen-py-schema subcommand).
> - Version bumps: `@idriszade/core` minor; `@idriszade/cli` minor.

**Branch:** `m8-wire-framing`
**Author (brain):** 2026-05-22
**Estimated executor effort:** 38–50 hours (3–4 sessions)
**Status:** Ready for executor pickup. Cut `m8-wire-framing` from master tip `cbbd048`.
**Predecessor:** M7 shipped + published 2026-05-22; master tip `cbbd048` (post-M7 cleanup; 21 commits ahead of pre-M7 `805bac3`).

Per-unit detail in [`m8_executor_brief_units.md`](m8_executor_brief_units.md).

---

## State at M8 start

- Master tip: `cbbd048` (post-M7 + post-M7-cleanup).
- Tests: 1176 passing + 2 skipped at last green run.
- Coverage: 88.64 / 80.43 / 90.69 / 89.76 (stmt / branch / fn / line).
- ADRs: 54/55 — IX-1 is the only remaining 55-count item; IX-2 is impl-tooling tracked separately.
- Packages on npm: 33 `@idriszade/*` packages live with sigstore provenance attestations.
- npm Trusted Publishing: configured on all 33 packages but UNUSED — `NODE_AUTH_TOKEN` remains the active auth path; TP-OIDC 404 unresolved (Unit 4 prep).

## What does NOT exist yet (confirm before Wave 1)

- `packages/core/src/wire/` does NOT exist (verified `cbbd048`).
- `packages/cli/src/commands/gen-py-schema.ts` does NOT exist (verified — cli/src/commands/ contains only `dev.ts`, `inspect.ts`, `run.ts`, `trace.ts`).
- `docs/api-surface/wire.md` does NOT exist.
- `.github/workflows/oidc-token-debug.yml` does NOT exist.
- `scripts/npm-trust-introspect.sh` does NOT exist.

## What ALREADY exists (do not recreate)

- `packages/core/src/serializable-context.ts` exports `extractWireContext` + `injectWireContext` (W3C Trace Context plumbing per ADR IX-4 partial). The new wire module INTEGRATES with these; it does NOT recreate them.
- `packages/core/src/stage-error.ts` defines `StageErrorCode` (19-code stage-tier taxonomy). New wire-decode errors (`wire/malformed_line`, `wire/truncated_body`, `wire/unknown_header`, `wire/content_length_invalid`, `wire/result_ambiguous`, `wire/timestamp_sub_ms_precision`, `wire/integer_unsafe`) are SEPARATE from `StageErrorCode` — they live as `WireDecodeError` in `packages/core/src/wire/types.ts`.
- `packages/core/src/result.ts` exports `Result<T,E>` + `ok` + `err`. `decode_result` builds on top of this with a tagged-value transform per ADR IX-3.

---

## Package surface

| Package | Tier | New / Extend | Version bump |
|---------|------|--------------|--------------|
| `@idriszade/core` | 1 | extend (new wire module export) | minor |
| `@idriszade/cli` | 2 | extend (new `gen-py-schema` subcommand) | minor |

No new packages in M8.

---

## Scope — 4 units (one-liner table)

| Unit | Name | Detail |
|------|------|--------|
| 1 | IX-1 wire framing module | NDJSON + LSP Content-Length encoders/decoders + canonical JSON + RFC-3339-ms validator + `decode_result` helper + wire-mode trace-context wiring; see drilldown §unit-1 |
| 2 | IX-2 Python codegen pipeline | `pk gen-py-schema` CLI subcommand + Zod→JSON Schema→Pydantic v2 chain + regen-stability CI check + sample-schema smoke test; see drilldown §unit-2 |
| 3 | Wire spec docs | `packages/core/src/wire/README.md` (impl reference) + `docs/api-surface/wire.md` (kit-internal protocol spec); see drilldown §unit-3 |
| 4 | TP-OIDC 404 diagnosis prep | Diagnostic GHA workflow + `npm trust list --json` introspect script + claim-diff recipe doc (user-gated; executor preps only); see drilldown §unit-4 |

---

## Wave sequencing

```
Wave 1 (2 parallel sonnet-executor subagents — fully independent):
  ├─ Unit 1: wire framing module   (packages/core/src/wire/)
  └─ Unit 4: TP-OIDC diagnosis prep (.github/workflows/ + scripts/ + docs/development/)

Wave 2 (after Unit 1 lands on m8-wire-framing; 2 parallel internal):
  ├─ Unit 2: gen-py-schema CLI subcommand  (packages/cli/src/commands/)
  └─ Unit 3: wire spec docs                (packages/core/src/wire/README.md + docs/api-surface/)
```

Dispatch Units 1 + 4 in a single orchestrator message as 2 parallel Agent calls. Wave 2 (Units 2 + 3) dispatches after Unit 1 commits to the `m8-wire-framing` branch — Unit 2 imports the wire surface; Unit 3 documents the same surface.

---

## ADR ledger after M8

| Item | Status after M8 |
|------|----------------|
| IX-1 (NDJSON + LSP wire) | SHIPPED — Unit 1 |
| IX-2 (Zod→JSON Schema→Pydantic codegen) | SHIPPED — Unit 2 (impl-tooling; tracks separate from 55-count) |
| IX-3 (`decode_result` + per-frame Result) | SHIPPED — Unit 1 (already drafted in v1 spec; M8 ships the kit impl) |
| IX-4 (W3C Trace Context, out-of-band) | SHIPPED — Unit 1 surfaces NDJSON metadata mode + LSP header mode (extending the already-shipped `extractWireContext` / `injectWireContext`) |
| IX-5 (kit owns wire spec; MCP/A2A at adapter tier) | NO KIT-IMPL REQUIRED — already ratified in Phase 2 spec; Unit 3 documents the delegation pattern for adapter authors |
| M7 cf TP-OIDC 404 | DIAGNOSIS PREP COMPLETE — Unit 4 ships diagnostic tools; actual fix gated on user OTP execution |

ADR count: 54/55 → **55/55** after Unit 1 closes IX-1's kit-impl. IX-2 + IX-3 + IX-4 + IX-5 were ratified in the Phase 2 spec lock (already in the 55-count); M8 ships their kit-side impls — no count delta from those four. NOTE: M7 brief used "54/55 (IX-1 + IX-2 remain)" which is off-by-one; the actual count post-M7 is 54/55 with only IX-1 unshipped — IX-2 was ratified in spec at Phase 2 close. M8 close-out report should restate the reconciled count.

---

## Carry-forwards expected into M9+

- **TP-OIDC 404 actual fix** — depends on Unit 4's diagnostic outputs being executed by the user (OTP-gated `npm trust list --json` capture + claim diff vs. GitHub OIDC token). Re-do `npm trust` with corrected permissions claim; remove `NODE_AUTH_TOKEN`; re-test.
- **First-real-cross-runtime-adapter** — exercises Unit 1 wire module + Unit 2 codegen pipeline end-to-end. Likely a Python `process-*` reference adapter. M10+.
- **M2 CLI gaps:** `pk run` stdin, webhook trigger, full cron parser (replace `parseCronExpression`), `pk scaffold`.
- **`observe-vercel` cost-event wiring** — if Vercel AI SDK pressure surfaces.
- **`@idriszade/memory-pgvector` pack** — semantic memory; V-6 non-goal carve-out for v1; deferred.
- **Per-package Trusted Publisher configuration drift discipline** — track when new packages added; document in `docs/development/trusted-publishing-setup.md`.

---

## Non-goals (out of scope for M8)

Per Cat IX synthesis carry-forwards (`docs/research-notes-v1-cat-IX.md` §"Open questions unresolved"):

- **PipelineContext crossing the full wire** (`signal.aborted`, `memory`, full `deps`) — Unit 1 ships only `SerializableContext` (runId, trace, idempotencyKey). Bidirectional control channel is M9+.
- **Cross-runtime cancellation semantics** — pipe-close → `signal.aborted` not in scope; covered by Cat VI cross-cut on a later spike.
- **Performance budgets** — per-atom serialise/parse cost, daemon-vs-spawn-per-batch, cold-start `uv run` tax all unmeasured. Defer to first-real-cross-runtime-adapter in M10+.
- **Bidirectional RPC / callbacks** — out of scope; opens MCP-tier delegation per ADR IX-5.
- **Cross-runtime error-code enumerated taxonomy** — `WireDecodeError` covers wire-tier; stage-tier `code` taxonomy (Cat IX cf #5) deferred to Cat VI follow-up.
- **Bindings (`pyo3` / N-API)** — out of scope per ADR IX-1 alternatives; kit stays library-tier.

If a unit acceptance criterion appears to require any of the above, STOP and escalate to brain.

---

## Risk flags

| Flag | Summary |
|------|---------|
| RF-1: LSP strict-header parser closes silent-pass | Per ADR-IX-1, LSP decoder MUST reject any non-`Content-Length:` line on the FIRST line of the header block. Diverges from LSP spec (which permits `Content-Type` etc.) — justified kit-internal divergence; DOCUMENT in `wire/README.md`. Closes spike-3 `flush=True` silent-pass class. |
| RF-2: Canonical JSON correctness | RFC 8785 has subtle edges (Unicode escape normalization, number-to-string for non-integers, surrogate-pair handling). Property test: `parse(stringify(x)) === x` AND `stringify(parse(stringify(x))) === stringify(x)` (idempotent). |
| RF-3: RFC-3339-ms rejection at boundary | Sub-millisecond fractional precision MUST be REJECTED (not silently truncated like Python `fromisoformat`). Spike-2 evidence: Python silently dropped ≥7-digit fractions; kit must fail loud with `wire/timestamp_sub_ms_precision`. |
| RF-4: Content-Length lying | Spike-3 B-4: `Content-Length: 100` + 50 body bytes catastrophically eats the next header. Decoder MUST validate `body.byteLength === Content-Length` and emit `wire/truncated_body`. Property test required. |
| RF-5: UTF-8 byte-vs-char | Spike-3 B-5 latent. Decoder MUST count UTF-8 bytes (`Buffer.byteLength(str, 'utf8')`), not chars (`str.length`). Test with non-ASCII payload (emoji + CJK). |
| RF-6: Number.MAX_SAFE_INTEGER overflow | Spike-1 finding: TS silently truncates Python ints above `Number.MAX_SAFE_INTEGER`. Wire boundary MUST reject integers > `Number.MAX_SAFE_INTEGER` with `wire/integer_unsafe`, OR codec converts to string-encoded BigInt at adapter author's option. |
| RF-7: `datamodel-code-generator` Python tool reliability | IX-2 codegen depends on a Python CLI invoked via `uv run --with 'datamodel-code-generator[http]'`. Pin minimum version + ship smoke test. If tool flakes, the regen-stability CI step gates the PR. |
| RF-8: IX-2 Zod feature gap | ADR-IX-2 consequence: Zod features without JSON Schema equivalents (`.refine`, `.transform`, `.brand()`) MUST be flagged at codegen time. Unit 2 emits a loud warning + exits non-zero. |
| RF-9: TP-OIDC user gating | Unit 4 produces diagnostic outputs ONLY. Actual fix requires user OTP elevation + `npm trust list --json` capture + claim diff. Executor MUST NOT attempt `npm trust` mutating commands. |

---

## Verification gates

```bash
pnpm typecheck                              # Gate 1
pnpm test                                   # Gate 2 — Vitest + fast-check (wire round-trip property tests)
pnpm biome check . --max-diagnostics=500    # Gate 3 — BINDING: check not lint
pnpm build                                  # Gate 4 — all packages emit dist/
# Gate 5 — coverage maintained: >= 88/80/90/89 aggregate (M7 baseline 88.64/80.43/90.69/89.76)
```

Test count target: **1240+** (1176 baseline + ~50 Unit 1 + ~10 Unit 2 + 0 Unit 3 + ~5 Unit 4).

M8 hard gates:
1. Unit 1: NDJSON round-trip property — `decodeNdjsonStream(encodeNdjsonStream(atoms))` equals `atoms` for any well-typed `atoms: Atom<T>[]`.
2. Unit 1: LSP round-trip + strict-parse — `decodeLspStream(encodeLspStream(atoms))` equals `atoms`; AND `decodeLspStream(<spike-3 flush=True corruption fixture>)` emits `wire/unknown_header` (NOT silent-pass).
3. Unit 1: Content-Length lying — decoder emits `wire/truncated_body` on hand-crafted under-bytes frame fixture.
4. Unit 1: RFC-3339-ms boundary — `validateTimestamp('2026-05-08T12:34:56.1234567Z')` returns `err({ code: 'timestamp_sub_ms_precision' })`; valid `toISOString()` form passes.
5. Unit 1: Canonical JSON idempotent — `stringify(parse(stringify(x))) === stringify(x)` property for any well-typed `x`.
6. Unit 1: `decode_result` narrows — `decode_result({data: null, error: null})` emits `wire/result_ambiguous` (typo guard for the convention-not-tag friction).
7. Unit 2: `pk gen-py-schema --in <fixture> --out -` emits Python parseable by `uv run python -m py_compile`.
8. Unit 2: Regen-stability — CI step exits 0 when committed Pydantic matches regenerated; non-zero on drift.
9. Unit 4: `scripts/npm-trust-introspect.sh @idriszade/core` executes (output may be empty per `feedback_npm_trust_list_lag`); `.github/workflows/oidc-token-debug.yml` dispatches manually + prints OIDC claims to log.

---

## Working rules (BINDING)

- **Model routing:** always pass `model:` explicitly (sonnet = executor/CRUD/tests; haiku = trivial git lookups; opus = judgment-heavy design).
- **Parallel dispatch:** Wave 1 = 2 parallel Agent calls in a single orchestrator message; Wave 2 = 2 parallel after Unit 1 lands.
- **Brain never writes inline:** all file mutations via sonnet-executor subagents.
- **Out-of-scope files untouched:** `.claude/commands/brain.md`, `.claude/projects/`, `.clone/`.
- **Biome check before every commit:** `pnpm biome check . --max-diagnostics=500` (NOT `pnpm lint`).
- **Fake-timer constraint:** pin system time + advance ≤ 2_000ms per step (per `feedback_fake_timer_gha_flake`).
- **File-size limits:** 300 LOC soft, 500 LOC hard.
- **`Result<T,E>` at all public stage boundaries.** No thrown errors crossing the API. Wire decoders return `Result<WireFrame, WireDecodeError>` per-frame.
- **No `any` in stage signatures.**
- **NDJSON encoder MUST emit canonical JSON (RFC 8785)** — sort keys, no whitespace.
- **LSP decoder MUST be strict** — reject unknown headers on the FIRST line of the header block.
- **All timestamps at wire boundary MUST be RFC 3339 millisecond-precision** — sub-millisecond rejected loud with `wire/timestamp_sub_ms_precision`.
- **All integers at wire boundary MUST be ≤ `Number.MAX_SAFE_INTEGER`** OR encoded as string (BigInt-style). Decoder emits `wire/integer_unsafe` on detected overflow.
- **Subagent branch discipline:** each subagent dispatch specifies `m8-wire-framing` explicitly (per `feedback_subagent_branch_discipline`).
- **Changeset required:** for `@idriszade/core` minor + `@idriszade/cli` minor.

---

## Changeset guidance

```bash
pnpm changeset
# Select: @idriszade/core (minor — new wire module export surface)
#         @idriszade/cli (minor — new gen-py-schema subcommand)
# Summary: "M8: cross-runtime wire framing module (IX-1); pk gen-py-schema codegen pipeline (IX-2); TP-OIDC 404 diagnosis prep"
```

2-step publish flow per `feedback_changesets_two_step_publish`: changeset merge opens Version Packages PR; merging that triggers publish. Expect 2+ `release.yml` runs.

---

## Report-back format

On completion, executor writes `docs/briefs/m8_report_back.md` with:
- Commits table (hash + description, one row per commit).
- Per-unit summary paragraph.
- ADRs implemented (table: ADR / subject / status delta).
- Gates table (gate name / status / detail).
- Package bumps table.
- Carry-forwards (new from M8 + outstanding from M7+earlier).

---

*M8 brief locked 2026-05-22. Cut `m8-wire-framing` from `cbbd048`. Confirm 1176+2 test baseline green before Wave 1.*
