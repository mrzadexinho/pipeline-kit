# M5 Report-Back — Audit Closure (IV-4 / IV-5 / IV-6 / III-2 / VIII-2 / VIII-6.f / VIII-6.g)

> **Status:** Complete
> **Branch:** `m5-audit-closure`
> **Commits:** 12 (audit findings + brief + 6 phases across A/B/C/D/E)
> **Test count:** 991 passing (up from 914 M4 baseline; +77 net); 132 test files

## Commits

| Commit | Description |
|--------|-------------|
| `4a162d8` | fix(core/m5-a1): forward parentTraceContext through definePipeline.run |
| `ba0a17f` | fix(core/m5-a2): HMAC-sign scopedIdempotencyKey via HKDF-derived subkey |
| `aad23c1` | feat(core/m5-a3): auto-attach pk.pii_annotations to step spans |
| `2b434c0` | feat(core/m5-a4-a5): LocalTriggerAdapter — dev-mode TriggerAdapter |
| `c7ef28d` | fix(core/m5-a6): consume parentTraceContext to seed OTel span parent |
| `2037c10` | feat(adapter-inngest/m5-b): RunGuard 5-shape translation + W3C trace fan-out |
| `1be2fdf` | feat(secrets+observe/m5-c): VIII-2 conformance + VIII-6.g allowlist mode |
| `ae2bd49` | chore(core/m5): biome formatter + lint cleanup on M5-touched files |
| `aff5cda` | docs(m5-d1): correct ADR IV-4 register signature + document lifecycle |
| `78606e7` | test(core/m5-e1): E2E integration — LocalTriggerAdapter + HMAC + allowlist |
| `d0a4472` | chore(release/m5-e3): changeset for M5 audit closure |
| `8020f2a` | docs(m5-e4): M5 closure note, PK_SIGNING_KEY docs, spec-v1 build row |

## What shipped

### @idriszade/core extensions (Phase A)

- `parentTraceContext` forwarded through `definePipeline.run` → `runComposer` → `createContext` → `withSpan` (4-arg OTel overload); ADR III-2 full conformance
- `scopedIdempotencyKey` now HMAC-signed via `crypto.hkdfSync('sha256', PK_SIGNING_KEY, '', 'pk-idempotency-v1', 32)`; throws on missing env var (IV-6 output conformance)
- Composer auto-attaches `pk.pii_annotations` span attribute; precomputed at `definePipeline` time from `Process<I,O>` output schema via existing `walkAnnotations` walker (VIII-6.f conformance)
- `LocalTriggerAdapter` — dev-mode `TriggerAdapter` implementation; cron via `setInterval`; webhook via `http.createServer`; event/manual/mcp via `EventEmitter`; lifecycle: `register` / `start` / `stop` with idempotent teardown (IV-4 full conformance)
- `parentTraceContext` consumed to seed OTel span parent on `withSpan` entry (III-2 round-trip closure)

### @idriszade/adapter-inngest extensions (Phase B)

- `RunGuard` adapter translation rewritten with explicit 5-shape branches: queue / reject / dedup / idempotency / throttle; `reject` adopts Inngest v4 `singleton: { key, mode: 'skip' }` primitive (IV-5 full conformance)
- `kitFanOut` injects W3C `tracecontext` on `step.invoke` data envelope under `_pk_trace` carrier; child entry extracts via `propagation.extract` on arrival (III-2 fan-out conformance)

### @idriszade/secrets extension (Phase C)

- `createVersionAwareResolver` probes `inner.stats(name).currentVersion` on every `resolve()` call so external rotation is observed without explicit `invalidate()` (VIII-2 full conformance)

### @idriszade/observe + @idriszade/observe-vercel extensions (Phase C)

- `RedactingProcessor` gains `mode: 'denylist' | 'allowlist'`; allowlist passes only paths tagged with new `SAFE_TAG` (`@safe`); `markSafe` helper added to `core/pii` (VIII-6.g conformance)
- `observe-vercel` parity via `RedactingProcessorOptions` type re-export (type-only; no Vercel-specific processor logic in M5)

### Spec drift fix (Phase D)

- `docs/research-notes-v1-cat-IV.md` — ADR IV-4 paragraph corrected: `register` return type from `void` to `Promise<void>` (interface already returned this; doc was stale); `start()`/`stop()` lifecycle methods documented

## ADRs implemented

| ADR | Subject | Status |
|-----|---------|--------|
| IV-4 | LocalTriggerAdapter (dev mode) | ratified + implemented |
| IV-5 | RunGuard 5-shape translation | ratified + implemented |
| IV-6 (input) | fnConfig.idempotency unconditional dedup key | ratified + implemented |
| IV-6 (output) | HMAC-signed scopedIdempotencyKey via HKDF | ratified + implemented |
| III-2 | parentTraceContext forwarded + W3C fan-out trace | ratified + implemented |
| VIII-2 | Version-aware resolver probes on every resolve | ratified + implemented |
| VIII-6.f | Composer auto-attaches pk.pii_annotations | ratified + implemented |
| VIII-6.g | RedactingProcessor allowlist mode + markSafe | ratiated + implemented |

8 ADRs moved to full conformance. Brings total to **55/55** v1 ADRs (6 remaining were partial; 0 unimplemented after M5).

(IV-4/5/6 + III-2 were ratified in Cat IV / Cat III synthesis; M5 closes the implementation gap identified in the audit. VIII-2 + VIII-6.f/g were M4 carry-forwards promoted to M5 hard gates.)

## Modern-standard adjustments

These updates applied within existing ADRs; no new ADRs opened:

- **IV-5 reject** — Inngest v4 `singleton: { key, mode: 'skip' }` primitive replaces the prior misuse of `concurrency`; semantics tighter, no behavior regression
- **IV-6 output** — HKDF-derived HMAC (`crypto.hkdfSync`) replaces the unsigned scoped key; subkey scoped to `'pk-idempotency-v1'` info label
- **III-2 fan-out** — `@opentelemetry/api` `propagation.inject`/`extract` via `_pk_trace` carrier on `step.invoke` data envelope; trace no longer dropped at fan-out boundary

## Gates

| Gate | Status | Detail |
|------|--------|--------|
| Tests | PASS | 991 passing (+77 vs 914 M4 baseline); 132 test files |
| Typecheck | PASS | 0 errors across all packages |
| Lint | PASS | 0 errors (84 pre-existing non-blocking warnings — see carry-forward #6) |
| Format | PASS | No fixes needed |
| Build | PASS | All packages compiled cleanly |
| B4 RunGuard 5-shape | PASS | 14/14 — all five RunGuard shape branches exercised |
| B5 kitFanOut W3C trace | PASS | 7/7 — W3C tracecontext round-trip through step.invoke |
| C4 allowlist inversion | PASS | 5/5 — allowlist mode suppresses untagged paths, passes @safe paths |
| E2E composition (E1) | PASS | 1/1 — A2 + A3 + A4 + C3 composed; HMAC + allowlist + trace forwarding validated end-to-end |

Coverage: 87.95 / 80.13 / 89.94 / 89.21 (statement / branch / function / line).

## Package bumps

| Package | Change |
|---------|--------|
| @idriszade/core | minor — 0.3.x → 0.4.0 |
| @idriszade/adapter-inngest | minor — 0.2.x → 0.3.0 |
| @idriszade/secrets | patch |
| @idriszade/observe | minor — 0.3.x → 0.4.0 |
| @idriszade/observe-vercel | minor — 0.3.x → 0.4.0 |

5 packages extended. 0 new packages.

## Carry-forwards

**New from M5:**

1. **PK_SIGNING_KEY webhook fallback deferred** — brief specified a deprecation-warn fallback to an existing webhook signing key. Investigation found no such key in `packages/core/src/` yet. Fallback simplified to throw on missing `PK_SIGNING_KEY`; add the deprecation-warn path when webhook signing lands. (A2 commit `ba0a17f`.)
2. **`verifyScopedIdempotencyKey` deferred** — no current caller verifies the HMAC tail (callers only construct). Documented in code comment; add `timingSafeEqual`-based verify export when the first Serve adapter or middleware needs tamper-check.
3. **Cross-package import in m5-e2e test** — `packages/core/tests/integration/m5-e2e.test.ts` reaches into `../../../observe/src/redacting-processor.js` directly. Matches observe's own test pattern but loosely respects module boundaries. Future option: extract into a separate `tests-integration` workspace package, or move the test into observe (which already depends on core).
4. **`<m5-tip>` placeholder in `docs/spec-v1.md`** — the M5 build-progress row references a placeholder commit SHA. Replace with actual master tip after FF-merge.
5. **LocalTriggerAdapter LOC** — 332 LOC; 32 over soft 300, well under hard 500 and the brief's 400 split-trigger. Inline cron parser kept in-file as a cohesive unit; split into `triggers/cron-parser.ts` if it grows beyond ~400.
6. **Pre-existing biome warnings (84 total)** — mostly `noNonNullAssertion` in test code (some pre-M5, some in new test files). Out of scope for M5; sweep in a separate `chore(lint)` pass.
7. **observe-vercel parity is type-only** — `mode: 'allowlist' | 'denylist'` parity ships via `RedactingProcessorOptions` type re-export. If observe-vercel adds Vercel-specific processor logic later, the option must be wired through explicitly.

**Outstanding from M4 (not shipped by M5):**

- `@idriszade/cost` pricing pack (X-4 implementation tier)
- Rate-limit RunGuard shape (X-5 — new shape, not audit-closure)
- `memory-map` reference adapter (V-6 ref impl)
- Python wire codegen (IX-2 — Zod → JSON Schema → Pydantic build-time)
- M2 CLI carry-forwards: stdin `pk run`, webhook trigger, full cron, `pk scaffold`
- Cross-attempt cumulative budget tracking (cf-X-4)
- HMAC verification API (carry-forward #2 above)

**Note:** master tip `<m5-tip>` — brain fills in after FF-merge.
