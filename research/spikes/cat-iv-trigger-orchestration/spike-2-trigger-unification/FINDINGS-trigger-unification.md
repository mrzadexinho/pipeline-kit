# Spike #2 — trigger-unification FINDINGS

> Spike: probe whether pipeline-kit needs a `Trigger<O>` type at Tier 2 (stage primitive)
> or whether triggering is purely adapter/runtime config.
> Directory: `research/spikes/cat-iv-trigger-orchestration/spike-2-trigger-unification/`
> Branch: `master`. Author: Executor — 2026-05-10.
> Companion to: `docs/research-outline-v1.md` § Category IV (Trigger Orchestration).
> Status: spike output (NOT a notes file; brain synthesises `docs/research-notes-v1-cat-IV.md`).
> Friction anchor: F-TRIGGER-1 (gatewerk — two trigger shapes for same conceptual event).

---

## §1. SETUP

- No Inngest dep (kit-level probe — trigger shape is kit-level, not adapter-level)
- Zod v3.23+ for schema boundaries
- TypeScript strict + ESM
- 5 trigger shapes tested: cron, webhook, event, manual, MCP
- Run mode: pure in-process (bun run — no external runtime)
- Files:
  - `src/types.ts` — all core types: Option A/B/C comparison, TriggerConfig union, KitTriggerEnvelope<T>
  - `src/probe-four-shapes.ts` — 5-shape convergence probe (real output: all CONVERGE)
  - `src/probe-cloudevents.ts` — byte size + field comparison (CloudEvents vs kit vs Inngest)
  - `src/probe-source-vs-trigger.ts` — Way A/B/C LOC + type-param comparison
  - `src/probe-local-prod-seam.ts` — single trigger definition, dev + prod execution (runs end-to-end)

**Run commands (after `bun install`):**

```bash
bun run src/probe-four-shapes.ts
bun run src/probe-cloudevents.ts
bun run src/probe-source-vs-trigger.ts
bun run src/probe-local-prod-seam.ts
```

---

## §2. OBSERVATIONS

### O1 — Does Trigger<O> collapse to Source<O>?

**CONFIRMED by probe-source-vs-trigger.ts output:**

Three ways to implement a cron-triggered pipeline were coded and compared:

| Metric | Way A: Trigger<O> wraps Source | Way B: Source + trigger config | Way C: Pure Source + runtime config |
|---|---|---|---|
| LOC (wiring) | 35 | 22 | 12 |
| Type parameters | 2 | 1 | 1 |
| User API | `CronTrigger<P>` + `TriggerAwareSource<P,O>` | `SourceConfig<O>` | `Source<O>` |
| Cron to webhook change | Change Trigger type + payload generic (2 places) | Change `.trigger` field (1 line) | Change runtime config only |
| Generic param changes | 2 | 0 | 0 |
| Compile-time payload type | HIGH | MEDIUM (unknown + Zod) | LOW/MEDIUM |
| Key tradeoff | More complexity, no net gain | Simpler, minor runtime-only safety | Simplest, trigger payload inaccessible |

**Key convergence finding:** Way C.`ContextualSource` (Source with `pull(ctx)`) and Way B.`SourceConfig`
converge structurally. Both collapse to: `Source<O>` with an optional trigger context parameter.
Way B is Way C with an added `.trigger` config field.

**Way A is overkill:** A separate `Trigger<P>` type is only valuable if:
(a) Multiple downstream stages need access to the trigger payload, OR
(b) Kit needs to automatically orchestrate the trigger -> source wiring.
For a personal toolkit where each pipeline has a single Source, neither (a) nor (b) holds.

**Verdict for O1:** `Trigger<O>` COLLAPSES to Source config. No new type needed.

---

### O2 — CloudEvents compatibility

**CONFIRMED by probe-cloudevents.ts output (real byte sizes):**

| Envelope | Byte size (same cron payload) |
|---|---|
| CloudEvents v1.0.2 (full) | 378 bytes |
| KitTriggerEnvelope<T> | 187 bytes |
| Inngest native event | 116 bytes |

CloudEvents overhead: +191 bytes vs kit (+102%). Kit overhead: +71 bytes vs Inngest native (+61%).

**CloudEvents field analysis:**
- `specversion` — pure overhead for single-version kit
- `source` — must be URI (verbose); kit uses short prefixed ID (`pk_src_*`)
- `type` — reverse-DNS convention (verbose); kit uses bounded TriggerType union
- `datacontenttype`, `dataschema` — overkill for personal automations
- `subject` — redundant (kit id covers this)

**Projection test:** kit envelope projects losslessly to CloudEvents. All 5 fields map 1:1.
Projection is reversible (CE fields map back to kit fields).

**Recommendation:** ADOPT-SUBSET.
- `KitTriggerEnvelope<T>` with fields `{ id, type, source, time, data }` is the canonical kit trigger envelope.
- CloudEvents compliance is an adapter concern: adapters add `specversion: "1.0"` + URI-format source on serialize.
- Kit type stays minimal. No `specversion`, `dataschema`, `datacontenttype` in kit core.
- Extension attributes (traceparent, sequence) are adapter-tier concerns.

---

### O3 — Source-vs-trigger LOC comparison

**CONFIRMED by probe-source-vs-trigger.ts:**

- Way A: 35 LOC, 2 type params, 2 generics must change when switching trigger type.
- Way B: 22 LOC, 1 type param, 0 generics change — trigger swap is a 1-line field change.
- Way C: 12 LOC, 1 type param, 0 generics change — trigger is entirely outside kit.

Way A's extra complexity exists to give compile-time payload type safety. But since trigger payload
enters kit at the Source boundary (Zod validates it), the safety gain is only between Trigger and
Source — a narrow intra-framework path that does not cross public API. This does not justify a
new Tier-2 type.

Way B's `.trigger` config field is the sweet spot: it co-locates trigger declaration with the Source
it feeds, while keeping the type surface minimal. This is the pattern kit should adopt.

---

### O4 — Event envelope convergence

**CONFIRMED by probe-four-shapes.ts output (all 5 shapes ran and produced real output):**

All 5 trigger shapes produce structurally identical envelopes:

```
{ id: string, type: TriggerType, source: string, time: string, data: T }
```

The `.data` payload differs per trigger type (expected — it is generic). The top-level envelope
structure CONVERGES completely.

Inngest mapping: all 5 types collapse to 2 Inngest primitives:
- `{ cron: expr }` — only for cron
- `{ event: name }` — for webhook, event, manual, MCP

Webhook and MCP are NOT native Inngest triggers — they route via `inngest.send()` from an HTTP
handler (webhook) or MCP tool handler (MCP). The Inngest function just consumes the resulting event.

**The 2-primitive collapse is a critical design signal:** kit's trigger abstractions need not mirror
Inngest's primitives. Kit's TriggerConfig union maps DOWN to Inngest, not up.

---

### O5 — Local-prod seam for triggers

**CONFIRMED (end-to-end run):** probe-local-prod-seam.ts ran the full pipeline in dev mode and
printed real output including handler execution with 2 atoms processed.

```
[DEV]     Registered cron trigger: "0 8 * * 1" -> simulating as immediate + 100ms interval
[HANDLER] Received trigger event: type=cron, id=pk_tev_cron_dev_1778...
[HANDLER] Pulled 2 atoms from source
[HANDLER]   -> processed pk_atom_nl_001: sent=true
[HANDLER]   -> processed pk_atom_nl_002: sent=true
[PROD]    Would register Inngest trigger: {"cron":"0 8 * * 1"}
```

Seam thickness: THIN — same pattern as Cat V MemoryAdapter seam.
- Single `TriggerConfig` definition compiles to both modes.
- `TriggerAdapter.register(config, handler)` is the adapter interface.
- The handler receives `KitTriggerEnvelope<T>` in both dev and prod — pipeline handler is unchanged.

What changes when cron -> webhook:
1. `TriggerConfig`: 1-line field change (`{ kind: "cron" }` -> `{ kind: "webhook" }`)
2. `DevTriggerAdapter.register`: `setInterval` -> `express.post(path, handler)`
3. `ProdTriggerAdapter.register`: `{ cron: expr }` -> `{ event: "webhook/..." }`
4. `pipelineHandler`: UNCHANGED (receives `KitTriggerEnvelope<T>` regardless)
5. `Source.pull()`: may need `ctx.payload` if source content depends on webhook body

The only caller-visible change is (5): if Source must access the trigger payload, it needs `pull(ctx?)`.
This is already in Way B's `SourceConfig` shape.

---

### O6 — Industry standard comparison

| Runtime | Trigger mechanism | Is Trigger a type? | Pattern |
|---|---|---|---|
| Inngest | `{ event: name }` or `{ cron: expr }` in `createFunction` config | NO | config |
| Temporal | `workflow.start()` or Schedule API | NO | API call / config |
| GitHub Actions | `on: { schedule, push, workflow_dispatch }` in YAML | NO | config |
| n8n | Trigger nodes (`ITriggerFunctions` interface) | YES | type |
| Zapier | Trigger component (distinct Zap element) | YES | type |
| CloudEvents | CNCF event envelope standard | NOT a trigger | wire format |

**The pattern split:** workflow engines (Inngest, Temporal, GH Actions) treat trigger as config.
Integration platforms (n8n, Zapier) treat trigger as a distinct type because they compose triggers
into visual workflows where trigger nodes must be distinguishable from action nodes in the UI.

**Kit is a library beneath workflow engines.** Kit's users configure triggers in code, not in a
visual builder. The workflow-engine pattern (trigger = config) is the correct fit.

n8n/Zapier's Trigger-as-type exists to support their UI rendering, not because the type is
semantically necessary for correct execution. Kit has no UI rendering requirement.

---

## §3. VERDICT — Trigger<O> at Tier 2: NO

**`Trigger<O>` is NOT a new kit stage primitive.**

Evidence:
1. **O1:** Way A (Trigger wraps Source) costs +13 LOC and +1 type parameter vs Way B, with no net
   gain for the personal-toolkit use case. All 3 ways converge structurally.
2. **O3:** Cron -> webhook switch requires 0 generic changes in Way B/C vs 2 in Way A.
3. **O5:** A single `TriggerConfig` definition compiles to both dev (setInterval) and prod (Inngest).
   The seam is thin without a Trigger<O> type.
4. **O6:** Every workflow engine (the pattern kit follows) treats trigger as config, not a type.
   Only visual-builder platforms (n8n, Zapier) need Trigger as a type — for UI rendering, not
   semantics.
5. **F-TRIGGER-1 resolution:** gatewerk's `callback_url` vs webhook friction arose from TWO DIFFERENT
   TRIGGER SHAPES leaking through to the API surface. Kit's `TriggerConfig` discriminated union
   encapsulates this: `{ kind: "webhook" }` covers both; user never sees the distinction.

**Kit tier assignment:**
- `TriggerConfig` (discriminated union) -> **Tier 1 core** — defines WHAT triggers a pipeline
- `KitTriggerEnvelope<T>` -> **Tier 1 core** — the runtime-agnostic event envelope
- `TriggerAdapter` (interface with `.register(config, handler)`) -> **Tier 3 adapter-tier** — runtime-specific wiring
- No `Trigger<O>` stage type at Tier 2.

---

## §4. OPEN QUESTIONS FOR SPIKE #3

1. **Dedup / idempotency at the trigger boundary** — if a webhook fires twice with the same payload,
   what prevents the pipeline from running twice? Kit's idempotency key convention applies to Serve
   adapters (mutating external state) — does it extend to triggers? Does the Source need to emit
   idempotency keys derived from the trigger event ID?

2. **Trigger fan-out** — can one trigger fire multiple pipelines? Or is trigger:pipeline 1:1?
   (Cat I spike #1 / fan-out is pipeline:atoms N:M; this is trigger:pipeline 1:? — different axis.)

3. **Webhook trigger + HMAC signing** — `WebhookTrigger.secret` is defined in types.ts. The HMAC
   verification lives in the DevTriggerAdapter / HTTP handler. Does kit need a `verifyWebhookSignature`
   utility in Tier 1, or is this Tier 3 adapter concern? Cat I ADR on HMAC applies here.

4. **Trigger metadata in Atom** — should `Atom.metadata` carry the trigger event ID and type so
   downstream Process stages can route by trigger type? Or is trigger metadata an anti-pattern
   (stages should be trigger-agnostic)?

---

## §5. CARRY-FORWARDS

**cf #19** (Cat IV Q-trigger-type) — `Trigger<O>` as Tier-2 stage type: RESOLVED-reject.
Trigger is config + envelope (Tier 1) + adapter (Tier 3). No new stage primitive.

**cf #20** (Cat IV Q-trigger-envelope) — `KitTriggerEnvelope<T>` design CONFIRMED.
Fields: `{ id, type, source, time, data }`. CloudEvents projection is adapter concern.
LIFT to Cat IV notes as ADR direction.

**cf #21** (Cat IV Q-trigger-seam) — `TriggerAdapter` interface as seam boundary CONFIRMED.
`register(config, handler)` is sufficient. LIFT to Cat IV notes as ADR direction.

**cf #22** (Cat IV Q-trigger-dedup) — Idempotency at trigger boundary — OPEN QUESTION.
Does Source emit atoms with idempotency keys derived from trigger event ID?
Candidate for spike #3 if dedup is in scope.

**cf #23** (Cat IV Q-trigger-hmac) — HMAC webhook verification placement.
Cat VIII ADR-VIII-2 (PII redaction at Zod boundary) and Cat I HMAC convention apply.
Does `verifyWebhookSignature` belong in kit core (Tier 1) or adapter (Tier 3)?
Candidate for spike #3 scope.

---

## §6. CROSS-CUTS

- **Cat VIII cf #5 (local-prod seam):** trigger seam pattern matches MemoryAdapter / SecretsAdapter seam
  confirmed in Cat V/VIII. Same TriggerAdapter interface pattern. Consistent across all 3 adapter types.
- **Cat I ADR-v1-I-7** (kit is NOT a workflow engine): CONFIRMED. Trigger = config is consistent with
  kit not owning scheduling/retry/persistence. Inngest owns the cron/event routing.
- **F-TRIGGER-1 (gatewerk friction):** the `callback_url` vs webhook shape divergence is resolved by
  `TriggerConfig` union. Users write `{ kind: "webhook" }` once; adapter handles the runtime shape.

---

*Author: Executor — 2026-05-10. Branch: master (tip 856d918 at spike start).*
*No Inngest dep. Zod v3.23+. Strict TS; ESM; Bun-runnable. All 4 probes run clean.*
