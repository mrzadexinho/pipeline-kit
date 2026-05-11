# Spike #3 — concurrent-run-and-idempotency FINDINGS

> Spike: probe where deduplication and concurrent-run protection live in
> pipeline-kit's architecture: kit core, adapter layer, or runtime config.
> Directory: `research/spikes/cat-iv-trigger-orchestration/spike-3-concurrent-run-idempotency/`
> Branch: `master`. Author: Executor — 2026-05-10.
> Companion to: `docs/research-outline-v1.md` § Category IV (Trigger Orchestration).
> Status: spike output (NOT a notes file; brain synthesises `docs/research-notes-v1-cat-IV.md`).
> Friction anchor: `F-TRIGGER` + Cat IV Q3 (concurrent-run / dedup ownership).

---

## §1. SETUP

- **No Inngest dep** — kit-level structural probe (ownership boundary question, not runtime behavior)
- **Runtime:** Bun + TypeScript strict; ESM only
- **Node crypto module:** used for HMAC-SHA256 (Serve idempotency) + SHA-256 (dedup key hash)
- **Files:**
  - `src/types.ts` — dedup taxonomy types: `IdempotencyKey`, `DedupWindow`, `SingletonPolicy`, `ConcurrencyConfig`, `RunGuard`, `TriggerEvent<T>`
  - `src/probe-three-concerns.ts` — three-concern separation: concurrency / dedup / singleton
  - `src/probe-dedup-key-ownership.ts` — dedup key computation per trigger type + full pipeline idempotency
  - `src/probe-temporal-comparison.ts` — Temporal WorkflowIdReusePolicy mapped to kit + minimum viable RunGuard
  - `src/probe-kit-boundary.ts` — boundary map: kit-core / trigger adapter / adapter-inngest / runtime

**Run commands (after `bun install`):**

```bash
bun run src/probe-three-concerns.ts
bun run src/probe-dedup-key-ownership.ts
bun run src/probe-temporal-comparison.ts
bun run src/probe-kit-boundary.ts
```

All four probes run clean (confirmed).

---

## §2. OBSERVATIONS

### O1 — Three-concern separation CONFIRMED

[STRUCTURAL-PREDICTION — confirmed by code structure and output]

The three concerns are genuinely orthogonal with distinct semantics:

| Concern | Mechanism | Second trigger outcome | Owner |
|---|---|---|---|
| Concurrency control (queue) | `concurrency:{limit:1, overflow:"queue"}` | Queued — runs later | Runtime |
| Concurrency control (reject) | `concurrency:{limit:1, overflow:"reject"}` | Rejected immediately | Runtime |
| Deduplication | Idempotency key + window | Dropped — never runs | Trigger + Runtime |

Critical distinction that gets conflated in practice:
- `concurrency=1 + overflow:queue` = "run sequentially, never skip" — NOT dedup
- `concurrency=1 + overflow:reject` = "true singleton, skip overlapping" — singleton via concurrency
- `dedup key + window` = "drop identical events, never re-run" — actual dedup

All three are kit-tier: runtime-enforced. Kit-core only declares intent (RunGuard config shape).

---

### O2 — Dedup key ownership: trigger/runtime layer CONFIRMED

[STRUCTURAL-PREDICTION — confirmed; pattern holds across all trigger types]

The dedup key is computable at the input boundary, BEFORE the pipeline runs, in all cases:

| Trigger type | Dedup key source | Owner |
|---|---|---|
| Webhook | `hash(stable_payload_fields)` — NOT timestamp | Trigger adapter |
| Cron | `pipelineId + ":" + scheduledAt` | Trigger adapter |
| CloudEvent | `event.id` (spec-mandated unique per source) | Trigger adapter (read-only) |
| Serve (output) | Request header or `hash(body)` — HMAC-signed | Serve adapter (v0 done) |

Key finding: **Option B (Composer checks dedupKey inside the pipeline) is structurally wrong.**
By the time the Composer executes, the run has already started. A check inside the pipeline can
detect overlap but cannot prevent the run from starting. It would be output-side dedup (same role
as Serve idempotency) — not input-side dedup.

Correct model: `TriggerEvent<T>` carries an optional `dedupKey` field, filled by the trigger adapter.
The runtime (Inngest) consumes `event.data.dedupKey` via its `idempotency` expression and drops
duplicates before the function runs.

**Input-side dedup (trigger layer) + output-side dedup (Serve adapter) = full pipeline idempotency:**
- Layer 1 (runtime): drops duplicate runs — prevents wasted work
- Layer 2 (Serve adapter): skips duplicate mutations — prevents data corruption
- Both layers are independently sufficient for their responsibility; kit-core coordinates neither.

---

### O3 — Temporal policy mapping: kit expresses 5 shapes, delegates enforcement

[STRUCTURAL-PREDICTION — confirmed by probe-temporal-comparison output]

Temporal's WorkflowIdReusePolicy maps to kit's SingletonPolicy:

| Temporal policy | Kit equivalent | Inngest native | Kit-core role |
|---|---|---|---|
| ALLOW_DUPLICATE | `runGuard: {}` (default) | YES | none |
| REJECT_DUPLICATE | `SingletonPolicy:{type:"reject"}` + infinite DedupWindow | NO (24h cap) | declare + adapter-impl |
| TERMINATE_IF_RUNNING | `SingletonPolicy:{type:"terminate"}` | NO (management API needed) | declare + adapter-impl (deferred) |
| ALLOW_DUPLICATE_FAILED_ONLY | `SingletonPolicy:{type:"conditional"}` | NO (Store adapter needed) | declare + adapter-impl (deferred) |

Kit v1 minimum viable: 5 RunGuard shapes (the 4 common cases + default):
1. `{}` — unbounded parallelism (ALLOW_DUPLICATE)
2. `{concurrency:{limit:N}}` — bounded parallelism
3. `{concurrency:{limit:1, overflow:"queue"}, singleton:{type:"queue"}}` — sequential singleton
4. `{concurrency:{limit:1, overflow:"reject"}, singleton:{type:"reject"}}` — true singleton
5. `{dedup:{period:"24h"}}` — webhook/event dedup

Policies TERMINATE and ALLOW_DUPLICATE_FAILED_ONLY: kit can express them in the type system
but enforcement is `adapter-impl-needed` — deferred to v1.x.

---

### O4 — Kit boundary: declaration only, no enforcement in kit-core

[STRUCTURAL-PREDICTION — confirmed; clean boundary]

```
kit-core OWNS (existing — v0 done):
  IdempotencyKey type + makeIdempotencyKey()
  Serve-side idempotency context extraction (HMAC-SHA256 + timestamp tolerance)
  Result<T,E> contract flowing through Serve adapters

kit-core ADDS (minimal new surface):
  RunGuard type (ConcurrencyConfig + SingletonPolicy + DedupWindow)
  TriggerEvent<T> with optional dedupKey field
  ComposerOptions.runGuard (declaration only — zero enforcement code)

trigger adapter OWNS:
  dedupKey computation from raw event data (per O2)
  Building TriggerEvent<T> with dedupKey populated

adapter-inngest OWNS:
  RunGuard → Inngest function config translation
  ConcurrencyConfig → inngest concurrency[] array
  DedupWindow.period → inngest idempotency expression string

runtime (Inngest) OWNS:
  Concurrency enforcement (queue / reject overflow)
  Event-level dedup (24h window, keyed on event.data.dedupKey)
  Singleton enforcement (concurrency=1 per key)

kit-core DOES NOT OWN:
  Any enforcement of concurrency limits
  Any dedup storage or key lookup
  Any lock acquisition for singleton runs
  Run registry or run state tracking
```

The RunGuard addition is a pure type-system change to kit-core. No runtime behavior added.

---

### O5 — Industry standard pattern: modern runtimes own enforcement

[STRUCTURAL-PREDICTION — confirmed across 5 runtimes]

| Runtime | Concurrency | Dedup | Singleton |
|---|---|---|---|
| Inngest | `concurrency:[{limit,key}]` | `idempotency` expression (24h) | `concurrency:{limit:1}` + overflow policy |
| Temporal | worker slot limits | WorkflowIdReusePolicy | REJECT_DUPLICATE or TERMINATE_IF_RUNNING |
| AWS SQS | — | `MessageDeduplicationId` (5-min window) | — |
| pg-boss | — | `singletonKey` | `singletonSeconds` |
| kit v0 | — | Serve-side HMAC (output-only) | — |

All modern runtimes own enforcement. Kit's role: declare intent, don't enforce.
Same pattern as Cat I (Inngest owns retry/durability; kit expresses retries config).

---

### O6 — v0 Serve idempotency composes with trigger-level dedup

[CONFIRMED — symmetric design, no coordination needed]

Input-side dedup (trigger) and output-side dedup (Serve v0 HMAC) are symmetric:
- Both computed at the boundary (before the work executes)
- Both derived from stable, content-addressable fields
- Both produce a string IdempotencyKey that a store can look up
- Neither requires the other — but together provide defense in depth

Even if the runtime's 24h dedup window expires and a cron run fires twice, the Serve
adapter's output-side check catches the duplicate mutation.
`at-most-once-run` (input) + `at-most-once-mutation` (output) = full pipeline safety.

---

## §3. VERDICT

**Kit adds RunGuard config (declaration): YES**
- `RunGuard` type + `TriggerEvent<T>.dedupKey` are the minimal additions to kit-core
- Zero enforcement code in kit-core — RunGuard is a declaration passed through to adapter

**Enforcement delegated to runtime: CONFIRMED**
- Inngest enforces concurrency limits and event-level dedup natively
- adapter-inngest translates RunGuard → Inngest function config
- Kit-core is not a scheduler and does not acquire locks

**Full pipeline idempotency = input-side (trigger) + output-side (Serve): CONFIRMED**
- Both are boundary-computed (before work executes)
- v0 Serve idempotency already done; trigger-side dedup is the complementary addition

**Dedup key ownership: trigger/runtime layer: CONFIRMED**
- Key always computable before pipeline runs
- Trigger adapter fills `TriggerEvent.dedupKey`; runtime enforces; kit-core types it

---

## §4. CARRY-FORWARDS

**cf #19** (Cat IV Q3) — RESOLVED by this spike.
RunGuard type + TriggerEvent.dedupKey confirmed as minimal kit-core surface.
Enforcement boundary: trigger adapter (key computation) + runtime (enforcement).

**cf #20** (Cat IV → v1 spec) — RunGuard shape (5 variants) needs ADR.
Minimum viable: unbounded / bounded / sequential-singleton / true-singleton / 24h-dedup.
TERMINATE + CONDITIONAL policies: expressible in type system, enforcement deferred to v1.x.

**cf #21** (Cat IV → Cat VI cross-cut) — Inngest `idempotency` window is 24h (non-configurable per-function).
For webhook sources needing dedup windows > 24h, a Store adapter (MemoryAdapter + TTL) is required
at the trigger layer. Intersects Cat VI (adapter composition).

**cf #22** (Cat IV → v1 spec) — `TriggerEvent<T>` shape as a new kit-core type.
Confirmed fields: `id`, `object`, `pipelineId`, `data`, `dedupKey?`, `scheduledAt?`, `metadata`.
`scheduledAt` enables cron dedup key generation without extra adapter state.

---

## §5. STATUS

Throwaway code (4 probes, 5 source files). No kit-core amendments. No ADR drafts
(brain synthesises). All probes run clean — no PENDING-RUN items (no Inngest dep).

**All observations defensible now (structural — confirmed by probe output):**
- O1: three-concern separation — CONFIRMED
- O2: dedup key ownership at trigger/runtime layer — CONFIRMED (keys match across duplicate fires)
- O3: Temporal policy mapping, 5 RunGuard shapes cover v1 minimum viable — CONFIRMED
- O4: kit boundary = declaration only, no enforcement — CONFIRMED
- O5: industry pattern (runtimes own enforcement) — CONFIRMED
- O6: v0 Serve idempotency composes cleanly with trigger-level dedup — CONFIRMED

*Author: Executor — 2026-05-10. Branch: master (tip 856d918 at spike start).*
*No Inngest dep. Strict TS; ESM; Bun-runnable. All 4 probes green.*
