# pipeline-kit — Research Notes (Phase 1) — Synthesis

> Synthesis-only entry doc for Phase 2 spec drafting. Per-source notes live in per-category files (see Reading map).
> Master full version preserved at [research-notes-full.md](research-notes-full.md) as historical reference.
> Author: Claude Code session, 2026-05-06 evening.
> Project: pipeline-kit — typed-stage TypeScript automation library
> (`Source<O>` / `Store<T>` / `Process<I,O>` / `Serve<I>` + Composer).

---

## Status

Reading order (per outline): IV → I → III → VII → V → II → VI → VIII → IX → X.

| # | Category | Sources | Status |
|---|---|---|---|
| IV  | HITL patterns | 8 | **complete** |
| I   | Architecture references | 7 | **complete** |
| III | Source/connector patterns | 6 | **complete** |
| VII | HTTP/webhook/event | 5 | **complete** |
| V   | Reliability patterns | 5 | **complete** |
| II  | TypeScript SDK ergonomics | 6 | **complete** |
| VI  | Type/schema/validation | 5 | **complete** |
| VIII| Observability | 3 | **complete** |
| IX  | Marketplace + community | 6 | **complete** |
| X   | Pursuit + existing surface | 7 | **complete** |

**Total: 58/58 sources, 10/10 categories. Phase 2 readiness: PARTIAL** (5 net-new ADR candidates surfaced; ADR1 brain-locked; 3 outline ADRs need brain interpretation).

---

## Reading map

For Phase 2 spec drafting, drill into per-category files as needed:

| Category | File | Lines | Sources |
|---|---|---:|---|
| **IV** — HITL patterns | [research-notes-cat-IV.md](research-notes-cat-IV.md) | 267 | 20-27 |
| **I** — Architecture references | [research-notes-cat-I.md](research-notes-cat-I.md) | 303 | 1-7 |
| **III** — Source/connector patterns | [research-notes-cat-III.md](research-notes-cat-III.md) | 276 | 14-19 |
| **VII** — HTTP / webhook / event | [research-notes-cat-VII.md](research-notes-cat-VII.md) | 162 | 38-42 |
| **V** — Reliability patterns | [research-notes-cat-V.md](research-notes-cat-V.md) | 144 | 28-32 |
| **II** — TypeScript SDK ergonomics | [research-notes-cat-II.md](research-notes-cat-II.md) | 172 | 8-13 |
| **VI** — Type / schema / validation | [research-notes-cat-VI.md](research-notes-cat-VI.md) | 200 | 33-37 |
| **VIII** — Observability | [research-notes-cat-VIII.md](research-notes-cat-VIII.md) | 147 | 43-45 |
| **IX** — Marketplace + community | [research-notes-cat-IX.md](research-notes-cat-IX.md) | 93 | 46-51 |
| **X** — Pursuit + family surface | [research-notes-cat-X.md](research-notes-cat-X.md) | 102 | 52-58 |

Master full version (1944 lines) preserved at [research-notes-full.md](research-notes-full.md).

---

## Brain adjudication (Phase 2 inputs)

These decisions are LOCKED at session close 2026-05-06 night. **Phase 2 brain inherits them as inputs, does NOT re-deliberate.**

### 8 open questions — all confirmed at Phase 1 recommendation

1. **Composer ownership** = **LIBRARY** (option B). pipeline-kit is library called BY user's durable function, not durable runtime itself.
2. **Resume granularity** = **stage-boundary-only for v0**. Intra-stage interrupts deferred (LangGraph-style not adopted).
3. **Retry budget** = **both layers** — global per-Pipeline + per-Stage. Composer enforces aggregate; stage default is bounded.
4. **Idempotency TTL** = **24h default, configurable**. Document explicitly; regulated verticals may extend.
5. **ArkType escape hatch** = **defer to v1; profile first**. v0 stays on Zod for ecosystem cohesion.
6. **CloudEvents webhook payload opt-in** = **v1 feature (not v0)**. Stripe-shape default; CloudEvents optional for AWS EventBridge / Knative interop.
7. **Auto-MCP exposure code-gen** = **v1 feature (not v0)**. Validate v0 reference adapters first; auto-MCP post-shipped.
8. **Pursuit bridge priority** = `apify-*` catalog → pgvector embeddings → demand-mining SQL views (in that order). Other adapters defer.

### 5 new ADR candidates — scope decisions (in or out for v0)

| # | Candidate | v0 Decision | Rationale |
|---|---|---|---|
| **A** | Webhook signature versioning policy | **IN v0 SCOPE** | Cheap to lock; prevents v1 breakage when v2 ships |
| **B** | Composer ownership of durable layer (library not runtime) | **IN v0 SCOPE** | Load-bearing positioning; confirms Q1 |
| **C** | Route-policy shape (stakes / confidence / priority unification) | **DEFER to v1** | Real route complexity not present in v0 reference projects; v0 ships single-priority |
| **D** | CloudEvents emission mode for `webhook-serve` | **DEFER to v1** | Matches Q6 deferral |
| **E** | SDK resource taxonomy | **IN v0 SCOPE** | Naming locks early; renaming is a breaking change |

**Phase 2 v0 spec scope: 20 outline ADRs + 3 v0-scope new ADRs (A, B, E) = 23 v0 ADRs total.** C, D added to v1 spec roadmap.

### ADR1 brain call — DECLINE Effect.ts adoption for v0

**Locked: pipeline-kit v0 uses vanilla TypeScript.** Cascade decisions:

| ADR | v0 choice |
|---|---|
| **ADR3** retry primitives | Vanilla — `p-retry` + `bottleneck` OR thin kit-built wrappers |
| **ADR8** observability | Vanilla — `@opentelemetry/api` + `@opentelemetry/sdk-node` |
| **ADR11** ORM | Drizzle directly (NOT `@effect/sql-drizzle`) |
| **ADR15** test framework | Vitest + fast-check (NOT `@effect/vitest`) |
| **ADR6** schema validation | Zod (NOT Effect Schema) |

**Rationale:** ship velocity + lower user learning curve + cleaner composition with external libraries. **v1 re-evaluation trigger** = explicit cascade-impact analysis when v0 ships + first 2-3 portfolio projects validate the kit's user-facing APIs. If users hit Result-handling boilerplate or DI fragility in real projects, the case for Effect strengthens. If vanilla holds up cleanly, defer to v2 or skip entirely.

---

## Cross-category synthesis

### Top 10 cross-category lift patterns (signal-dense, ranked by ADR-impact)

1. **Stripe-shape API conventions** (prefixed IDs / response envelope / idempotency keys / cursor pagination / actionable errors). Cat II + IV + VII converge unanimously. **Already locked via ADR16 + Gatewerk catalog.**
2. **`{ data, error }` Result discriminated union as kit-wide error contract.** Cat II (Resend, Knock, Gatewerk-sdk-ts) + Cat IV (Agent Inbox `HumanResponse`). Maps to **ADR4**.
3. **Step-as-durable-boundary** with idempotency + exp-backoff-with-jitter + token-bucket retry budget. Cat I (Inngest, Trigger.dev, Hatchet, Temporal) + Cat V (Stripe, AWS Builder's, Fail at Scale) converge. Maps to **ADR3 + ADR9 + ADR10 + ADR13**.
4. **`EditableField<T> = { suggested, approved, wasEdited }`** as flow-through type for HITL edits. Cat IV (gotoHuman + Agent Inbox + Gatewerk) converges unanimously. Maps to **ADR19**.
5. **`Reviewable<I>` as protocol-first primitive** with permission flags + descriptor, decoupled from durable execution. Cat IV + Cat I (LangGraph interrupt() pause/resume contract). Maps to **ADR14**.
6. **Source/Serve/Process typed-stage thesis** validated by Cat III (Airbyte, Singer, n8n, Activepieces) + Cat X (pursuit's essentials-kit). All converge on adapter pattern with state checkpoint + capability negotiation.
7. **Zod at every Source/Serve boundary + drizzle-zod bridging Store schemas.** Cat VI + Cat VII (Hono + zod-validator). Maps to **ADR6 + ADR11**.
8. **OTel native + emit-but-don't-bundle pattern.** Kit emits OTel spans; users wire OTel exporters to backends (Langfuse, Datadog, Honeycomb, Grafana). Cat VIII + Cat V converge. Maps to **ADR8**.
9. **HMAC-SHA256 + timestamp tolerance + constant-time compare + multi-auth + SDK-bundled verify.** Cat VII (Stripe + Hatchet + CloudEvents) + Cat II (Gatewerk-sdk-ts dual v1/v2). Maps to **ADR17**.
10. **Library-tier positioning beneath workflow engines.** Cat IV (HITL stations are products) + Cat IX (n8n/Activepieces are workflow tools) + Cat X (operatoros productized service rides on top). pipeline-kit sits BELOW these — typed-stage library that workflow engines and HITL stations consume. **Critical positioning. No new ADR; locked in outline §1.**

### Top 5 ADR resolution candidates (with confidence)

| # | Decision | Recommended resolution | Confidence |
|---|---|---|---|
| **ADR3** | Sync vs durable execution | v0 sync (in-process). v1 durable adapter; **Inngest as primary reference** (TS-first, step-as-boundary). Trigger.dev second; Hatchet third; Temporal too heavy. ADR1 lock removes `@effect/workflow` from consideration. | **HIGH** |
| **ADR14** | HRP review primitive | `Reviewable<I>` interface with `ReviewableConfig = { allowApprove, allowReject, allowEdit, allowRetry, allowIgnore }` + `describe: (input: I) => string`. Reference impl `GatewerkReviewable`; alternatives `SlackEmojiReviewable`, `EmailLinkReviewable`, `ConsoleReviewable`. List-of-responses return shape from day one. | **HIGH** |
| **ADR19** | Edit-in-place semantics | `EditableField<T> = { suggested: T, approved: T \| null, wasEdited: boolean }` flowing through pipeline. Direct lift from gotoHuman + Agent Inbox + Gatewerk. | **HIGH** |
| **ADR17** | Webhook signing | v2-style by default (`X-Webhook-Signature-V2: t=<unix>,v1=<hex>`); SDK-bundled `pipelinekit.webhooks.verify`; multi-auth support (HMAC default; Basic / Bearer / API Key alternatives); constant-time compare. | **HIGH** |
| **ADR9** | Idempotency convention | Kit auto-generates idempotency keys for `Serve<I>` mutating adapters; pairs with exp-backoff-with-jitter on retry; 24h default cache window (per Q4); document scope (header-level + request-fingerprint hybrid). | **HIGH** |

Other HIGH-confidence: ADR2, ADR4, ADR6, ADR7, ADR8, ADR10, ADR11, ADR13, ADR15, ADR16, ADR18.
**MEDIUM (need brain interpretation in Phase 2):** ADR5 (state/context shape), ADR12 (composition syntax), ADR20 (Pursuit interop sequencing — Q8 partially answers).

### Memory candidates from session (saved to pursuit memory pool 2026-05-06)

1. `feedback_gatewerk_catalog_short_circuit.md` — pipeline-kit Phase 1 lifted ~40% of patterns from Gatewerk catalog; read it first for adjacent research.
2. `feedback_effect_ts_ecosystem_cascade.md` — Effect adoption cascades through 5+ ADRs; v0 declines; v1 re-eval trigger documented.
3. `feedback_library_without_composer_is_unused.md` — HumanLayer pivot lesson; primitives + wiring must ship together.

---

## Recommended Phase 2 sequence

1. Brain reviews this synthesis-only `research-notes.md` + drills into per-category files for source-level evidence.
2. Brain incorporates locked decisions (8 open questions + 5 new ADR scope + ADR1 cascade) from "Brain adjudication" section as inputs — these are NOT re-deliberated.
3. Brain drafts `pipeline-kit-spec.md` with all **23 v0 ADRs** (20 outline + 3 new: A, B, E) resolved. ADRs C and D land in v1 spec roadmap.
4. Phase 3 v0 build follows: Composer + reference adapters (per outline §11 v0 list) ship as a single coherent package; Trades Outbound (outline §9 Project A) validates the wiring end-to-end.

---

*End of Phase 1 research notes (synthesis). Per-source detail in per-category files. Master full version at [research-notes-full.md](research-notes-full.md).*
*Author: Claude Code session, 2026-05-06 evening. Brain adjudication added 2026-05-06 night.*
