# Brief — M5 Audit Closure (5 package extensions, 0 new packages)

> **Summary:** Close the audit gap surfaced by the M5 brain audit on IV-4 / IV-5 / IV-6 / III-2 + three small VIII-2/VIII-6 polish items. 0 new packages; 5 extended. 8 in-scope items across 5 phases. No new ADRs — implementation closure of existing ratified ADRs with two modern-standard adjustments (Inngest `singleton` primitive, HKDF-derived HMAC, OTel W3C propagation API).

> **Branch:** `m5-audit-closure`
> **Author (brain):** 2026-05-20
> **Estimated executor effort:** 18-26 hours (2 sessions)
> **Status:** Ready for executor pickup after audit findings FF-merge to master.
> **Predecessor:** M4 shipped at `87aaacd` + lint fix at `1b430b2`; audit findings at `57000fb` on `m5-audit`.
> **Scope:** Closes IV-4, IV-5, IV-6, III-2 to full implementation. Closes VIII-2 conformance + VIII-6.f auto-attach + VIII-6.g allowlist mode. 0 new ADRs.

## Anchor

M5 is the first milestone whose work was triggered by a brain audit rather than a forward-spec'd milestone brief. Outcome of `docs/briefs/m5_audit_findings.md`: 0/4 audit-target ADRs fully shipped. M5 brings them to conformance with the spec while adopting three modern-standard adjustments — surfaced as adapter-level changes, not API surface changes.

## What M5 ships

- **`@idriszade/core` extension** — `LocalTriggerAdapter` (dev-mode `TriggerAdapter` via `setInterval` cron + native Node `http.createServer` webhook + in-memory bus for `event`/`manual`/`mcp`); HKDF-derived HMAC `scopedIdempotencyKey`; `parentTraceContext` forwarded in `define-pipeline.ts`; Composer auto-attaches `pk.pii_annotations` to atom metadata by walking Process Zod schema at `definePipeline` time.
- **`@idriszade/adapter-inngest` extension** — `buildFunctionConfig` rewritten: adopts Inngest `singleton: { key, mode: 'skip' }` primitive for `overflow:'reject'`, plain `concurrency: [{ limit }]` for `overflow:'queue'`, `idempotency: 'event.data.dedupKey'` unconditional, `dedup.period` forwarded to `throttle`; `kitFanOut` injects OTel W3C trace context into each `step.invoke` data payload under reserved key `_pk_trace`.
- **`@idriszade/secrets` extension** — `createVersionAwareResolver` adds per-resolve `inner.stats(name).currentVersion` probe so external rotation is observed without explicit `invalidate()` call (VIII-2 conformance).
- **`@idriszade/observe` extension** — `RedactionMode = 'denylist' | 'allowlist'`; allowlist mode emits only paths tagged `.meta({ pii: 'safe' })`, redacts everything else (VIII-6.g).
- **`@idriszade/observe-vercel` extension** — allowlist-mode parity.

## Package surface

| Package | Tier | New / Extend | Version |
|---------|------|-------------|---------|
| `@idriszade/core` | 1 | extend | 0.3.x → 0.4.0 |
| `@idriszade/adapter-inngest` | 3 | extend | 0.2.x → 0.3.0 |
| `@idriszade/secrets` | 1 | extend (patch) | patch |
| `@idriszade/observe` | 2 | extend | 0.3.x → 0.4.0 |
| `@idriszade/observe-vercel` | 2 | extend (parity) | 0.3.x → 0.4.0 |

0 new packages. Adapter-translation behaviour change in `adapter-inngest` (`overflow:'reject'` semantics correction) is a behavioural fix, not a type-level break — handle as a minor bump per kit's pre-1.0 stance.

## Implementation locks (per ADR — modern-standard adjustments noted)

### IV-4 — Dev-mode TriggerAdapter

- Lives at `packages/core/src/triggers/local-trigger-adapter.ts`. Exported from core index.
- `kind: 'cron'` → `setInterval` driven by cron expression. For M5: support 5-field cron expressions only (no special chars like `@yearly`); use the existing `parseCronExpression` helper if present, else a minimal parser inline. No new dep.
- `kind: 'webhook'` → `http.createServer` (Node built-in); single port, path-matched dispatch; bind to `127.0.0.1` by default; configurable via `LocalTriggerAdapterOptions.port` + `host`.
- `kind: 'event'` / `kind: 'manual'` / `kind: 'mcp'` → in-memory event bus (`EventEmitter`).
- `register()` returns `Promise<void>`; `start()` opens HTTP + scheduler; `stop()` closes both with `unref()` for clean test teardown.
- Spec drift fix to `docs/research-notes-v1-cat-IV.md` ADR IV-4 paragraph: update return type to `Promise<void>`; document `start()` / `stop()` lifecycle methods.

### IV-5 — RunGuard adapter translation rewrite

- `buildFunctionConfig` in `packages/adapter-inngest/src/create-kit-function.ts` rewritten with explicit branches per RunGuard shape.
- `overflow:'queue'` (default when concurrency.limit set): `concurrency: [{ limit }]` — no key. Inngest queues extras at the function level.
- `overflow:'reject'`: `singleton: { key: 'event.data.pipelineId', mode: 'skip' }` — Inngest v4 primitive; rejects new runs while one is in flight per key.
- `dedup` with period: `throttle: { limit: 1, period: <dedup.period>, key: 'event.data.dedupKey' }` — period now forwarded.
- Add `packages/adapter-inngest/README.md` translation table documenting all 5 RunGuard shapes → Inngest config mappings.

### IV-6 — Full pipeline idempotency, both sides

- **Input side:** in `buildFunctionConfig`, set `fnConfig.idempotency = 'event.data.dedupKey'` UNCONDITIONALLY (Inngest treats undefined expression result as no-dedup; safe). Removes the `runGuard.dedup` gate. Independent of throttling.
- **Output side:** rewrite `packages/core/src/composer/idempotency.ts`. `scopedIdempotencyKey(scope)` now returns `<runId>:<serveAdapterId>:<atomId>:<hmac>` where `<hmac>` is HMAC-SHA256(derived, scopeStr).digest('hex').slice(0,16).
- Key derivation: `crypto.hkdfSync('sha256', master, salt='', info='pk-idempotency-v1', 32)`. Master from `process.env.PK_SIGNING_KEY`. Fallback: if unset, read existing webhook signing key path with one-time `console.warn` at first use (deprecation channel).
- Verification path (if any) uses `crypto.timingSafeEqual` for HMAC comparison.
- Document `PK_SIGNING_KEY` in core README + add to env-validation docs in `secrets-env` README.

### III-2 — parentTraceContext threading

- `packages/core/src/define-pipeline.ts:61-67`: forward `options.parentTraceContext` into the inner `pipeline.run()` RunOptions object. No-op for callers not setting it.
- `packages/adapter-inngest/src/kit-fan-out.ts`: before each `step.invoke`, call `propagation.inject(context.active(), carrier)` from `@opentelemetry/api`; pass child invocation as `step.invoke(id, { function, data: { _pk_trace: carrier, payload: item } })`.
- New helper `extractParentTraceContext(eventData)` in core, exported, called by `mapInngestContext` to restore parentTraceContext on child kit-function entry from the `_pk_trace` carrier in `event.data`.
- Use `@opentelemetry/api`'s existing propagator (already a transitive dep via observe). Add a direct dep on `@opentelemetry/api` to `adapter-inngest` and `core` if not already present.

### VIII-2 — `createVersionAwareResolver` per-resolve version probe

- `packages/secrets/src/version-aware.ts`: on every `resolve(name)` call, query `inner.stats(name).currentVersion`. If cached version differs, evict cache entry and re-resolve. Conformance to Cat VIII synthesis text (was previously cache-until-invalidate only).

### VIII-6.f — Composer auto-attach `pk.pii_annotations`

- Composer (`packages/core/src/composer/*`): at `definePipeline` time, walk the Process input/output Zod schema using Zod 4 `.meta()` introspection. Build a path → `'@redact' | '@secret' | 'safe'` map. Attach to atom metadata under `pk.pii_annotations` field at run time. No user-side manual step required.

### VIII-6.g — Allowlist redaction mode

- `packages/observe/src/redacting-processor.ts`: extend with `mode: 'denylist' | 'allowlist'` (default `'denylist'` — preserves current behaviour).
- Allowlist mode: emit only paths tagged `.meta({ pii: 'safe' })`; redact (or hash) all other values per attribute type. Annotation walker reused; semantics inverted via mode flag.
- Vercel parity: same flag exposed from `observe-vercel`.

## Tasks (22 total across 5 phases)

**Phase A — core extensions (serial; unblocks B + C + D):**

| # | File | Key constraint | ADR |
|---|------|---------------|-----|
| A1 | `packages/core/src/define-pipeline.ts:61-67` | Forward `parentTraceContext` into inner `pipeline.run()` RunOptions | III-2 |
| A2 | `packages/core/src/composer/idempotency.ts` | HKDF-derived HMAC scoped key; `PK_SIGNING_KEY` env + webhook-key fallback w/ deprecation warn | IV-6 (output) |
| A3 | `packages/core/src/composer/pii-attach.ts` (new) | Walk Process Zod schema at definePipeline; build path map; attach as `pk.pii_annotations` on atom metadata | VIII-6.f |
| A4 | `packages/core/src/triggers/local-trigger-adapter.ts` (new) | `LocalTriggerAdapter implements TriggerAdapter` — setInterval cron + http webhook + EventEmitter bus | IV-4 |
| A5 | `packages/core/src/triggers/local-trigger-adapter.test.ts` (new) | Tests for all 5 `TriggerConfig.kind` cases under local mode; teardown via `stop()` | IV-4 |
| A6 | Unit tests for A1, A2, A3 | + integration test: pipeline with `parentTraceContext` → child run RunResult carries inherited traceId | III-2 / IV-6 / VIII-6.f |

Acceptance: typecheck + 914-test baseline green + ~40 new tests.

**Phase B — adapter-inngest rewrite (depends on A; serial within B):**

| # | File | Key constraint | ADR |
|---|------|---------------|-----|
| B1 | `packages/adapter-inngest/src/create-kit-function.ts` | Rewrite `buildFunctionConfig` per 5-shape table: queue→concurrency[]; reject→singleton; dedup→throttle (period fwd); idempotency unconditional | IV-5 / IV-6 (input) |
| B2 | `packages/adapter-inngest/src/kit-fan-out.ts` | OTel `propagation.inject` into `step.invoke` data envelope under `_pk_trace`; payload wrapped as `{ _pk_trace, payload }` | III-2 |
| B3 | `packages/adapter-inngest/src/context-mapping.ts` | On child entry, `propagation.extract` from `event.data._pk_trace`; populate `RunOptions.parentTraceContext`; unwrap payload | III-2 |
| B4 | `packages/adapter-inngest/test/run-guard-shapes.test.ts` (new) | Conformance tests for all 5 named shapes against Inngest config output | IV-5 |
| B5 | `packages/adapter-inngest/test/fan-out-trace.test.ts` (new) | Integration: parent invokes 3 children via kitFanOut; each child run sees parent traceId in active span | III-2 |
| B6 | `packages/adapter-inngest/README.md` | Translation table: 5 RunGuard shapes → Inngest primitives mapping | IV-5 |

Acceptance: B4 + B5 hard-gate the milestone (see Section 7).

**Phase C — secrets + observe polish (parallel with B after A; C tasks independent):**

| # | File | Key constraint | ADR |
|---|------|---------------|-----|
| C1 | `packages/secrets/src/version-aware.ts` | Per-resolve `inner.stats(name).currentVersion` probe; cache eviction on mismatch | VIII-2 |
| C2 | `packages/secrets/src/version-aware.test.ts` | Test: external rotation detected without explicit `invalidate()` | VIII-2 |
| C3 | `packages/observe/src/redacting-processor.ts` | `mode: 'denylist' \| 'allowlist'` option; allowlist requires `.meta({ pii: 'safe' })` tag | VIII-6.g |
| C4 | `packages/observe/test/redacting-processor.allowlist.test.ts` (new) | Test: allowlist mode emits only safe-tagged attributes; others show `<redacted:N>` or `<secret:<8hex>>` | VIII-6.g |
| C5 | `packages/observe-vercel/src/index.ts` | Re-export allowlist mode from vercel parity layer | VIII-6.g |

**Phase D — spec drift fix (parallel with B + C):**

| # | File | Key constraint | ADR |
|---|------|---------------|-----|
| D1 | `docs/research-notes-v1-cat-IV.md` ADR IV-4 paragraph | Update `register()` return type to `Promise<void>`; document `start()` / `stop()` lifecycle methods | IV-4 |
| D2 | `docs/spec-v1.md` build-progress table | M5 row added: "5 (audit closure)" — IV-4, IV-5, IV-6, III-2 from partial→implemented; VIII-2 conformance; VIII-6.f + VIII-6.g now implemented | meta |

**Phase E — wire + ship (serial; depends on B + C + D):**

| # | Task | Key constraint |
|---|------|---------------|
| E1 | E2E integration test | Pipeline runs locally via `LocalTriggerAdapter` cron trigger; HMAC idempotency key visible in serve log; allowlist redaction observed on span. Hard gate. |
| E2 | `pnpm biome check . --max-diagnostics=500` | M4 LEARNING — biome lint ≠ biome check; check is what CI runs. Run BEFORE commit, not after. |
| E3 | Changesets | `pnpm changeset` for all bumped packages; commit `.changeset/*.md` |
| E4 | Root README + docs update | Note M5 closure; link audit findings doc; document `PK_SIGNING_KEY` env |
| E5 | Gates verification | typecheck / test (970+ target) / biome check / build / coverage all green |
| E6 | Report-back doc | `docs/briefs/m5_report_back.md` — executor writes on completion |

## Sequencing

```
A1 → A2 → A3 → A4 → A5 → A6
                              ↓
                  B1 → B2 → B3 → B4 → B5 → B6   ∥   C1 → C2 ∥ C3 → C4 → C5   ∥   D1 ∥ D2
                                                    ↓
                                              E1 → E2 → E3 → E4 → E5 → E6
```

## Gates (5 standard + 3 M5-specific hard gates)

```
pnpm typecheck / pnpm biome check . --max-diagnostics=500 (NOT pnpm lint) / pnpm test / pnpm test:types / pnpm build
```

M5 hard gate 1 (B5): kitFanOut OTel propagation integration test MUST show parent traceId on child run's active span. Test fails = milestone blocked.

M5 hard gate 2 (B4): all 5 RunGuard shapes pass conformance tests against Inngest config output. Each shape produces the documented primitive (concurrency[], singleton, throttle, idempotency).

M5 hard gate 3 (C4): allowlist redaction integration test shows ONLY safe-tagged attributes; all non-tagged values redacted/hashed. Inversion of denylist behaviour verified.

Test count target: **970+** (914 M4 baseline + ~25 Phase A + ~20 Phase B + ~10 Phase C + ~3 Phase E).

## ADR coverage

| ADR | Covered by | Status delta |
|-----|-----------|--------------|
| IV-4 TriggerAdapter dev/prod seam | A4, A5, D1 | partial → implemented |
| IV-5 RunGuard 5 shapes | B1, B4, B6 | partial → implemented (modern-standard: singleton primitive) |
| IV-6 Full pipeline idempotency | A2, B1, E1 | partial → implemented (modern-standard: HKDF-derived HMAC) |
| III-2 parentTraceContext threading | A1, B2, B3, B5 | not-shipped → implemented (modern-standard: OTel W3C propagation API) |
| VIII-2 createVersionAwareResolver conformance | C1, C2 | partial conformance → full conformance |
| VIII-6.f Composer auto-attach pii annotations | A3, A6 | candidate → implemented |
| VIII-6.g Allowlist redaction mode | C3, C4, C5 | candidate (deferred from M4) → implemented |

7 ADRs / micro-ADRs move to implemented. Build-progress total moves from 47/55 → 49/55 (IV-4, IV-5, IV-6, III-2 already counted as implemented before audit; M5 closes the conformance gap on those + adds VIII-6.g, VIII-6.f, VIII-2-conformance net-new).

> Note on accounting: the 8/55 unimplemented count was measured against the spec's "ratified+implemented" criterion. M5's audit closure tightens conformance on the 4 audit-target ADRs (already counted) and ships 3 net-new closures. The numeric gap moves 8/55 → 6/55.

## Out-of-scope (carry to M6+)

- V-6 `memory-map` reference adapter
- X-4 `@idriszade/cost` pricing pack
- X-5 rate-limit RunGuard shape (new shape, not audit-closure)
- IX-2 Python wire codegen (cross-runtime, separate milestone)
- M2 CLI carry-forwards: stdin `pk run`, webhook trigger, full cron, `pk scaffold` — DX-focused milestone candidate
- cf-X-4 cross-attempt cumulative budget tracking
- HMAC verification API (if needed for inbound serve-adapter idempotency check) — design defer until first consumer

## Working rules carry-over

- **Before any commit landing on master:** `pnpm biome check . --max-diagnostics=500` (M4 cost a full re-publish cycle skipping this).
- **Changesets 2-step publish flow:** expect ≥2 GHA `release.yml` runs per milestone push (Version PR + publish on merge). See `feedback_changesets_two_step_publish.md`.
- **Subagent model routing:** always pass `model:` explicitly on Agent calls.
- **Branch hygiene:** cut `m5-audit-closure` from `master` AFTER audit findings FF-merge lands; ensure `1b430b2` is pushed first.

---

*M5 brief locked 2026-05-20. 5 package extensions. 0 new packages. 7 ADR closures. Adopts Inngest singleton primitive + HKDF HMAC + OTel W3C propagation.*

## Ready for executor session

Fresh executor session should invoke `superpowers:executing-plans` against this brief. Confirm 914-test baseline green before starting Phase A. Phases B + C + D dispatch in parallel after A6 completes.
