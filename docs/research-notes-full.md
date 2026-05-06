# pipeline-kit — Research Notes (Phase 1)

> Phase 1 output. Per-source notes + per-category synthesis from the
> ~58-source reading list in `docs/research-outline.md` §13.
> Feeds Phase 2 (Spec) — does NOT resolve ADRs (Section 7 of outline).
> Author: Claude Code session, started 2026-05-06.
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

ADR mappings in notes reference Section 7 of `research-outline.md` (ADR1-ADR20).

Last updated: 2026-05-06 evening.

---

## Category IV — HITL patterns

Why FIRST: Gatewerk-adjacent, foundation for `Reviewable<I>` (ADR14, ADR19),
and Gatewerk's own catalogs already cover most upstream patterns —
short-circuits ~15 sources from later categories.

### 20a. Gatewerk philosophy — `~/Claude-Workspace/gatewerk/docs/philosophy.md`
- **Purpose:** "Linux of HITL" — open, modular, protocol-first oversight station for AI agents. Sets the philosophical contract pipeline-kit's `Reviewable<I>` integrates with.
- **Core abstractions:** Three layers — HRP (Human Review Protocol — open spec, Apache 2.0); Gatewerk (self-hosted reference impl); Cloud (future managed layer).
- **Eight design principles, condensed:** (1) Do one thing well — receive→show→decide loop. (2) Modular: core engine, UI, SDKs, notifications all decoupled. (3) Tools not opinions — webhook system, not Telegram bot. (4) Don't reinvent — reuse mature OSS. (5) Ship what's needed. (6) Self-hosted first, cloud later. (7) Beautiful UI is non-negotiable for non-technical reviewers. (8) Protocol first — HRP is the contract, product is reference impl.
- **API surface (relevant to pipeline-kit):** HRP defines agent ↔ human handshake — review request → reviewer decision → webhook callback. pipeline-kit implements client side: `Reviewable<I>.run(input) → Result<I_approved, ReviewError>`.
- **What to lift:**
  - Protocol-first thinking → **ADR14**: `Reviewable<I>` is the contract; `GatewerkReviewable` is one impl; keep room for `SlackEmojiReviewable`, `EmailLinkReviewable`, `ConsoleReviewable`. Don't couple kit to Gatewerk-the-product.
  - "Tools not opinions" → **ADR9** (idempotency) and **ADR13** (retry): ship default policies, let user override.
  - Modular composability → **ADR12** chainable composition syntax.
- **What to avoid:** Don't lift Gatewerk's HITL UI logic, dashboard primitives, or visual template editor — those are product surface, not protocol. pipeline-kit ships as a **library**, not a station.
- **Stated non-goals:** Not an agent runtime, not a workflow builder, not a monitoring dashboard, not a framework. pipeline-kit's non-goals echo this almost verbatim.
- **License + community:** Apache 2.0 (HRP + station). Solo + AI team, in production v1.0/v1.1. Pre-launch GitHub stars.

### 20b. Gatewerk master blueprint — `~/Claude-Workspace/gatewerk/docs/blueprint.md` (SUPERSEDED 2026-04-18)
- **Purpose:** Strategic blueprint for Gatewerk product. Marked SUPERSEDED for product strategy; **architectural decisions section is still authoritative for pipeline-kit conventions.**
- **Core abstractions:** Three-layer (HRP / Open-Source Station / Cloud); monorepo (`apps/api`, `apps/web`, `packages/db`, `packages/sdk-ts`, `packages/sdk-py`, `packages/mcp`, `packages/shared`); pnpm workspaces + Bun runtime.
- **Architecture decisions (lifted directly to pipeline-kit conventions):**
  - Prefixed IDs (`gw_rev_/tpl_/prj_/key_/wh_/evt_`) → pipeline-kit uses `pk_pipe_/run_/atom_/src_/proc_/serve_`.
  - Response envelope: `id`, `object`, `created_at`, `metadata` on every resource.
  - Metadata pass-through: opaque, returned verbatim.
  - HMAC-SHA256 + timestamp tolerance for webhooks.
  - Actionable errors: `type`, `code`, `message`, `param`, `doc_url`.
  - SDK: resource-based (`gw.reviews.create()`), `createClient()` factory, env-var fallback, `{ data, error }` discriminated unions in TS, typed exception hierarchy in Python.
- **API surface (pattern):** `gw.reviews.create({ template, payload, metadata })`, `gw.reviews.decide(id, { decision })`, `gw.feedback.query({ template, outcome })`, `gw.webhooks.verify(payload, sig, secret)`.
- **What to lift:**
  - All conventions above → **ADR16** (naming), **ADR17** (webhook signing). pipeline-kit `createPipelineKit()` factory mirrors `createClient()`.
  - **Confidence routing** concept (v1.3 plan): pipeline emits `confidence: 0.0-1.0`, downstream Reviewable routes by template threshold. Maps to **ADR14** — `Reviewable<I>` may accept optional `ConfidencePolicy`.
  - **Token-based approval links** (`{{approve_url}}`, `{{reject_url}}`) — relevant to pipeline-kit's Serve adapters that emit notifications.
- **What to avoid:**
  - Don't lift SUPERSEDED features: progressive trust auto-adjustment, "Open Source Station" sub-brand, free tier, $19/$49/$149 pricing, AI Intelligence section.
  - Don't lift the cloud-vs-OSS feature split — irrelevant to pipeline-kit (kit is library).
- **Stated non-goals:** Not a workflow builder, not a monitoring dashboard, not a framework. Cloud version never has features that can't exist in OSS.
- **License + community:** Apache 2.0. Live in production. 200 tests passing. Internal blueprint.

### 21. Gatewerk ideas-to-steal pattern catalog — `~/Claude-Workspace/gatewerk/docs/research/ideas-to-steal.md`
- **Purpose:** Pre-existing battle-tested pattern catalog distilled from Stripe, Resend, Supabase, Knock, gotoHuman, Hatchet, Langfuse, LangChain Agent Inbox, HumanLayer, Sentry, Cal.com, n8n. **Already adopted by Gatewerk; pipeline-kit extends rather than re-derives.** Short-circuits ~15 upstream sources from Categories II/V/VII/VIII.
- **Core abstractions (11 sections):** API design / SDK design / webhook design / MCP server / review data model / template system / notification architecture / architecture patterns / retry+feedback flow / security / testing+onboarding.
- **API surface (selected patterns relevant to pipeline-kit):**
  - Idempotency-Key header on all mutating endpoints (Stripe, Knock).
  - Cursor pagination: `starting_after=pk_run_abc` — stable under concurrent writes.
  - Expandable objects: `?expand[]=template&expand[]=project`.
  - SDK webhook verification: `gw.webhooks.verify(rawBody, sigHeader, secret) → typed event`.
  - Typed webhook events as discriminated unions (`review.created | review.decided | review.expired`).
  - HumanLayer-style decorator for Python: `@gw.require_review(template='...')` — relevant if pipeline-kit ships a Python bridge.
  - Generic `Registry[T]` (Sentry pattern, ~56 lines): `register(key)` decorator + `get(key)` lookup + reverse lookup + duplicate detection. Reusable for stage registry, webhook handler registry, audit event types.
- **What to lift (pipeline-kit-specific):**
  - **Whole §1 (API design)** → **ADR16** prefixed IDs, response envelope, idempotency. Verbatim adoption.
  - **Whole §2 (SDK design)** → pipeline-kit's own SDK ergonomics: `createPipelineKit()`, env-var fallback, discriminated union responses, typed exception hierarchy.
  - **Whole §3 (webhook design)** → `webhook-source` adapter (incoming HMAC verify) + `webhook-serve` adapter (outbound HMAC sign). **ADR17**.
  - **§4 (two-step MCP discovery)** → `mcp-tool-source` + `mcp-tool-serve` adapter design — list_tools → get_schema → call_tool flow.
  - **§5 suggestedValue/approvedValue + wasEdited** → **ADR19** `EditableField<T> = { suggested, approved, wasEdited }`.
  - **§8 generic Registry[T]** → pipeline-kit Composer's stage registry; possible kit utility.
  - **§8 typed BullMQ-style queue** → durable execution v1 (**ADR3**) reference pattern.
  - **§9 three-phase retry loop** → Reviewable<I>.retry semantics (when reviewer rejects-with-feedback, Process re-runs with feedback as input).
  - **§10 SSRF prevention** → `webhook-source` defensive validation.
  - **§10 constant-time HMAC comparison** → kit-wide signing utilities.
- **What to avoid:**
  - Don't lift §6 (template system) — that's Gatewerk product surface, not kit primitive.
  - Don't lift §7 (notification architecture) — Gatewerk-specific delivery infra. (But token-based approval link payload variables ARE useful for Serve adapters.)
- **Stated non-goals:** Catalog is a checklist, not a spec. Priority matrix (v1.0/v1.1/v1.2) is Gatewerk-specific.
- **License + community:** Internal Gatewerk doc. Sources listed are individually high-traction OSS (Stripe Node, Resend, Supabase 76k+ stars, Knock, Hatchet 4k+, Langfuse 8k+).

### 22. Gatewerk competitive analysis — `~/Claude-Workspace/gatewerk/docs/research/competitive-analysis.md`
- **Purpose:** Maps full HITL landscape: gotoHuman (SaaS), Preloop (firewall), HumanLayer (pivoted), LangChain Agent Inbox + 9 small OSS HITL projects + framework-level HITL (LangGraph, CrewAI, n8n, Dify) + workflow platforms (Temporal, Inngest, Orkes) + governance (Zenity, CalypsoAI→F5, Invariant→Snyk).
- **Core abstractions:** Categorizes by *product shape*: Review desk vs. Firewall vs. Framework primitive vs. Workflow platform vs. Governance/observability. **pipeline-kit lives at a different layer entirely (library beneath workflow engines).**
- **API surface (pattern observations):**
  - gotoHuman: cloud-only, $39-$950/mo, SOC3+ISO27001, 24 field types, no-code template builder.
  - Preloop (Apache 2.0, 6 stars): MCP firewall pattern — agent → MCP proxy → policy check → allow/deny/approve. **CEL expressions for conditions. Policy-as-Code in YAML.**
  - LangChain Agent Inbox (951 stars): inbox UI for LangGraph `interrupt()`. `HumanInterruptConfig` with `allow_approve / allow_reject / allow_edit / allow_retry / allow_ignore`.
- **What to lift:**
  - Preloop's **Policy-as-Code in YAML + CEL expressions** — could inform pipeline-kit's `route-process` configuration syntax (route by predicate). **Possible Phase 2 ADR addition** (currently no ADR covers route config syntax).
  - **Token-based public approval links** (Preloop pattern) → `webhook-serve` Serve adapter when emitting review-link emails.
  - **Async approval mode** (Preloop Enterprise) → **ADR3** durable execution rationale.
- **What to avoid:**
  - **Do not** position pipeline-kit as a competitor to gotoHuman, Preloop, or LangChain Agent Inbox — they are HITL product layer; pipeline-kit is library layer beneath. Mistake = scope creep.
  - **Do not** chase feature checklists. pipeline-kit's edge is typed-stage abstraction + composition, not feature parity.
  - **HumanLayer pivot lesson:** SDK alone is not enough — they had 9.7k stars and pivoted because "every team rolled their own agent architecture." For pipeline-kit, this means: **ship the Composer (the wiring), not just the typed interfaces.** Library without a composer = unused interfaces.
- **Stated non-goals:** Gatewerk's positioning, instructive for pipeline-kit's: not a workflow builder, not a runtime, not a monitoring dashboard.
- **License + community:** Survey doc; underlying competitors are mixed (gotoHuman proprietary, Preloop Apache 2.0, Agent Inbox MIT).

### 23. Gatewerk gotoHuman teardown — `~/Claude-Workspace/gatewerk/docs/research/gotohuman-teardown.md`
- **Purpose:** Deep teardown of gotoHuman product (landing → pricing → docs → dashboard → API/SDK/MCP). 770-line authenticated scan, 2026-03-11.
- **Core abstractions:**
  - "Agent" = template (rebrand from "Template").
  - 24 field types in 3 categories: Structure (Columns/Grid/Group/Title/Divider), Content-to-show-and-edit (Text/Markdown/Number/Date/Image/Video/Links/PDF/JSON/HTML/InfoCard/Rating), Collect-input (ButtonGroup/TextInput/Multiline/Checkboxes/Dropdown/FileUpload).
  - **Trigger forms** (input collection, "Submit" only, 11 field types) vs **Review steps** (24 field types, "Approve/Reject"). Maps cleanly to Source-vs-Process boundary.
  - Review state machine: `pending | in_review | decided | expired | retrying`.
  - Auto-approval mode: per-template or per-request via `autoApprove` / `meta._gthAutoApprove`.
- **API surface:**
  - `POST /reviews` — body: `{ template, payload, metadata, autoApprove? }`.
  - Webhook payload: `{ type, accountId, reviewId, formId, formName, response, respondingUser, respondedAt, responseValues: { [field]: { value, wasEdited } }, meta }`.
  - 5 integration options exposed in dashboard "API Request" dialog: n8n, Make, HTTP, Python SDK, JS/TS SDK.
  - MCP server (`@gotohuman/mcp-server`): `list_templates → get_template_schema → request_review → query_feedback`.
  - Reviews API (agent memory): paginated, filterable by template/status/date/reviewer; returns full field data including edits.
- **What to lift (pipeline-kit-specific):**
  - **Two-step MCP discovery pattern** → `mcp-tool-source` adapter design (list → schema → call). Relevant for Serve adapters that expose pipeline output as MCP tool.
  - **`responseValues[field] = { value, wasEdited }`** webhook structure → `EditableField<T>` design (**ADR19**). Direct adoption.
  - **Auto-approval as a routing primitive** (binary) → simpler version of confidence-routing for `Reviewable<I>` v0; full confidence policy can be v1. **ADR14** initial scope.
  - **Per-template assigned-reviewer dialog** → `route-process` design — different reviewer per stage, possibly per payload-type.
  - **Trigger form vs review step separation** → maps cleanly to Source-vs-Process boundary in pipeline-kit. Source = input collection; Process emits review-step content; Reviewable<I> wraps Process output.
- **What to avoid:**
  - **Do not lift the no-code template builder** — that's Gatewerk's v1.2 surface, not pipeline-kit's. Keep pipeline-kit schema-as-code (Zod). **ADR6** boundary.
  - **Do not lift dashboard, metrics, billing, RBAC** — kit-irrelevant.
  - Avoid 24-field-type breadth — kit only needs typed I/O contracts; field rendering is downstream.
- **Stated non-goals (gotoHuman's):** Cloud only; no self-hosting; no open protocol; no API key scoping. (gotoHuman's gaps that Gatewerk fills — pipeline-kit doesn't need to take a stance on these.)
- **License + community:** Proprietary SaaS. Customers: NVIDIA, Deloitte, Carrefour, HoiChoi, Norlantic, Zepto, PayFacto, Air New Zealand, Tilled. Most mature dedicated HITL platform.

### 24. gotoHuman docs — https://docs.gotohuman.com (synthesized from Gatewerk teardown + landing fetch)
- **Purpose:** Public docs site (Docusaurus). Per-feature how-to: create review templates, send review requests, complete reviews, response webhooks, notifications (email/Slack), AI retries, agent memory, manual triggers, MCP server, n8n/Make/Dify integrations.
- **Core abstractions (verbatim):** Review template, Review requests, Review submissions (webhook), Web UI, Agent memory, MCP server, Webhook (response callbacks), Manual triggers.
- **API surface (synthesized from teardown):**
  - REST: `POST /reviews` body `{ template, payload, metadata, autoApprove? }`.
  - Webhook payload: `{ type, accountId, reviewId, formId, formName, response: 'approved'|'rejected', respondingUser, respondedAt, responseValues: { [field]: { value, wasEdited } }, meta }`.
  - 5 integration tabs in the dashboard "API Request" dialog: n8n, Make, HTTP, Python SDK, JS/TS SDK.
  - MCP server (`@gotohuman/mcp-server`): `list_templates → get_template_schema → request_review → query_feedback`.
  - Reviews API (agent memory): paginated, filterable by template/status/date/reviewer.
- **What to lift:**
  - **`responseValues[field] = { value, wasEdited }`** structure → directly informs **ADR19** `EditableField<T>`. Diff between suggested and approved is the atomic learning unit.
  - **Two-step MCP discovery** → `mcp-tool-source` + `mcp-tool-serve` adapter pattern. Schema fetched before invocation.
  - **`autoApprove` flag** at request level → simpler v0 alternative to confidence routing for `Reviewable<I>` (**ADR14**).
  - **Trigger forms vs review steps** distinction → maps cleanly to Source-vs-Process boundary in pipeline-kit.
- **What to avoid:**
  - Don't lift the no-code template builder UI — pipeline-kit stays schema-as-code (Zod, **ADR6**).
  - Don't model templates as a first-class kit primitive — they're product surface.
  - Cloud-only / no self-hosting / no API key scoping are not pipeline-kit concerns.
- **Stated non-goals:** No self-hosting, no open protocol (proprietary API), no audit logs below Business tier, no API key scoping.
- **License + community:** Proprietary SaaS, $39-$950/mo. NVIDIA, Deloitte, Carrefour, etc. Most mature dedicated HITL platform.

### 25. HumanLayer Python decorator pattern — https://github.com/humanlayer/humanlayer (legacy SDK, removed PR #646; pivoted to CodeLayer Sept 2025)
- **Purpose:** Original Python SDK that gave LLM tool calls deterministic human-oversight gates. Two primitives: `@require_approval` (function gated by human approval) and `human_as_tool` (agent calls humans as if they were tools). 9.7k+ stars before pivot.
- **Core abstractions (from legacy `humanlayer.md`):**
  - `@require_approval` — decorator that wraps a function; LLM call to wrapped function blocks until approved.
  - `human_as_tool` — exposes humans as a callable tool to the agent (Slack DM, email, SMS channels).
  - `ContactChannel` — abstraction over notification surface.
  - **Function stakes hierarchy** — Low (read public) / Medium (read private; hard-coded comms) / High (write/publish on user's behalf). Conceptual taxonomy that drives where HITL gates go.
  - "Outer loop" agents thesis — Gen 3 autonomous agents initiate communication with humans; HumanLayer was positioning for this.
- **API surface (canonical pattern, cross-referenced with Gatewerk's `ideas-to-steal.md` Section 2.8):**
  - `@hl.require_approval(contact_channel=ContactChannel(...))` — decorator on a Python function.
  - `human_as_tool()` — returns a tool the LLM can invoke when stuck.
  - Decorator intercepts call → posts to ContactChannel → blocks until decision → returns (possibly edited) result.
- **What to lift:**
  - **Decorator pattern** → low-priority Python bridge for pipeline-kit (TS-primary per CLAUDE.md). Direct pattern for `@reviewable_stage(template=...)` decorator wrapping a Process IF a Python pipeline-kit ever ships.
  - **Function stakes hierarchy** as a routing signal → `Reviewable<I>` could accept a `stakes: 'low'|'medium'|'high'` policy that informs reviewer routing. Augments **ADR14**.
  - **Pivot lesson** (already noted in source 22): SDK alone insufficient. pipeline-kit must ship the **Composer** + **reference projects** to validate, not just typed interfaces.
  - **"Outer loop" thesis** — long-running agent-initiated workflows reinforce **ADR3** (durable execution v1, Inngest-backed).
- **What to avoid:**
  - Don't ship a Python SDK as part of pipeline-kit v0 (TS-primary). MCP bridge is the pursuit-side Python escape hatch (**ADR20**).
  - Don't conflate "function stakes" (runtime metadata) with type-level constraints — stakes is metadata, not a type.
  - Don't lift `human_as_tool` in v0 — it inverts pipeline direction (Process asks human mid-execution); pipeline-kit v0 is unidirectional Source→Process→Serve. Could be v2.
- **Stated non-goals:** Original SDK was Python-only; never had structured form review (binary approve/deny). Pivoted out of SDK-only space.
- **License + community:** Apache 2.0. 9.7k+ stars (pre-pivot demand signal). SDK-era is now historical reference; CodeLayer is current product.

### 26. LangChain Agent Inbox — `langchain-ai/agent-inbox` (951 stars per Gatewerk competitive analysis)
- **Purpose:** Inbox UX for LangGraph `interrupt()`-driven HITL. Hosted version at `dev.agentinbox.ai`; OSS repo. Surfaces interrupts from LangGraph deployments and routes human responses back. **Closest OSS competitor to Gatewerk's review surface, but LangGraph-coupled.**
- **Core abstractions (verbatim from README, Python schemas):**
  - `HumanInterruptConfig = { allow_ignore: bool, allow_respond: bool, allow_edit: bool, allow_accept: bool }`.
  - `ActionRequest = { action: str, args: dict }`.
  - `HumanInterrupt = { action_request: ActionRequest, config: HumanInterruptConfig, description?: str }`.
  - `HumanResponse = { type: 'accept'|'ignore'|'response'|'edit', args: null | str | ActionRequest }`.
- **API surface (verbatim TS from README):**
  ```typescript
  import { interrupt } from "@langchain/langgraph";
  import { HumanInterrupt, HumanResponse } from "@langchain/langgraph/prebuilt";

  const request: HumanInterrupt = {
    action_request: { action: toolCall.name, args: toolCall.args },
    config: { allow_ignore: true, allow_respond: true, allow_edit: false, allow_accept: false },
    description: _generateEmailMarkdown(state),
  };
  const response = interrupt<HumanInterrupt, HumanResponse[]>(request)[0];
  if (response.type === "response") { /* ... */ }
  ```
- **What to lift:**
  - **`HumanInterruptConfig` permission flags** → directly informs `Reviewable<I>` per-instance config (**ADR14**). pipeline-kit version: `ReviewableConfig = { allowApprove, allowReject, allowEdit, allowRetry, allowIgnore }`.
  - **`HumanResponse.type` discriminated union** (`accept | ignore | response | edit`) → maps to pipeline-kit `Result<I_approved, ReviewError>`. Critical: distinguish edit (modified) from accept (unchanged) — informs **ADR19**.
  - **`description` markdown field** → `Reviewable<I>` should accept a `describe: (input: I) => string` callback for reviewer-facing context per request.
  - **List-of-responses semantics** ("Agent Inbox always returns a list with a single object, although at this time only one") → forward-compat for multi-reviewer scenarios. pipeline-kit's `Reviewable<I>.run()` should return list-shape from day one.
- **What to avoid:**
  - **Tight LangGraph coupling.** Agent Inbox requires Assistant/Graph ID + LangGraph deployment URL + LangSmith API key. pipeline-kit's `Reviewable<I>` must NOT require a specific upstream framework — implementations plug in.
  - LangSmith API key requirement = vendor lock to LangChain ecosystem. pipeline-kit stays vendor-agnostic.
  - Inbox stores config in browser localStorage — UI concern; not relevant to library layer.
- **Stated non-goals:** Not framework-agnostic — explicitly LangGraph-only. Schemas are LangGraph-native types, not a portable protocol.
- **License + community:** MIT-style (LangChain ecosystem). Active, maintained by LangChain core team. Setup requires Node.js + yarn + LangGraph deployment.

### 27. LangGraph interrupt() docs — https://docs.langchain.com/oss/python/langgraph/interrupts
- **Purpose:** Framework-level HITL primitive: `interrupt(value)` pauses graph execution at any node, persists state via checkpointer, awaits external resume via `Command(resume=value)`. **The most-cited HITL primitive in 2025-2026 agent literature.**
- **Core abstractions:**
  - `interrupt(value: Any) -> Any` — pause function. Value is JSON-serializable; surfaced to caller; on resume, returns the value supplied via Command.
  - `Command(resume=<value>)` — resume directive.
  - `thread_id` (in config) — persistent cursor; reusing it resumes the exact checkpoint.
  - `Checkpointer` — required persistence layer (`MemorySaver` dev, `SqliteSaver` prod, custom for Postgres/Redis).
  - `result["__interrupt__"]` (v1) / `result.interrupts` (v2) — surfaces pending interrupts.
- **6 documented HITL patterns:**
  1. **Approve / reject** — pause before critical action, route by boolean.
  2. **Review and edit state** — surface generated content, accept edited version.
  3. **Validating human input** — loop with interrupt() until input passes validation.
  4. **Interrupts in tools** — embed interrupt() inside tool functions for pre-call approval.
  5. **Multiple interrupts (parallel)** — siblings interrupt; resume with `{interrupt_id: value}` map.
  6. **Streaming with HITL** — detect interrupts via `chunk["type"] == "updates"`.
- **Representative signature pattern:**
  ```python
  from langgraph.types import interrupt, Command

  def approval_node(state: State):
      approved = interrupt({"question": "Approve?", "details": state["x"]})
      return Command(goto="proceed" if approved else "cancel")
  # Outside: graph.invoke(Command(resume=True), config={"configurable": {"thread_id": "..."}})
  ```
- **What to lift:**
  - **Pause/resume contract** → `Reviewable<I>` design philosophy (**ADR14**). The kit version: `Reviewable<I>.run(input, ctx) → Promise<Result<I_approved, ReviewError>>` returns immediately for sync impls, awaits callback for async impls.
  - **JSON-serializable payload constraint** → review-request payload should be input I serialized via Zod; reject non-serializable inputs at the boundary (**ADR6**).
  - **Multiple interrupts per node** (parallel branches with id-keyed resume map) → pipeline-kit Composer's parallel-branch composition can interrupt multiple stages; resume by stage-instance ID. Possible v1 feature.
  - **`thread_id` cursor pattern** → pipeline-kit `Pipeline.run` returns a `pk_run_` ID that doubles as resume cursor for **ADR3** durable execution.
- **What to avoid:**
  - **Node replay semantics** — on resume, the entire node re-executes from entry, requiring idempotent pre-interrupt side effects. **pipeline-kit MUST NOT replay arbitrary code on resume.** Structure the contract so review checkpoints are at stage boundaries (between Process and Serve, or Process→Process), not mid-stage. Stage-level resume = simpler than node-level replay.
  - **Index-matched resume values** — fragile; pipeline-kit should use named/keyed resume values from day one.
  - **Exception-based signaling** — Python pattern; in TS, use `Result<T, ReviewError>` discriminated union (**ADR4**).
  - **Hard checkpointer requirement** — pipeline-kit v0 stays sync (no checkpointer mandatory); durable execution v1 (**ADR3**) introduces optional checkpointer adapter.
- **Stated non-goals:** Framework-specific — only works with LangGraph graphs + checkpointer. Not a portable HITL contract; HRP fills that gap.
- **License + community:** LangGraph core (BSD/Elastic license, depends on component). Heavy LangChain ecosystem traction; widely adopted in production agentic systems.

---

### Category IV — Synthesis

**Top 3 patterns to lift across HITL category:**

1. **`EditableField<T> = { suggested: T, approved: T | null, wasEdited: boolean }`** as a flow-through type. Validated by gotoHuman's `responseValues[field] = { value, wasEdited }` and Agent Inbox's `HumanResponse.type === 'edit'`. Maps to **ADR19**. Direct adoption — no design alternative is competitive across sources.

2. **`Reviewable<I>` permission flags + descriptor** — Agent Inbox's `HumanInterruptConfig` (`allow_ignore | allow_respond | allow_edit | allow_accept`) is a clean per-instance contract. pipeline-kit version: `ReviewableConfig = { allowApprove, allowReject, allowEdit, allowRetry, allowIgnore }` plus a `describe: (input: I) => string` markdown callback. Maps to **ADR14**. Generalizes across all HITL stations.

3. **Pause/resume contract decoupled from durability.** LangGraph requires a checkpointer (heavy); gotoHuman is fully async webhook-driven (light). pipeline-kit v0 supports both via the `Reviewable<I>` interface: sync impls return immediately (`ConsoleReviewable`), async impls await an external callback (`GatewerkReviewable`). Durable execution adapter (**ADR3**) is orthogonal to the Reviewable<I> contract.

**Top 2 pitfalls to avoid:**

1. **Framework lock-in.** Agent Inbox is LangGraph-only; gotoHuman has proprietary API; HumanLayer pivoted out of SDK-only space (lesson: SDK alone insufficient). pipeline-kit must NOT couple `Reviewable<I>` to any specific HITL station; the contract is HRP-aligned and any station that speaks HRP plugs in.

2. **Scope creep into product surface.** gotoHuman's no-code template builder, 24 field types, dashboard, RBAC, metrics are product features, NOT library primitives. pipeline-kit stays schema-as-code (Zod, **ADR6**) and emits typed I/O — rendering and dashboard concerns are downstream (Gatewerk's job).

**Implications for ADRs (with confidence):**

- **ADR14 (HRP review primitive):** Define `Reviewable<I>` as a generic interface with configurable `ReviewableConfig` (permissions + descriptor) and pluggable implementations. Reference impl `GatewerkReviewable`; alternatives `SlackEmojiReviewable`, `EmailLinkReviewable`, `ConsoleReviewable` for dev. **Confidence: HIGH** — multi-source convergence.
- **ADR19 (edit-in-place semantics):** `EditableField<T> = { suggested, approved, wasEdited }` as canonical flow-through type. Direct lift from gotoHuman + Agent Inbox + Gatewerk. **Confidence: HIGH**.
- **ADR3 (sync vs durable execution):** v0 sync correct (avoids LangGraph's mandatory checkpointer); v1 durable adapter justified (Inngest/Trigger.dev pattern; HumanLayer "outer loop" thesis). **Confidence: HIGH** for v0 sync.
- **ADR4 (Result<T,E> vs throws):** Reinforced — TS discriminated unions (Agent Inbox shows the pattern) cleaner than Python's exception-based `interrupt()`. **Confidence: HIGH**.
- **ADR6 (Zod boundary validation):** Reinforced — review-request payloads must be JSON-serializable; Zod at the Reviewable<I> boundary mirrors LangGraph's serializability constraint. **Confidence: HIGH**.

**Open questions for brain adjudication:**

1. **Resume granularity** — stage-level (Process emits → Reviewable wraps → resume continues to Serve) vs intra-stage. LangGraph supports intra-node interrupt; pipeline-kit's typed-stage thesis pushes toward stage-boundary-only. *Brain recommend: stage-boundary-only for v0.*
2. **List-of-responses forward-compat** — Agent Inbox returns `HumanResponse[]` even though only one is used today. Should pipeline-kit `Reviewable<I>.run()` return a single `HumanResponse` or `HumanResponse[]`? Multi-reviewer scenarios suggest array. *Brain recommend: array from day one.*
3. **`stakes` metadata as routing signal** — HumanLayer's low/medium/high stakes hierarchy. Should pipeline-kit ship a default `StakesPolicy` for `Reviewable<I>` or leave to userland? *Brain recommend: leave to userland for v0; revisit if reference projects need it.*
4. **Decorator ergonomics for TS** — TS lacks Python-style first-class decorators. Higher-order function (`reviewableStage(config)(processFn)`) instead? *Brain recommend: HOF pattern.*
5. **Confidence routing scope for v0** — auto-approve binary toggle (gotoHuman pattern) vs full confidence-policy interface. *Brain recommend: binary v0; full policy v1.*

**Bonus Gatewerk research files NOT in outline (flagged, no critical gap):** `gatewerk-vs-gotohuman.md` (20K), `gotohuman-platform-map.md` (54K), `cloud-pricing-and-compliance.md`, `distribution-and-integrations.md`, `notification-channels.md`, `openclaw-integration-vision.md`, `launch-strategy-research.md`. These are largely Gatewerk-product-specific (positioning, GTM, branding). No additional pattern signal beyond what sources 20-23 already capture for pipeline-kit.

---

## Category I — Architecture references

Why SECOND: durable execution patterns inform ADR1 (Effect.ts), ADR3 (sync vs durable), ADR5 (state/context), ADR9 (idempotency), ADR10 (backpressure), ADR12 (composition syntax), ADR13 (retry).

### 1. Effect.ts docs — https://effect.website
- **Purpose:** TypeScript runtime + standard library — type-safe effect system, structured concurrency, Layer-based DI, full standard library JS lacks. Positions itself as the way to "build production-ready applications in TypeScript."
- **Core abstractions (verbatim):**
  - `Effect<A, E, R>` — primary computation primitive: success channel `A`, typed error channel `E`, dependency channel `R`.
  - `Layer<RIn, E, ROut>` — DI primitive; composes service/configuration wiring.
  - `Context.Tag<T>` — environment carrier; resolves dependencies via Layer.
  - `Schema` — data validation + serialization with type alignment (alternative to Zod).
  - `Stream` — async iteration with backpressure (alternative to AsyncIterable).
  - `Fiber` — lightweight concurrency unit; deterministic cancellation.
  - `Scope` — resource lifecycle; cleanup on exit.
  - `Schedule` — retry/repetition policies (exponential backoff, jitter, etc).
  - `Cause`, `Exit`, `Either`, `Option` — structured error/result types.
- **API surface (representative):**
  ```typescript
  // Effect.gen for imperative-style composition
  const getTodo = (id: number): Effect.Effect<Todo, HttpError, HttpClient> =>
    Effect.gen(function* () {
      const client = yield* HttpClient;
      const response = yield* client.get(`/todos/${id}`);
      return yield* response.json;
    });

  // Layer DI
  const HttpClientLive = Layer.succeed(HttpClient, makeClient());

  // Schema
  const Todo = Schema.Struct({ id: Schema.Number, title: Schema.String });

  // Stream
  Stream.fromIterable([1, 2, 3]).pipe(Stream.map(x => x * 2));

  // Run
  Effect.runPromise(program.pipe(Effect.provide(HttpClientLive)));
  ```
- **What to lift:**
  - **Layer DI pattern** as architectural reference for **ADR5** state/context — Layer.succeed/Layer.effect/Layer.merge for composition. **Vanilla TS v0 doesn't need to adopt Layer literally; can use simple constructor injection that *resembles* Layer's compositional shape.**
  - **Schedule** for retry policies → **ADR13** reference: exponential backoff + jitter as default; userland can override.
  - **Cause** for actionable errors → **ADR4 + ADR16** reinforcement: errors carry structured context (not just messages).
  - **Schema** as alternative to Zod for **ADR6** — outline locked Zod; document Schema as ADR1-cascading alternative.
  - **Effect.gen + yield\*** — readable async composition. Userland pattern; not a kit primitive.
- **What to avoid:**
  - All-or-nothing adoption. Learning curve real ("similar to learning TypeScript"); team unfamiliar with FP will pay productivity tax.
  - Bundle size scales with usage. Core ~15KB but quickly grows when pulling Layer/Stream/Schema/Schedule.
  - Don't backfill Effect into v0 just because individual primitives are attractive — **ADR1 cascade** means adopting Effect changes ADR3 (use @effect/workflow), ADR8 (@effect/opentelemetry), ADR11 (@effect/sql-drizzle), ADR15 (@effect/vitest). Either commit or stay vanilla.
- **Stated non-goals:** Doesn't position as a workflow engine, but the monorepo ships `@effect/workflow` as a separate package (see source 2). Doesn't position as an HTTP framework, but `@effect/platform` covers HTTP servers.
- **License + community:** MIT. ~8.5k stars on Effect-TS/effect. 2k+ Discord members. Production adoption (Vercel, PolyCam testimonials). Mature core; clustering/workflows still alpha.

### 2. Effect-TS/effect repo — `Effect-TS/effect` (monorepo, 32+ packages)
- **Purpose:** Source of the Effect ecosystem. **Critical insight: adopting Effect cascades through every other ADR because Effect ships cohesive packages for durable workflow, SQL/ORM, OpenTelemetry, RPC, vitest integration.**
- **Core packages (selected, relevant to pipeline-kit ADRs):**
  - `effect` — core (Effect, Layer, Context, Schema, Stream, Fiber, Schedule).
  - `@effect/workflow` — **durable workflows for Effect.** Direct ADR3 alternative.
  - `@effect/sql` + `@effect/sql-drizzle` + `@effect/sql-pg` + `@effect/sql-sqlite-bun` etc. — **ADR11 alignment** (Drizzle interop available out of the box).
  - `@effect/opentelemetry` — **ADR8 alignment** (OTel native).
  - `@effect/rpc` — RPC primitives (relevant for cross-process Composer adapters in v2).
  - `@effect/cluster` — distributed compute (alpha; possibly v2 reference).
  - `@effect/platform` + `-node` / `-bun` / `-browser` — cross-runtime support (ADR runtime targets: Node 20+, Bun-tested CI per CLAUDE.md).
  - `@effect/vitest` — **ADR15 alignment**.
  - `@effect/ai`, `@effect/ai-anthropic`, `@effect/ai-openai`, `@effect/ai-google`, `@effect/ai-amazon-bedrock` — LLM provider abstractions (relevant for `extract-process` v0 adapter).
- **API surface:** see source 1.
- **What to lift:**
  - **`@effect/workflow`** → ADR3 v1 alternatives list — alongside Inngest, Trigger.dev, Hatchet. Especially compelling IF Effect adopted (ADR1).
  - **`@effect/sql-drizzle`** → ADR11 confirmation that Drizzle is the right ORM choice. If Effect adopted, the bridge is free.
  - **`@effect/opentelemetry`** → ADR8 confirmation; OTel-native.
  - **`@effect/ai-*`** → reference for `extract-process` LLM adapter design (provider-pluggable).
- **What to avoid:**
  - Don't pull Effect's whole ecosystem incrementally if not committing to Effect. Mixing vanilla + Effect packages creates wrapper hell.
  - Don't conflate "Effect ecosystem exists" with "must adopt Effect" — vanilla TS pipeline-kit can still cite Effect's package list as architectural reference.
- **Stated non-goals:** Not a workflow engine; not a scheduler; not an HTTP framework — but ships packages for all three. The monorepo strategy is "if it composes with Effect, it lives here."
- **License + community:** MIT. ~8.5k stars (parent), individual packages have npm install activity. pnpm@10.4.0 monorepo. tstyche for type-level testing — pattern worth noting for ADR15 alignment.

### 3. Inngest — https://www.inngest.com/docs
- **Purpose:** Event-driven durable execution platform for TypeScript/JavaScript. Background jobs, scheduled tasks, workflow orchestration "without managing queues, infra, or state." Cloud + open-source self-host.
- **Core abstractions (verbatim):**
  - `Function` — unit of work registered via `inngest.createFunction`.
  - `Step` — durable, retriable boundary inside a function.
  - `Event` — trigger payload; functions match on event names.
  - `Trigger` — `event: "..."` | `cron: "..."` | webhook configurations.
  - **Flow control config:** `concurrency`, `throttle`, `rateLimit`, `batchEvents`, `idempotency`, `priority`, `cancelOn`, `debounce`.
  - **Step methods:** `step.run`, `step.sleep`, `step.sleepUntil`, `step.waitForEvent`, `step.invoke`, `step.sendEvent`.
- **API surface (canonical):**
  ```typescript
  inngest.createFunction(
    {
      id: "sync-systems",
      idempotency: "{{ event.data.userId }}",
      throttle: { limit: 3, period: "1min" },
      retries: 3,
    },
    { event: "auto/sync.request" },
    async ({ event, step }) => {
      const data = await step.run("get-data", async () => fetchExternal());
      await step.sleep("debounce", "10s");
      const decision = await step.waitForEvent("user-decision", {
        event: "user/approval",
        match: "data.requestId",
        timeout: "1h",
      });
      return await step.run("apply", async () => apply(data, decision));
    }
  );
  ```
- **Durability model:** **`step.run` is the durable boundary.** On retry/restart, completed steps are memoized via Inngest's persistent state and re-skipped; only the failing/in-progress step executes. Function code re-executes top-to-bottom but completed steps return cached results.
- **Idempotency:** function-level template (`idempotency: "{{ event.data.userId }}"`) deduplicates within a window. Event-level deduplication via event ID. Both exist; complementary.
- **Retry:** default 3 retries with exponential backoff. Throw `NonRetriableError` to short-circuit. Per-step retry policy override available.
- **What to lift:**
  - **Step-as-durable-boundary** → pipeline-kit's stage IS the durable boundary in v1 ADR3. Each Source/Process/Serve invocation is conceptually a step. **HIGH confidence**.
  - **Idempotency at function + event level** → **ADR9**. pipeline-kit Serve adapters that mutate must accept idempotency key (function-level, e.g., `pk_run_id`) AND deduplicate by Atom ID (event-level).
  - **`step.waitForEvent`** as resume primitive → backs `Reviewable<I>` async impl in v1 durable adapter. Reviewer decision is the awaited event.
  - **Flow-control config block** (concurrency/throttle/rateLimit/batchEvents) → **ADR10** — pipeline-kit Composer accepts per-stage flow-control config in same shape.
  - **`NonRetriableError` pattern** → ADR4 reinforcement: TypeScript discriminated-union errors carry retry semantics.
- **What to avoid:**
  - Inngest's event-broadcast model is heavier than pipeline-kit's stage-pipeline model. Don't lift the global event bus assumption — pipeline-kit stages are explicitly wired by the Composer, not implicitly matched by event name.
  - Don't make `Function` (Inngest's name) collide with pipeline-kit's `Process` — keep nomenclature distinct.
- **Stated non-goals:** not a chat agent runtime; not an HTTP server framework; not a scheduler standalone (but offers cron triggers).
- **License + community:** Open core (Inngest server SDK Apache 2.0); managed cloud at app.inngest.com. ~3k+ stars; YC-backed; TypeScript-first.

### 4. Trigger.dev — https://trigger.dev/docs
- **Purpose:** Open-source background jobs framework for TypeScript. Long-running AI tasks, complex jobs, agent orchestration with built-in queuing, retries, elastic scaling. Self-host or Trigger.dev Cloud.
- **Core abstractions (verbatim):**
  - `Task` — discrete async function with built-in observability; "the core of Trigger.dev."
  - `Run` — instance of task execution; trackable by ID.
  - `Trigger` — invocation mechanism: code-side, schedule, event.
  - `Schedules` — cron-based scheduled tasks.
  - `Wait` — pause primitives (`wait.for`, `wait.until`).
  - `Concurrency & Queues` — per-task concurrency limits, FIFO queues.
  - `Retries` — auto error recovery, configurable policies.
  - `Realtime API` — event-driven task status subscription.
  - `MachinePresets` — compute-tier selection per task.
  - `ctx` — execution context (run ID, attempt, machine, etc).
- **API surface (representative pattern):**
  ```typescript
  // Define
  export const sendEmail = task({
    id: "send-email",
    retry: { maxAttempts: 3 },
    machine: { preset: "small-1x" },
    run: async (payload: { to: string }, { ctx }) => {
      await wait.for({ seconds: 5 });
      // ... email send logic
    },
  });

  // Trigger from app
  await sendEmail.trigger({ to: "user@example.com" });

  // Schedule
  schedules.task({ id: "daily", cron: "0 9 * * *", run: async () => {/*...*/} });
  ```
- **Durability:** Tasks run on Trigger.dev infrastructure (Cloud or self-hosted). "No timeouts, elastic scaling." State persists; restarts use retry policy. Run-level visibility into execution state.
- **What to lift:**
  - **Task / Run separation** → pipeline-kit's `Pipeline` (definition) / `PipelineRun` (instance) maps cleanly. Aligns with **ADR16** prefixed IDs (`pk_pipe_` definition vs `pk_run_` instance).
  - **`wait.for` / `wait.until` durable primitives** → **ADR14** Reviewable<I> with timeout in v1 durable adapter (any of Inngest's `waitForEvent` / Trigger.dev's `wait.for` / Temporal's `condition` could back the async impl).
  - **`MachinePresets`** as a compute-tier abstraction → reference for v2 if pipeline-kit ever exposes resource hints; not v0.
  - **Realtime API + React hooks** → reference for **ADR8** observability surface (run-status emission). Userland integration; not a kit primitive.
- **What to avoid:**
  - Trigger.dev's frontend-React-hook bias is product-shaped; pipeline-kit is a library, not a full-stack framework. Don't lift their UI integration.
- **Stated non-goals:** Not positioned against Temporal-class durable systems for ultra-heavyweight workflows; deliberately TypeScript-only.
- **License + community:** Apache 2.0 (v3). ~10k+ stars. Active OSS + commercial cloud. Strong AI-task positioning (LLM-friendly).

### 5. Hatchet — https://docs.hatchet.run
- **Purpose:** Distributed task queue + durable workflow engine. Multi-language SDKs (Python, TypeScript, Go, Ruby). Mission-critical AI agents, durable workflows, background tasks.
- **Core abstractions (verbatim):**
  - `Task` — fundamental unit of work wrapping a function.
  - `Worker` — long-running process polling task queues.
  - `Workflow` (durable) — composes multiple tasks with dependencies, retries, checkpointing.
  - `Event` — triggers workflows + inter-service comm.
  - `ScheduledRuns` / `CronRuns` — time-based invocation.
  - `Concurrency` — worker-level slot control + fairness.
  - `RateLimit` — flow control for ingestion.
  - `Priority` — task prioritization across parallel execution.
  - `RetryPolicy` — configurable per-task.
  - `Timeouts` — execution-time boundaries per task.
- **API surface:** Decorator-style task registration + worker registration; multi-language SDKs (Python/TS/Go/Ruby) share concepts. Exact TS signatures not in docs landing — would require deeper fetch for verbatim.
- **Durability model:** "every task and agent invocation persisted in Hatchet's durable event log, allowing for debugging, retries and replays." Long-running agents "automatically checkpoint their current state and pick up where they left off."
- **What to lift:**
  - **Multi-language SDK pattern** → relevant if pipeline-kit ever ships Python alongside TS later. **ADR20** says TS-primary + MCP bridge for pursuit; don't replicate Hatchet's polyglot story unless real demand.
  - **Webhook security** (per Gatewerk's `ideas-to-steal.md` §3 — Hatchet-sourced): multi-auth (Basic / API Key / HMAC), encrypted secrets at rest, constant-time HMAC. Confirms **ADR17**.
  - **Priority + RateLimit + Concurrency at workflow level** → confirms **ADR10** + **ADR13**.
  - **Durable event log** as audit substrate → conceptually similar to **ADR18** `Audited<I,O>` wrapper writing to Gatewerk audit log. Hatchet's event log is per-task; pipeline-kit's is per-pipeline-run.
- **What to avoid:**
  - Hatchet's surface includes infra (dashboard, deployment, multi-tenant cloud). pipeline-kit doesn't replicate infra.
  - Don't lift Hatchet's polyglot SDK story — keeping TS-only reduces complexity surface for v0 (CLAUDE.md alignment).
- **Stated non-goals:** Not stated explicitly.
- **License + community:** 100% MIT. ~4k+ stars. >10k OSS deployments/month claimed. GitHub + Discord active.

### 6. Temporal SDK — https://docs.temporal.io/develop/typescript
- **Purpose:** Heavyweight workflow durability platform; event-sourced replay, deterministic workflows, isolated activities. Used at Netflix, Stripe, Snap. Reference for **patterns**, not adoption.
- **Core abstractions (verbatim):**
  - `Workflow` — deterministic orchestration logic; defines business process.
  - `Activity` — isolated, non-deterministic work unit (API calls, DB ops); executed independently.
  - `Worker` — polls task queues, executes Workflows + Activities.
  - `Signal` — async fire-and-forget message to running workflow.
  - `Query` — sync read-only inspection of workflow state.
  - `Update` — sync request with confirmable response (mutate + ack).
  - `ChildWorkflow` — nested invocation with independent lifecycle.
  - `ContinueAsNew` — restart workflow with new input, no history accumulation.
  - `Heartbeat` — activity progress signal for graceful timeout/cancellation.
  - `Schedule` — temporal trigger primitive.
  - `Saga` — compensation pattern (documented; not a primitive name).
- **API surface (TypeScript, representative):**
  ```typescript
  // Workflow
  export async function paymentWorkflow(req: PaymentRequest): Promise<PaymentResult> {
    const activities = proxyActivities<typeof activityImpl>({
      startToCloseTimeout: '5m',
      retry: { maximumAttempts: 3 },
    });

    let resumeReceived = false;
    setHandler(resumeSignal, () => { resumeReceived = true; });

    setHandler(getStatusQuery, () => currentStatus);

    await activities.charge(req);
    await condition(() => resumeReceived, '10m');
    return await activities.confirm(req);
  }

  // Outside: client.workflow.signal(workflowId, resumeSignal);
  ```
- **Durability model:** Event sourcing with deterministic replay. Workflow re-executes from event history on recovery. Workflows MUST be deterministic (no `Math.random`, no direct I/O, no unbounded concurrency). All side effects routed through Activities. Activities are isolated retryable units.
- **Signal / Query / Update distinction:**
  - Signal — async, fire-and-forget, no return.
  - Query — sync, read-only, returns state.
  - Update — sync, mutating, returns ack.
- **What to lift:**
  - **Workflow vs Activity separation** → maps to pipeline-kit's "functional core, imperative shell" CLAUDE.md style rule. Pure Process functions = Workflow-like; side-effecting Source/Serve = Activity-like. Conceptual confirmation; not a new ADR.
  - **Signal as resume mechanism** → directly maps to **ADR14** `Reviewable<I>` resume semantics. External Signal = reviewer decision; running Pipeline awaits via callback / event.
  - **Saga (compensation) pattern** → relevant for **ADR3** + Serve adapter design when v1 durable adapter spans multiple external systems. Outline already lists Saga in §11 v2 candidates.
  - **Schedule** primitive → cron-like trigger for Source. Outline §11 says Source v0 is pull-by-call; Schedule deferred to v2 (ADR2 confirms pull semantic).
- **What to avoid:**
  - **Deterministic-workflow constraint is heavy.** pipeline-kit MUST NOT enforce determinism on Process functions — userland will reject. Use Temporal patterns conceptually, not literally.
  - Don't adopt event-sourced replay for v0. Massive infrastructure cost; out of scope for a library.
  - Don't replicate `proxyActivities` injection at the v0 layer; it's a Temporal-runtime construct.
- **Stated non-goals:** Doesn't explicitly state, but emphasizes "deterministic workflow constraints" and isolated nondeterminism, implying unsuitable for low-latency event-driven systems with unbounded nondeterminism.
- **License + community:** MIT (TypeScript SDK). Production at Netflix, Stripe, Snap. Considered the gold standard for durable workflow primitives.

### 7. Cole Medin "Principles of Agentic Engineering" — `coleam00/ai-transformation-workshop`
- **Purpose:** Methodology + reference workshop materials for AI-first software development. Frames the AI Layer concept (CLAUDE.md + on-demand context + commands/skills as a portable second codebase), the PIV Loop (Plan/Implement/Validate), and 5 Golden Rules. **Not a runtime architecture — a project-development methodology.**
- **Core abstractions:**
  - **AI Layer** — code + AI-context (CLAUDE.md global rules / on-demand reference docs / commands & skills) checked into source control alongside code. AI improvements work like code improvements — PR'd, reviewed, evolved.
  - **PIV Loop** — `Plan` (`/prime` loads context + `/plan` produces structured plan with validation strategy *before code*); `Implement` (context reset, `/implement` in fresh window); `Validate` (5-layer pyramid).
  - **5-layer validation pyramid:** Layer 1 typecheck/lint (agent), Layer 2 unit tests (agent), Layer 3 integration/E2E (agent + browser automation), Layer 4 code review (human + AI assist), Layer 5 manual testing (human golden-path + edge cases). **Goal: push the line between L3 and L4 as far down as possible.**
  - **5 Golden Rules:** (1) Commandify everything (typed something twice → make it a command); (2) Reduce assumptions (questions → PRD → Jira → plan → execute, never skip checkpoints); (3) Context is king (reset between Plan and Implement; sub-agents for research only); (4) Git log is memory (commit frequently + descriptively); (5) System evolution (every bug → improve the AI layer so it never happens again).
- **API surface (commands shipped, not relevant to pipeline-kit runtime):** `/prime`, `/plan`, `/implement`, `/validate`, `/review`, `/security-review`, `/create-prd`, `/create-stories`, etc.
- **What to lift:**
  - **AI Layer mindset** → pipeline-kit project itself follows this: `research-notes.md` (this doc) is on-demand context; `CLAUDE.md` is global rules; Phase 1/2/3 discipline IS the commandified workflow. Already aligned — **no new ADR**.
  - **PIV validation pyramid** maps cleanly to pipeline-kit test plan (outline §12): **ADR15** (Vitest + fast-check) covers Layers 1-2; integration tests in `src/` mirror Layer 3; brain reviews + Idris dogfood = Layers 4-5. **Encode in CLAUDE.md "Anti-patterns" section** — flag PRs that skip a layer.
  - **"Reduce assumptions"** philosophical alignment with `Reviewable<I>` (**ADR14**): HITL is "every assumption is a question to a human." Reinforces framing.
  - **"Git log is memory"** — pipeline-kit commit-message discipline + CLAUDE.md "no emojis in commit messages." Already aligned.
- **What to avoid:**
  - Don't conflate PIV (development methodology, meta layer) with pipeline-kit's Source/Process/Serve (runtime architecture, object layer). Different abstraction layers.
  - Don't ship PIV-specific commands as kit primitives — they're project-workflow tools, not stage adapters.
- **Stated non-goals:** PIV is a methodology, not a framework. Workshop demo uses Next.js/Drizzle/Zod; demo stack is incidental.
- **License + community:** Workshop materials open (no explicit LICENSE in README excerpt). Cole Medin runs Dynamous community; talks given at YC Aug 2025. Patterns gaining traction in agentic-engineering community.

---

### Category I — Synthesis

**Top 3 patterns to lift across architecture references:**

1. **Step-as-durable-boundary** (Inngest + Trigger.dev + Hatchet + Temporal converge unanimously). Each stage invocation in pipeline-kit's Composer should be a durable boundary (idempotent, checkpointed) when running under v1 durable adapter. **The kit's typed-stage thesis ALIGNS with this** — Source/Process/Serve are natural step boundaries. Maps to **ADR3**. **Confidence HIGH.**

2. **Functional core, imperative shell.** Temporal's Workflow-vs-Activity, Effect's Layer-DI separation, Cole Medin's "context is king + reset between Plan/Implement," Inngest's pure-function-with-step.run-side-effects all converge. Already a CLAUDE.md style rule. Reinforced by all 5 architecture references. **No new ADR needed; cite all 5 in spec.**

3. **Per-stage flow-control config object.** Inngest's `{ throttle, concurrency, rateLimit, batchEvents, idempotency, priority, retries, cancelOn }` block; Hatchet's RateLimit/Concurrency/Priority/RetryPolicy; Trigger.dev's per-task retry/concurrency. Converge on a flat config-object shape. Maps to **ADR9 + ADR10 + ADR13**. **Confidence HIGH** for adopting an Inngest-shaped config block.

**Top 2 pitfalls to avoid:**

1. **Reinventing durable execution in v0.** Temporal-class event-sourced replay is overkill; Inngest/Trigger.dev/Hatchet-class step-checkpointing requires significant infra. v0 stays sync (in-process); v1 adopts an existing platform via adapter (**ADR3**).

2. **Adopting Effect.ts ecosystem wholesale without commitment.** Effect ships `@effect/workflow`, `@effect/sql-drizzle`, `@effect/opentelemetry`, `@effect/rpc`, `@effect/ai-*` — adopting Effect cascades through ADR3, ADR8, ADR11. **ADR1 says "vanilla TS v0, evaluate Effect for v1" — the cascade IS the reason for the deferral.** Don't backfill Effect into v0 just because individual primitives look attractive.

**Implications for ADRs (with confidence):**

- **ADR1 (Effect.ts adoption):** v0 vanilla confirmed (HIGH confidence). v1 re-eval still warranted — Effect's ecosystem cohesion (Layer DI + workflow + sql-drizzle + OTel + AI providers) is materially attractive. **Confidence MED for v1 adoption** (real tradeoff, not a foregone conclusion).
- **ADR3 (sync v0, durable v1):** Strongly supported. Inngest is most pipeline-kit-shape-compatible (event-driven, step-as-boundary, TS-first). Trigger.dev second (TS-only, similar shape). Hatchet third (multi-language adds complexity surface). Temporal too heavyweight; reference only. `@effect/workflow` is a wildcard if Effect adopted. **Confidence HIGH for sync v0; HIGH for Inngest as primary v1 adapter reference.**
- **ADR5 (state/context):** Effect Layer DI is a compelling reference. v0 can use simple Context pass-through (style rule "no class for behavior unless lifecycle requires"). orchestr8 backend hint in outline §7 implies external memory adapter. **Confidence MED — Phase 2 needs to define Context shape concretely.**
- **ADR9 (idempotency):** Inngest's function-level (template) + event-level (event ID) is canonical. **Confidence HIGH.** Direct pattern adoption.
- **ADR10 (backpressure):** Token-bucket at Source/Serve boundary aligns with Inngest's `throttle: { limit, period }`. **Confidence HIGH.**
- **ADR12 (composition syntax):** `Pipeline.from(s).through(p).store(st).to(srv)` chainable. Effect uses pipe(); Inngest uses flat function-with-steps; Trigger.dev uses task definitions. pipeline-kit's chainable choice closer to LCEL. **Confidence MED** — both work; chainable reads better for typed-stage thesis.
- **ADR13 (retry policy):** Hatchet/Inngest/Trigger.dev all have per-stage policy + global default + override. **Confidence HIGH.**
- **ADR14 (Reviewable<I>):** Temporal Signal as conceptual model for resume; Inngest `step.waitForEvent` as alternative durable backing. **Confidence HIGH** that pause/resume is the right shape.
- **ADR15 (test framework):** Vitest + fast-check confirmed; `@effect/vitest` exists if Effect adopted; Effect ecosystem uses tstyche for type-level tests — possibly consider for type-test layer. **Confidence HIGH for Vitest+fast-check core.**

**Open questions for brain adjudication:**

1. **Does pipeline-kit's Composer wrap a durable executor in v1, or does the user's app code call into pipeline-kit's stages from inside an Inngest/Trigger.dev task?** Two architectures: **(A)** pipeline-kit owns the durable layer (heavy — kit grows infra surface); **(B)** pipeline-kit is a library called BY the user's durable function (light — kit stays library, infra is user's choice). *Brain recommend: (B). Document explicitly in ADR3.*
2. **`@effect/workflow` as ADR3 v1 alternative?** Phase 2 should list it alongside Inngest/Trigger.dev/Hatchet in ADR3 alternatives. Becomes natural fit IF ADR1 adopts Effect.
3. **PIV Loop validation pyramid → pipeline-kit's own CI gates.** Layer 1-2 covered (typecheck, lint, vitest). Layer 3 E2E — what's the kit's E2E? **Reference projects (Trades Outbound) ARE the E2E.** Layer 4-5 — manual review = brain. *Encode in CLAUDE.md "Anti-patterns" section.*
4. **Schedule primitive for Source adapters?** Temporal/Hatchet/Trigger.dev all have first-class schedules. pipeline-kit Source v0 is pull-by-call; cron triggers come from outer composer (workflow engine calls pipeline-kit). *Brain recommend: defer Schedule to v2; keep v0 pull-only — confirms ADR2.*
5. **`stakes` (HumanLayer) + `confidence` (Gatewerk) + `priority` (Hatchet/Inngest) → does pipeline-kit ship a unified "route policy" object?** Three orthogonal signals from three sources. *Brain recommend: add a NEW ADR (route-policy shape) to Phase 2 catalog. Outline §7 doesn't currently cover this.*

---

## Category III — Source/connector patterns

Why THIRD: Source<O> reference adapters (api-source, webhook-source, apify-source, mcp-tool-source) are the v0 ship surface. Patterns inform ADR2 (pull vs push), ADR7 (streaming vs batch), and v0 reference adapter design.

### 14. Airbyte CDK — https://docs.airbyte.com/connector-development/cdk-python (Python)
- **Purpose:** "Framework for rapidly developing production-grade Airbyte connectors." Most-mature OSS connector pattern; Python-based; abstracts HTTP-API-source patterns into reusable, declarative components.
- **Core abstractions (verbatim):**
  - `AbstractSource` / `Source` — base connector entrypoint.
  - `Stream` — logical data partition (table/endpoint).
  - `HttpStream` — REST API specialization.
  - `IncrementalMixin` — stateful sync capability.
  - **Key attributes:** `primary_key`, `cursor_field`, `state`, `supports_incremental`.
  - **Data types:** `AirbyteRecord`, `AirbyteState`, `ConfiguredCatalog`, `SyncMode` (`full_refresh` / `incremental`).
- **API surface (representative methods):**
  - `read_records(stream_slice, sync_mode)` → yields records.
  - `get_updated_state(current_state, latest_record)` → state checkpoint.
  - `request_params(stream_state, stream_slice)` → dict for HTTP query.
  - `parse_response(response)` → record iterator.
  - `check_connection(config)` → bool (validates credentials).
  - `discover()` → ConfiguredCatalog (capability negotiation).
- **Cursor pagination + state checkpointing:** `stream_slices` partition work by `cursor_field` date ranges. `get_updated_state()` persists high-water marks; Airbyte replays state on resume — fault-tolerant resumption without full re-fetch.
- **Schema discovery:** `discover()` returns stream schema, supported sync modes, primary keys. Declarative schema binding.
- **What to lift (TS-transferable patterns):**
  - **`Source<O>` generic over output shape** → outline ADR; aligns with kit thesis.
  - **Slice abstraction decoupling pagination from iteration** → `Source<O>.iter()` for streaming + `Source<O>.fetch(cursor)` for batch maps to **ADR7** (streaming + batch primary). Slice = inner state.
  - **State checkpoint as JSON-serializable data** → kit's incremental Source state stored as JSON; passed as cursor between calls. **ADR2** pull semantic confirmed.
  - **`SyncMode` as capability negotiation** → kit's `Source<O>` declares supported modes (`'full' | 'incremental'`).
  - **`discover()` for schema discovery** → kit's Source can expose Zod schema introspection; lets Composer validate at registration time.
- **What to avoid:**
  - Don't lift Python-specific class hierarchy verbatim — kit is functional-core-imperative-shell; classes only when lifecycle demands (CLAUDE.md style rule).
  - Don't replicate Airbyte's full DAG runtime (workers, scheduler, orchestrator) — kit is library, Airbyte is platform.
  - Don't lift Airbyte's connector-spec-as-Docker-image distribution — pipeline-kit adapters are npm packages.
- **Stated non-goals:** Airbyte CDK doesn't position as a real-time/event-driven framework; batch/incremental focus.
- **License + community:** MIT (Airbyte). `airbytehq/airbyte-python-cdk` actively maintained. Airbyte-the-platform: ~16k+ stars; CDK is a sub-component.

### 15. Singer protocol — `singer-io/getting-started`
- **Purpose:** "Open source standard for moving data between databases, web APIs, files, queues — anything." Defines a JSON-line-over-stdout contract for Taps (extractors) and Targets (loaders); any tap composes with any target.
- **Core abstractions (verbatim from spec TOC):**
  - **Tap** — extraction script; reads from a Source; writes Singer messages to stdout.
  - **Target** — load script; reads Singer messages from stdin; persists to destination.
  - **Three message types:** `SCHEMA` (stream schema definition), `RECORD` (data row with stream + record + time_extracted), `STATE` (bookmarks/cursor state).
  - **Discovery mode** (separate invocation) — tap outputs `Catalog` with stream metadata + JSON schemas + supported replication methods.
  - **Sync mode** — tap reads catalog, emits SCHEMA + RECORD + STATE; target consumes.
- **API surface (canonical invocation):**
  ```bash
  # Discovery
  tap-foo --config config.json --discover > catalog.json

  # Sync (pipe tap to target)
  tap-foo --config config.json --catalog catalog.json --state state.json | target-bar --config target_config.json > new_state.json
  ```
- **Output message format (newline-delimited JSON):**
  ```json
  {"type": "SCHEMA", "stream": "users", "schema": {...}, "key_properties": ["id"]}
  {"type": "RECORD", "stream": "users", "record": {...}, "time_extracted": "..."}
  {"type": "STATE", "value": {"bookmarks": {"users": {"updated_at": "..."}}}}
  ```
- **What to lift:**
  - **Tap/Target separation** → maps directly to pipeline-kit's `Source<O>` / `Serve<I>` boundary. **ADR2** pull semantic confirmed.
  - **JSON-line streaming with three discriminated message types** → reference for kit's emission format if we want cross-process Source/Serve composition (v2). Could be the wire-protocol when pipeline-kit Composer spans processes.
  - **State as separate emission** → STATE messages flow alongside RECORD. Kit's Source can yield Atom records and emit cursor updates separately (e.g., `AsyncIterator<{ type: 'record'; data: O } | { type: 'state'; cursor: C }>`).
  - **Discovery mode as a separate invocation** → Source-as-binary pattern with `--discover` flag. Userland tooling (CLI), not kit primitive — unless v1 ships a `pk-source` CLI.
- **What to avoid:**
  - Don't adopt JSON-line stdout as the in-process kit format — kit composes via typed function calls, not pipes. Wire format is for cross-process only.
  - Don't replicate Singer's catalog metadata richness (replication-key chains, key_properties arrays) at the kit primitive level; userland adapters can include catalog as needed.
- **Stated non-goals:** Singer is a protocol, not a runtime. Doesn't specify scheduler, queue, or DAG. Meltano fills that gap.
- **License + community:** Apache 2.0 (most taps/targets). Stitch-authored; widely adopted; Meltano (now Matatika) maintains the ecosystem. Last commits to spec older — protocol stable, ecosystem moves to Meltano SDK.

### 16. Meltano — https://docs.meltano.com (thin signal from landing fetch — supplemented from Singer cross-reference)
- **Purpose:** Singer-based data orchestrator providing "control and visibility" of EL pipelines. Adds plugin discovery, environment management, state backends, transformations on top of vanilla Singer.
- **Core abstractions** (cross-referenced from Singer TOC + Meltano common knowledge — landing page didn't expose verbatim list):
  - **Extractor** (Singer Tap) and **Loader** (Singer Target) as managed plugins.
  - **Plugin** — versioned npm-equivalent for taps/targets/transformers/utilities.
  - **Job** — named pipeline composing extractor + loader.
  - **Schedule** — cron-based job invocation.
  - **Environment** — dev/staging/prod isolation with per-env config.
  - **State backend** — pluggable persistence for incremental cursors (file, S3, Postgres).
  - `meltano.yml` — declarative config file.
- **API surface (canonical CLI):**
  - `meltano init my-project`
  - `meltano add extractor tap-github`
  - `meltano add loader target-postgres`
  - `meltano run tap-github target-postgres` (composes Singer pipe)
  - `meltano schedule add nightly-sync --interval @daily ...`
- **What to lift:**
  - **Extractor/Loader plugin discovery model** → reference for pipeline-kit's adapter registry. Kit could ship `@pk-source/api`, `@pk-store/postgres`, etc as npm packages discovered by Composer.
  - **Environment isolation** → Composer accepts an environment context that overrides per-stage config (dev vs prod credentials). Possibly v1.
  - **State backend pluggability** → kit's `Source<O>` state cursor should be storable in any backend (file/Postgres/Redis). Maps to **ADR3** durable execution: state backend is part of the durable adapter.
- **What to avoid:**
  - Don't lift `meltano.yml` declarative config — pipeline-kit composes via TS code (chainable Pipeline.from()...). Declarative YAML is product surface.
  - Don't replicate Meltano's transformation runtime (dbt integration) — pipeline-kit `Process<I,O>` covers transformations as code.
- **Stated non-goals:** Not detailed in landing fetch. Meltano explicitly is not a real-time stream processor; batch ELT focus.
- **License + community:** MIT (Meltano core). Now under Matatika Limited (acquired). MeltanoLabs GitHub org. Active Slack + Stack Overflow. **Note: landing-page fetch was thin; Phase 2 should re-fetch /concepts pages if Meltano patterns become load-bearing for a specific ADR.**

### 17. Apify SDK for JavaScript/TypeScript — https://docs.apify.com/sdk/js
- **Purpose:** TypeScript/JavaScript SDK for building serverless cloud programs ("Actors") that perform web automation — form-filling, scraping, crawling. Runs locally or on Apify cloud platform.
- **Core abstractions (verbatim):**
  - `Actor` — lifecycle wrapper (`Actor.init()`, `Actor.exit()`, `Actor.getInput()`).
  - `Dataset` — append-only structured data store (push/retrieve).
  - `KeyValueStore` — key-value persistence.
  - `RequestQueue` — managed request scheduling with FIFO + dedup.
  - **Crawlers:** `BasicCrawler`, `CheerioCrawler`, `PlaywrightCrawler`, `PuppeteerCrawler`.
  - `ProxyConfiguration` — proxy rotation strategies.
  - `RequestList` — batch request sources (static).
  - `Session` — stateful session pool (cookies, headers).
- **API surface (representative TS):**
  ```typescript
  import { Actor } from 'apify';
  import { PlaywrightCrawler } from 'crawlee';

  await Actor.init();
  const input = await Actor.getInput<{ startUrls: string[] }>();

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 100,
    maxConcurrency: 10,
    maxRequestRetries: 3,
    async requestHandler({ request, page, pushData }) {
      const data = await page.evaluate(() => ({ title: document.title }));
      await pushData(data);
    },
  });
  await crawler.run(input.startUrls);
  await Actor.exit();
  ```
- **Crawler best practices:** autoscaling, retries via `maxRequestRetries`, proxy rotation via `ProxyConfiguration`, session pools, RequestQueue dedup.
- **What to lift:**
  - **Wrapping Apify Actor as `Source<O>` adapter** is direct: `ApifyActorSource<O>` constructor accepts `actorId` + `input` + Zod schema; `iter()` reads from the actor's Dataset; `fetch()` runs actor synchronously and returns batch.
    ```typescript
    interface ApifyActorSource<O> implements Source<O> {
      async *iter(): AsyncIterableIterator<O> {
        const run = await client.actor(actorId).start(input);
        const dataset = await client.dataset(run.defaultDatasetId);
        for await (const record of dataset.iterate<unknown>()) {
          yield this.schema.parse(record); // Zod validation at boundary (ADR6)
        }
      }
    }
    ```
  - **Crawler config (concurrency, retries, proxy)** → reference for kit's flow-control config block (**ADR10 + ADR13**). Apify's per-crawler config maps to per-stage config in kit.
  - **`Dataset` push/iterate pattern** → reference for `Store<T>` v0 design. Append-only, paginated iteration.
- **What to avoid:**
  - Don't wrap the Apify Actor lifecycle (`Actor.init/exit`) inside kit's primitive — that's userland concern. Kit treats Actor outputs as the typed source; actor lifecycle is opaque.
  - Don't lift Apify's Actor-as-process model (each Actor is a containerized run) — kit is in-process, library-level. Cross-process composition is v2 topic.
- **Stated non-goals:** Not an HTTP API client (separate `apify-client-js` library); not a workflow engine (Actors are individual runs).
- **License + community:** Apache 2.0 (Apify SDK + Crawlee). Active maintenance, ~15k+ stars (crawlee). Strong scraping-community traction.

### 18. n8n core nodes — https://docs.n8n.io/integrations/creating-nodes/overview/
- **Purpose:** Visual workflow engine's node architecture. Provides a runtime-agnostic abstraction for building integrations (actions, triggers, credentials) within n8n's DAG-based workflow runtime.
- **Core abstractions (verbatim):**
  - `INodeType` — interface a node class implements; paired with `INodeTypeDescription` metadata.
  - `INodeTypeDescription` — display name, icon, category, version, properties.
  - `INodeExecutionData` — data packet between nodes (`json` + `binary` payloads).
  - `IExecuteFunctions` — execution context (`getInputData()`, `getCredentials()`, `helpers.*`).
  - `ITrigger` — trigger-specific interface (returns subscription/promise, not data array).
  - `ICredentialType` + `INodeCredentialDescription` — credential schema definitions.
  - `NodeConnectionType` — enum: `'main'` (data flow), `'ai_tool'`, `'ai_memory'`, etc.
- **API surface (canonical TS pattern):**
  ```typescript
  export class MyAction implements INodeType {
    description: INodeTypeDescription = {
      displayName: 'My Action',
      name: 'myAction',
      group: ['transform'],
      version: 1,
      inputs: ['main'],
      outputs: ['main'],
      properties: [
        { displayName: 'Field', name: 'field', type: 'string', required: true,
          displayOptions: { show: { mode: ['simple'] } } },
      ],
    };
    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
      return [[{ json: { result: 'ok' } }]];
    }
  }
  ```
- **Trigger vs Action distinction:**
  | Aspect | Action | Trigger |
  |---|---|---|
  | Interface | `execute()` returns `INodeExecutionData[][]` | `trigger()` returns subscription/promise |
  | Cardinality | Multi-row in → multi-row out | One trigger event → workflow execution |
  | Metadata | `inputs: ['main']` | `inputs: []` |
- **What to lift:**
  - **Source/Process/Serve already encodes n8n's Trigger/Action/Output distinction at the type level.** No `displayOptions` runtime DSL needed — pipeline-kit uses TS discriminated unions for parameter shapes. **ADR confirmation, not new ADR.**
  - **Credentials as typed values** (vs n8n's runtime `getCredentials()` lookup) → kit accepts credentials at adapter construction; type-checked at compile time.
  - **`INodeExecutionData[][]` multi-item batching** → kit's `Source<O>` returns `AsyncIterableIterator<O>` (single-record stream) OR `O[]` batch — explicit at type level via **ADR7** dual `iter()` + `fetch()` shape.
- **What to avoid:**
  - Don't replicate `displayOptions` conditional-properties DSL — userland Zod schemas express constraint shape better.
  - Don't lift n8n's class-based node convention — pipeline-kit uses functional-core-imperative-shell (CLAUDE.md style rule).
  - Don't take n8n's marketplace categorization model verbatim — pipeline-kit's adapter taxonomy is type-driven (Source/Store/Process/Serve), not display-driven.
- **Stated non-goals:** n8n is a workflow runtime, not a library. Nodes only execute inside n8n's DAG runtime.
- **License + community:** **n8n Sustainable Use License** — free for organizations under $5M annual revenue; commercial license required above. ~50k+ stars. **Note: pipeline-kit cannot import n8n code directly without license review for commercial users.** Pattern lift only.

### 19. Activepieces — `activepieces/activepieces`
- **Purpose:** "All-in-one AI automation designed to be extensible through a type-safe pieces framework written in TypeScript." Self-positioning: "open source replacement for Zapier." Pieces are npm packages; ~280+ shipped, 60% community-contributed; ~400 MCP servers via marketplace.
- **Core abstractions:**
  - **Piece** — a typed integration package (npm). Contains actions + triggers + auth + display metadata.
  - **Action** — a typed function consuming input + auth → emits typed output.
  - **Trigger** — polling- or webhook-based event source.
  - **CustomAuth** / **OAuth2** helpers — auth-flow abstractions.
  - **AI pieces** (native) — provider-pluggable LLM integrations.
  - **Human-input triggers** — built-in `Chat Interface` and `Form Interface` for human-initiated workflows. **Notable: HITL pieces (Delay, Approval) are built on the piece framework, not a separate primitive.**
- **API surface (canonical pattern, from `activepieces.com/docs/build-pieces`):**
  ```typescript
  import { createPiece, createAction, createTrigger, Property } from '@activepieces/pieces-framework';

  export const myPiece = createPiece({
    displayName: 'My Service',
    auth: PieceAuth.SecretText({ displayName: 'API Key', required: true }),
    actions: [
      createAction({
        name: 'send_message',
        props: { message: Property.ShortText({ displayName: 'Message' }) },
        async run(context) {
          const { auth, propsValue } = context;
          // ... call API
          return { ok: true };
        },
      }),
    ],
    triggers: [/* ... */],
  });
  ```
- **What to lift:**
  - **Type-safe pieces framework as adapter pattern** → directly aligns with pipeline-kit's adapter design. `createSource()`, `createProcess()`, `createServe()` factory functions in kit mirror Activepieces's `createAction()` / `createTrigger()`.
  - **Hot-reload for local piece development** → reference for pipeline-kit's developer experience: `pnpm dev` should hot-reload adapter changes.
  - **HITL as a piece, not a separate primitive** → confirms **ADR14** Reviewable<I> approach: review checkpoint is a Process wrapper, not a special-case orchestrator hook.
  - **Pieces auto-published as MCP servers** → reference for kit's adapters being trivially exposable as MCP. Could auto-generate `@pk-mcp/<adapter>` from any kit Source/Process/Serve.
  - **Human-input trigger interfaces (Chat / Form)** → reference for kit's Source adapters that bridge from human input. Possible v1 reference: `chat-source`, `form-source`.
- **What to avoid:**
  - Don't lift the dual MIT-Community + Commercial-EE license split — pipeline-kit is single-license (TBD; Phase 2). Mixing is product-org concern.
  - Don't lift the visual builder UI / no-code editor — that's product surface, kit is library.
  - Don't replicate the AI SDK as a kit primitive — pipeline-kit `extract-process` is provider-pluggable but doesn't wrap the AI SDK itself.
- **Stated non-goals:** Activepieces explicitly positions as Zapier-replacement; not lighter-weight library tier. Pipeline-kit lives below this layer.
- **License + community:** MIT (Community Edition) + Commercial EE. Active Discord. ~13k+ stars. Critical signal for pipeline-kit: **TS-first, type-safe, MCP-native pieces ecosystem already exists.** pipeline-kit's positioning must clearly differentiate (kit lives BELOW the workflow engine; Activepieces IS the workflow engine).

---

### Category III — Synthesis

**Top 3 patterns to lift across Source/connector category:**

1. **Tap/Source separation from Target/Serve at the protocol level** (Singer/Airbyte/Meltano converge): each adapter declares its capability (sync mode, schema, primary key) and emits typed records + state. pipeline-kit's `Source<O>` declares `O` (output shape), supports `iter()` + `fetch()` (**ADR7**), exposes capability via TypeScript types (no runtime catalog needed for v0). **Confidence HIGH.**

2. **State checkpoint as pluggable, JSON-serializable cursor** (Airbyte's `state`, Meltano's state backend, Singer's STATE messages): Source returns cursor in addition to records; cursor is opaque to Composer, persisted by user-chosen backend. Maps to **ADR2** (pull-Singer-compatible) + **ADR3** (durable adapter holds state). **Confidence HIGH.**

3. **Adapter as typed factory function** (Activepieces `createAction`/`createTrigger`, n8n class-with-description, Apify Actor-as-package): pipeline-kit ships `createSource()` / `createProcess()` / `createServe()` factories that bind config + types. Cleaner than class hierarchy; aligns with kit's functional-core-imperative-shell rule. **Confidence HIGH.**

**Top 2 pitfalls to avoid:**

1. **Visual-builder DSL surface** (n8n displayOptions, Activepieces visual editor, Airbyte connector spec). pipeline-kit stays code-first; userland uses TS types + Zod for parameter shape, not a runtime DSL. Visual builder is downstream consumer concern (Gatewerk's product, n8n's product).

2. **Replicating runtime infrastructure** (Airbyte workers, Meltano scheduler, Apify Actor lifecycle, n8n execution engine). pipeline-kit is library; runtime is userland or a v1 durable adapter (**ADR3**). Don't grow infra surface.

**Implications for ADRs:**

- **ADR2 (Source semantic — pull, Singer-compatible):** Strongly confirmed. Singer + Airbyte + Meltano + Apify all converge on pull-with-cursor. Push (CDC) deferred. **Confidence HIGH.**
- **ADR7 (streaming + batch dual primary):** Strongly confirmed. Airbyte's `read_records` yields, Apify's `Dataset.iterate()` yields, n8n's `execute()` returns batch. Kit's `Source<O>.iter()` (AsyncIterable) + `Source<O>.fetch()` (batch) covers both. **Confidence HIGH.**
- **ADR6 (Zod boundary validation):** Confirmed at Source output boundary. Airbyte's `discover()` + Singer's SCHEMA messages validate at protocol level; pipeline-kit does this at type level via Zod. **Confidence HIGH.**
- **ADR9 (idempotency on Serve):** Confirmed across all sources. Singer Targets are typically idempotent (UPSERT-style); n8n's INodeExecutionData multi-item batches assume Target dedup; Apify's RequestQueue dedups on URL. **Confidence HIGH.**
- **ADR11 (migration story — Drizzle):** Not directly addressed by Source-category sources, but Activepieces + Meltano use SQL-ORM-style migrations for state backends. Confirms relational store baseline. **Confidence HIGH.**
- **ADR16 (naming conventions):** `createPiece` / `createAction` / `createTrigger` patterns from Activepieces validate the `createSource` / `createProcess` / `createServe` naming for kit. **Confidence HIGH.**

**Open questions for brain adjudication:**

1. **Does pipeline-kit ship a registry/marketplace primitive in v0, or just adapter packages?** Activepieces has a piece marketplace (~280 pieces, MCP-auto-generated); n8n has a node marketplace; Apify has Actor marketplace. *Brain recommend: v0 ships adapter packages as separate npm packages (`@pk-source/api`, `@pk-source/apify`, etc.); marketplace defer to v2 (per outline §11 v2 candidates).*
2. **Catalog/discovery format for v1+?** Singer/Airbyte have rich catalog format; pipeline-kit has TypeScript types. Should kit ship a JSON-schema-export that mirrors Singer's catalog for cross-language consumers? *Brain recommend: defer until cross-language demand emerges.*
3. **Source-as-binary CLI for cross-process composition?** Singer's stdin/stdout pipe model is canonical for cross-language. *Brain recommend: defer to v2 (along with cross-process Composer).*
4. **Auto-generate MCP server from Source adapter?** Activepieces auto-publishes pieces as MCP servers; pipeline-kit could auto-generate `@pk-mcp/<adapter-name>` from any Source/Serve. *Brain recommend: design space for v1; aligns with `mcp-tool-source` + `mcp-tool-serve` adapters listed in outline §11 v0.*
5. **n8n license risk if kit users compose pipeline-kit pipelines INTO n8n nodes?** n8n Sustainable Use License restricts commercial use over $5M revenue. *Brain recommend: document in spec — pipeline-kit-into-n8n is fine for users under threshold; over threshold, users must license n8n separately. Not pipeline-kit's concern.*

---

## Category VII — HTTP / webhook / event

Why FOURTH: `webhook-source` (incoming with HMAC verify) + `webhook-serve` (outbound with HMAC sign) are v0 reference adapters. Patterns inform ADR17 (webhook signing), ADR16 (naming), and Composer's HTTP layer.

### 38. Hono — https://hono.dev
- **Purpose:** Small, ultrafast TypeScript HTTP framework on Web Standards. Cross-runtime: Cloudflare Workers, Deno, Bun, Node, AWS Lambda, Lambda@Edge, Vercel, Netlify, Azure Functions, Supabase Functions, etc.
- **Core abstractions (verbatim):**
  - `Hono` — app instance.
  - `Context` (`c`) — request/response handler context: `c.req`, `c.json()`, `c.text()`, `c.html()`, `c.html()`, etc.
  - `Handler` — `(c: Context) => Response | Promise<Response>`.
  - `Middleware` / `MiddlewareHandler` — pipeline interceptors.
  - `Router` — `RegExpRouter` (default), `TrieRouter` (alternative).
  - `Validator` — middleware for request validation; integrates natively with Zod via `@hono/zod-validator`.
  - **RPC mode** — type-safe client generation from server route definitions (similar to tRPC).
  - JSX support — server-side rendering.
- **API surface (representative TS):**
  ```typescript
  import { Hono } from 'hono';
  import { zValidator } from '@hono/zod-validator';
  import { z } from 'zod';

  const app = new Hono();

  app.use('*', async (c, next) => { /* logging middleware */ await next(); });

  app.post(
    '/webhooks/source/:source',
    zValidator('json', z.object({ event: z.string(), data: z.unknown() })),
    async (c) => {
      const { source } = c.req.param();
      const body = c.req.valid('json');
      // Verify HMAC, dispatch to Source<O>
      return c.json({ ok: true });
    }
  );

  export default app;
  ```
- **Built-in security middleware:** CORS, CSRF, Secure Headers, Bearer Auth, Basic Auth, JWT, JWK, IP Restriction, Request ID, ETag, compression, timeout.
- **What to lift:**
  - **Hono as the HTTP layer for `webhook-source` v0 adapter** — already in outline §11 v0 (`webhook-source — Hono-backed`). Confirmed.
  - **Zod validator middleware** → ADR6 boundary validation at the HTTP edge. Standard pattern.
  - **Cross-runtime Web Standards target** → kit's webhook-source can run anywhere kit's runtime targets reach (Node 20+, Bun-tested per CLAUDE.md).
  - **RPC mode** (typed client gen) → reference pattern; kit doesn't ship its own RPC mode but Composer-as-MCP pattern is conceptually similar.
- **What to avoid:**
  - Don't lift JSX rendering — pipeline-kit is library, not framework. UI rendering is downstream.
  - Don't lift Hono's full middleware stack as default — kit's webhook-source uses a minimal set (HMAC verify, body parse, dispatch).
  - Don't expose Hono as a public dependency in the kit's API surface — wrap it. Allows future swap if Hono evolves.
- **Stated non-goals:** Not stated explicitly in landing fetch. Hono's narrow scope (HTTP routing + middleware) is intentional.
- **License + community:** MIT. ~21k+ stars (well-known). Active maintenance; v4.x stable. Dominant edge-runtime TS framework.

### 39. CloudEvents v1.0.2 spec — `cloudevents/spec`
- **Purpose:** "CNCF specification for describing event data in common formats to provide interoperability across services, platforms and systems." Graduated CNCF project (Jan 2024). Primary deliverable: a vendor-neutral envelope for any event payload.
- **Core abstractions (verbatim, v1.0.2):**
  - **4 required attributes:** `id` (unique per source), `source` (URI-reference identifying event-producing context), `specversion` (e.g., `"1.0"`), `type` (event type, e.g., `com.github.pull_request.opened`).
  - **Optional attributes:** `datacontenttype`, `dataschema`, `subject`, `time` (RFC3339), `data` (payload).
  - **3 HTTP binding modes:** Binary (CE attrs as `Ce-*` HTTP headers + data as body), Structured (full event as JSON body), Batched (array of events).
  - **Format bindings:** JSON, Avro, Avro Compact, Protobuf, XML.
  - **Protocol bindings:** HTTP, AMQP, Kafka, MQTT, NATS, WebSockets.
  - **Webhook spec** — separate document `cloudevents/http-webhook.md` with abuse-protection + validation flow.
- **API surface (canonical JSON event):**
  ```json
  {
    "specversion": "1.0",
    "type": "com.example.pipeline.run.completed",
    "source": "https://pipeline-kit.example.com/runs",
    "id": "pk_run_abc123",
    "time": "2026-05-06T19:00:00Z",
    "datacontenttype": "application/json",
    "subject": "pipeline-trades-outbound",
    "data": { "atomCount": 42, "duration": 3.2 }
  }
  ```
- **What to lift:**
  - **4-attribute envelope** as inspiration for kit's response envelope (**ADR16**: `id`, `object`, `created_at`, `metadata`). pipeline-kit's existing envelope is Stripe-shaped (per Gatewerk's `ideas-to-steal.md`); cross-reference with CloudEvents shows mostly compatible — kit could output CloudEvents-formatted webhook payloads for `webhook-serve` adapter. **Possible Phase 2 ADR** — does pipeline-kit emit Stripe-shape, CloudEvents-shape, or dual?
  - **Structured vs Binary HTTP binding modes** → reference for `webhook-serve` adapter: structured-mode (whole event JSON in body) is simpler and aligns with Stripe-shape; binary-mode (CE-* headers) is for streaming-protocol interop.
  - **`subject`** field as scoping → kit's `Pipeline.run` ID could populate `subject` for fan-out tracing.
  - **Webhook spec validation flow** (abuse protection, OPTIONS preflight, allowed origins) → reference for `webhook-source` SSRF + intake hardening.
- **What to avoid:**
  - Don't adopt CloudEvents as the kit's mandatory output envelope — outline §7 ADR16 already locks Stripe-shape (id/object/created_at/metadata). CloudEvents is a webhook-emission option, not the core.
  - Don't lift the protocol-binding catalog (AMQP/Kafka/MQTT/NATS) — out of scope for v0.
- **Stated non-goals:** CloudEvents is a *spec*, not a runtime or SDK. Doesn't mandate event semantics, only envelope structure.
- **License + community:** Spec under CNCF (Apache 2.0). Industry-wide adoption: AWS, Azure, GCP, Knative, Argo, Tekton, etc. SDKs in 9 languages incl. JavaScript. **Critical for cross-system interop** if pipeline-kit serves into AWS EventBridge / Azure Event Grid / Knative — CloudEvents is the lingua franca.

### 40. Stripe webhook engineering — HMAC + tolerance window (REFERENCED via Gatewerk source 21)
- **Purpose:** Stripe-canonical webhook signing pattern: HMAC-SHA256 over `<timestamp>.<payload_body>`, header `Stripe-Signature: t=<unix>,v1=<hex>`, 5-minute tolerance window for replay protection.
- **Core abstractions:** `signature header` (multi-value, comma-separated) + `tolerance window` (default 300s) + `constant-time comparison`.
- **API surface (verification pattern):**
  ```typescript
  function verify(rawBody: string, header: string, secret: string, tolerance = 300): Event {
    const { t, v1 } = parseHeader(header);
    if (Math.abs(Date.now()/1000 - Number(t)) > tolerance) throw new Error('expired');
    const expected = hmacSha256(secret, `${t}.${rawBody}`);
    if (!constantTimeEqual(v1, expected)) throw new Error('invalid signature');
    return JSON.parse(rawBody);
  }
  ```
- **What to lift:** **Whole pattern → ADR17 webhook signing.** Already adopted by Gatewerk and inherited by pipeline-kit per outline §7. **Cross-reference Gatewerk's `ideas-to-steal.md` §3** for full pattern catalog incl. SDK webhook verification (`gw.webhooks.verify(rawBody, sigHeader, secret) → typed event`) + typed webhook events as discriminated unions. **Direct adoption.**
- **What to avoid:** Don't accept signatures without timestamp tolerance check (replay risk). Don't use `===` for hash comparison (timing attack).
- **Stated non-goals:** Stripe webhooks aren't event-bus-shaped; one webhook = one event. No batched delivery from Stripe's side.
- **License + community:** Stripe Node SDK MIT. Industry-canonical pattern.

### 41. Hatchet webhook patterns — multi-auth + encrypted secrets (REFERENCED via Gatewerk source 21 + source 5)
- **Purpose:** Hatchet's outbound webhook architecture: multi-auth (Basic / API Key / HMAC), encrypted secrets at rest, constant-time HMAC comparison.
- **Core abstractions:** Per-webhook auth method (selected at registration); secret stored encrypted (decrypted only at signing time); HMAC verify uses constant-time comparison.
- **What to lift:** **Multi-auth support → ADR17 extension.** pipeline-kit's `webhook-serve` adapter accepts auth method (HMAC default; Basic / Bearer / API Key as alternatives). Already in Gatewerk's `ideas-to-steal.md` §3 as a pattern. **Direct adoption.**
- **What to avoid:** Don't store secrets unencrypted. Don't allow auth method downgrade post-registration without explicit confirmation.
- **License + community:** Hatchet MIT. See source 5 for full reference.

### 42. Resend webhook verification SDK pattern (REFERENCED via Gatewerk source 21)
- **Purpose:** Resend SDK's webhook verification ergonomics: typed `gw.webhooks.verify(rawBody, sigHeader, secret) → typed event` returning a discriminated union (`'email.sent' | 'email.delivered' | 'email.bounced' | ...`).
- **Core abstractions:**
  - SDK method `webhooks.verify` — bundled into the resource-based client.
  - Typed event union — TS DX for switch-on-type.
- **API surface:**
  ```typescript
  const event = resend.webhooks.verify(rawBody, signatureHeader, webhookSecret);
  switch (event.type) {
    case 'email.sent': /* event.data is EmailSentData */ break;
    case 'email.bounced': /* ... */ break;
  }
  ```
- **What to lift:**
  - **SDK-bundled webhook verification** — pipeline-kit ships `pipelinekit.webhooks.verify(rawBody, sig, secret) → PipelineKitEvent` as part of the kit SDK. Saves users from re-implementing HMAC. **ADR17 extension.**
  - **Typed event union as SDK return** → TS DX pattern. **Confidence HIGH.**
- **What to avoid:** Don't expose raw HMAC primitives in SDK surface — bundle them.
- **License + community:** Resend SDK MIT. Industry-popular ergonomics pattern.

---

### Category VII — Synthesis

**Top 3 patterns to lift across HTTP/webhook/event category:**

1. **HMAC-SHA256 + timestamp tolerance window for webhook signing** (Stripe + Gatewerk + Hatchet converge unanimously). Maps to **ADR17**. Already adopted by Gatewerk; inherited by pipeline-kit. Multi-auth support (HMAC default; Basic/Bearer/API Key alternatives) per Hatchet's pattern. **Confidence HIGH.**

2. **SDK-bundled webhook verification with typed event union return** (Resend + Stripe SDK pattern). pipeline-kit ships `webhooks.verify(rawBody, sig, secret) → PipelineKitEvent` returning a discriminated union of event types. Maps to **ADR17 + ADR16 (SDK ergonomics)**. **Confidence HIGH.**

3. **Hono + Zod validator middleware** for `webhook-source` v0 adapter (per outline §11). Cross-runtime, type-safe, edge-friendly. Maps to **ADR6 + ADR17**. **Confidence HIGH.**

**Top 2 pitfalls to avoid:**

1. **Constant-time comparison failure** — `===` on HMAC strings is a timing-attack surface. Use `crypto.timingSafeEqual` or equivalent. Already in Gatewerk's `ideas-to-steal.md` §10.

2. **SSRF on incoming webhook URLs** — if `webhook-source` accepts user-configurable callback URLs, validate against private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x), normalize URLs (Unicode/encoding attacks), handle redirects safely. Already in Gatewerk's catalog §10.

**Implications for ADRs:**

- **ADR17 (webhook signing):** Strongly confirmed. HMAC-SHA256 + 5-min tolerance + constant-time comparison + multi-auth support + SDK-bundled verify. **Confidence HIGH.**
- **ADR6 (Zod boundary validation):** Reinforced — Hono + zod-validator middleware confirms Zod at HTTP edge. **Confidence HIGH.**
- **ADR16 (naming + envelope):** Cross-reference with CloudEvents — pipeline-kit's Stripe-shape envelope (id/object/created_at/metadata) is largely compatible with CloudEvents v1.0.2 (id/source/specversion/type/time/data). **Possible Phase 2 ADR addition: should `webhook-serve` emit CloudEvents-formatted payloads as an option?** Recommend YES for cross-system interop.

**Open questions for brain adjudication:**

1. **CloudEvents-formatted webhook payload as an option for `webhook-serve`?** Default is Stripe-shape; CloudEvents-shape as opt-in via config. Adds value for users serving into AWS EventBridge / Azure Event Grid / Knative ecosystems. *Brain recommend: YES, design as an opt-in mode for v1.*
2. **`webhook-source` runtime targets** — does it bundle Hono runtime startup or expose a request handler users plug into their own server? *Brain recommend: expose a Hono `app` instance OR a generic Web-Standards `(req: Request) => Promise<Response>` handler — both options. Userland chooses runtime.*
3. **Idempotency-key-via-webhook-header** — Stripe + Knock pattern requires `Idempotency-Key` HTTP header on POSTs. pipeline-kit's `webhook-source` adapter should accept and forward this to the dispatched stage. *Brain recommend: standard practice, no debate needed.*

---

## Category V — Reliability patterns

Why FIFTH: foundational patterns informing ADR3 (durable execution), ADR9 (idempotency), ADR10 (backpressure), ADR13 (retry), ADR18 (audit). Cross-references heavily with Categories I (durable executors) and VII (webhook signing).

### 28. Outbox Pattern — https://microservices.io/patterns/data/transactional-outbox.html
- **Purpose:** Solves dual-write problem — atomically update database state AND publish messages to a broker without distributed transactions (2PC).
- **Core mechanic:** Service writes business entity update + outgoing message to outbox table in same DB transaction. Separate message-relay process polls outbox, publishes messages, marks published. **Guarantee:** "Messages are guaranteed to be sent if and only if the database transaction commits."
- **Core abstractions:** Outbox table schema `(id, message_payload, published_flag, created_at, published_at)`. **Two relay implementations:** Polling Publisher (simpler, higher latency) vs Transaction Log Tailing (CDC-style, more infra). Consumer-side dedup by message ID is mandatory.
- **What to lift:**
  - **Outbox pattern for `Serve<I>` adapters that mutate external state** → reliable-emit in v1 durable adapter. Maps to **ADR9 + ADR3 + ADR18**.
  - **Polling Publisher first** (simpler infra) → v1; Transaction Log Tailing as v2 option.
  - **Composes with Saga** for multi-system writes (Outbox = single-DB→multi-broker; Saga = multi-DB orchestration).
- **What to avoid:**
  - Don't try this at v0 — Composer is sync in-process; Outbox makes sense only when crossing process boundaries.
  - Don't lift "Eventuate Tram" framework (Java) — pattern is portable; impl is per-language.
  - Outbox doesn't dedup downstream — consumers MUST be idempotent (cross-reference Stripe pattern source 30).
- **Stated non-goals:** Doesn't handle consumer-side dedup; doesn't replace Saga.
- **License + community:** Pattern catalog (Chris Richardson, microservices.io). Foundational reference; widely cited.

### 29. Saga Pattern — https://microservices.io/patterns/data/saga.html
- **Purpose:** Distributed transaction across microservices without 2PC. Maintains data consistency when business operation spans multiple service-owned databases.
- **Core mechanic — two coordination styles:**
  - **Choreography:** each local transaction publishes domain events that trigger next local transaction in another service.
  - **Orchestration:** central orchestrator tells participants which local transactions to execute.
- **Compensating transactions:** on local-transaction failure (business rule violation), saga executes compensating transactions in reverse order. **Manual design** — no automatic rollback.
- **Resulting context:**
  - Solved: data consistency across services without 2PC.
  - **Not solved:** lack of automatic rollback (compensating logic is manual); lack of isolation (concurrent sagas risk anomalies; need countermeasures like semantic locks).
- **What to lift:**
  - **Orchestration pattern** for kit v2 multi-system Serve composition (`PipelineServe.saga(...)`). Outline §11 v2 lists "Saga-pattern multi-system writes."
  - **ACD vs ACID** pragmatism — accept Atomicity + Consistency + Durability without Isolation; document tradeoff in spec.
  - **Compensating transaction as first-class** in `Serve<I>` v2 — adapter declares `emit()` AND `compensate()`.
- **What to avoid:**
  - Don't ship Saga in v0 or v1 — outline §11 explicitly v2. Premature complexity.
  - Don't choose Choreography by default for kit users; Orchestration aligns better with Composer's central-coordinator role.
- **Stated non-goals:** Saga doesn't provide ACID isolation; doesn't replace Outbox (they compose).
- **License + community:** Pattern catalog (Chris Richardson). Foundational reference.

### 30. Stripe idempotency-key engineering — https://stripe.com/blog/idempotency
- **Purpose:** Canonical 2017 blog establishing idempotency keys as industry-standard for safely-retryable mutating API calls. Pattern adopted by Stripe SDK, Knock, Resend, Gatewerk; pipeline-kit inherits.
- **Core mechanic:**
  - Client passes unique ID via `Idempotency-Key` HTTP header on POST endpoints.
  - Server caches result of first request with that key.
  - Subsequent requests with same key return cached result; no re-execution.
- **Edge cases handled:** Connection failure pre-server (key new on retry); mid-operation failure (server recovers state, ACID rollback → safe to retry wholesale); response loss (server replies with cached success on retry).
- **What to lift:**
  - **Whole pattern → ADR9.** Already adopted via Gatewerk's `ideas-to-steal.md` §1. Direct inheritance.
  - **Auto-generate idempotency keys at SDK layer** (Knock pattern, also in Gatewerk catalog) — kit's SDK auto-generates UUIDs for mutating calls so users don't have to.
  - **Pair with exponential backoff + jitter on retry** (Stripe SDK does this) → cross-references with AWS reliability source 31.
- **What to avoid:**
  - **No explicit TTL specified** in Stripe's article — pipeline-kit MUST define explicit cache window (recommend 24h default; configurable).
  - **Key collision risk** if users reuse keys (e.g., generate from non-unique input). Kit warns when key derives from request body hash; kit accepts opaque keys verbatim.
  - **Stale-data replay** — if cached response was 200 but downstream state has changed, replay returns stale. Document explicitly.
- **Stated non-goals:** Doesn't provide write-through dedup at downstream system level; request-level only.
- **License + community:** Industry-canonical. Stripe Node SDK MIT.

### 31. AWS Builder's Library — Timeouts, Retries, Backoff with Jitter
- **Purpose:** Authoritative AWS guide on coordinating timeouts, retries, and exponential backoff with jitter to prevent cascading failures + resource exhaustion under load.
- **Three core patterns:**
  - **Timeouts** — set max wait based on downstream's latency percentile (e.g., p99.9, accept 0.1% false-timeout rate). Prevents resource starvation.
  - **Retries** — recover from transient failures, but "retries are selfish": they increase backend load during overload, potentially worsening recovery. Safe ONLY for idempotent operations.
  - **Exponential backoff + jitter** — `min(cap, base * 2^attempt) + random(0, backoff)`. Desynchronizes retries; avoids thundering herd.
- **Retry budget / token-bucket:** AWS SDK (2016) uses token-bucket — allows retries while tokens available, throttles to fixed rate when exhausted. Bounds retry load without modal circuit-breaker complexity.
- **Idempotency requirement:** "APIs with side effects aren't safe to retry unless they provide idempotency." Cross-reference source 30.
- **Canonical recommendations (table-form for ADR13):**
  | Param | Recommendation |
  |---|---|
  | Base delay | 100ms |
  | Max delay | 10-32s (capped exponential) |
  | Max attempts | 3-5 retries |
  | Formula | `min(cap, base * 2^attempt)` |
  | Jitter | `random(0, backoff)` |
  | RetryAfter header | Always respect |
  | Idempotency token | Mandatory for mutations |
- **What to lift:**
  - **All recommendations → ADR13 retry policy default.** Direct adoption.
  - **Token-bucket retry budget** → kit-level circuit breaker analog. Outline §11 v0 lists "circuit breaker" in Composer; AWS pattern is the canonical implementation.
  - **Deterministic jitter per-host for scheduled work** — interesting addendum for v2 `Schedule` Source adapters.
- **What to avoid:**
  - Don't lift modal circuit-breaker pattern — token-bucket is simpler. (Hatchet's RateLimit primitive is also token-bucket.)
  - Don't retry non-idempotent operations — kit MUST refuse retries on `Serve<I>` adapters that don't accept idempotency keys.
- **Stated non-goals:** Doesn't replace per-call timeout tuning; doesn't substitute for upstream load-shedding.
- **License + community:** AWS Builder's Library publicly accessible architectural guidance.

### 32. "Fail at Scale" — Ben Maurer (Facebook Engineering, ACM Queue 2015)
- **Purpose:** Foundational paper on the three primary causes of large-scale failures and the mitigation patterns. **Note: queue.acm.org/detail.cfm?id=2839461 returned HTTP 403; note synthesized from paper's well-known content (Maurer was Facebook's reliability lead; paper is industry-canonical).**
- **Three main causes of scale failures:**
  - **Rapid deployment of changes** — bad deploys hit large fleets quickly. Mitigation: controlled rollout (canary, percentage-based), automatic rollback on health-check failure.
  - **Hardware failures** — at scale, hardware fails constantly; software must tolerate. Mitigation: redundancy, fast failure detection, graceful degradation.
  - **Latency creep / load shifts** — small latency increases cascade into queue buildup. Mitigation: dynamic capacity (load shedding), strict timeouts, retry budgets.
- **Key concepts:**
  - **Thundering herd:** synchronized retries hammer a recovering server. Solution: jitter (cross-reference source 31).
  - **Metastable failure:** system enters degraded state from which it cannot recover without intervention (e.g., retry storm pinning CPU at 100%). Solution: load shedding, circuit breakers, retry budgets.
- **Mitigation pattern stack:** controlled deployment + automatic rollback / dynamic capacity (load shedding) / strict timeouts / retry budgets / structured observability.
- **Observability requirements:** error rate per service / latency percentiles (p50/p95/p99/p99.9) / queue depth / retry rate / load shedding rate. Without these, incident response is blind.
- **What to lift:**
  - **Retry budget concept** → reinforces source 31's token-bucket. **ADR13 + ADR10** convergence.
  - **Metastable failure framing** → kit users should understand retries-without-budget can pin a system. Document explicitly in spec.
  - **Observability requirements** → **ADR8** OpenTelemetry native: traces with parent/child + structured logs + percentile metrics. Outline §12 test plan already mandates OTel spans.
  - **Graceful degradation** → kit's Serve<I> adapters should support a `fallback` mode (route to dead-letter, log + skip) for persistent failures. Outline §11 v0 includes this.
- **What to avoid:**
  - Don't ship reliability features without observability to verify them — flying blind.
  - Don't conflate "retry forever" with "reliable" — bounded retries + circuit breaker > infinite retries.
- **Stated non-goals:** Paper is descriptive + prescriptive; not a runtime spec.
- **License + community:** ACM Queue paper (paywalled abstract); industry-canonical reading.

---

### Category V — Synthesis

**Top 3 patterns to lift across reliability category:**

1. **Idempotency-key + exponential-backoff-with-jitter + retry-budget (token-bucket).** Stripe + AWS + Fail at Scale + Inngest + Hatchet all converge. Maps to **ADR9 + ADR10 + ADR13**. Direct adoption. **Confidence HIGH.**

2. **Outbox pattern for reliable Serve emit in v1 durable adapter.** Solves dual-write at the kit's `Store<T>`-to-`Serve<I>` boundary when state crosses process boundaries. Maps to **ADR3** (durable v1) + **ADR18** (audit log). **Confidence HIGH for v1.**

3. **Observability as a reliability primitive, not an add-on.** Fail at Scale + AWS Builder's Library + all 5 architecture references converge: traces + percentile metrics + structured logs are not optional. Maps to **ADR8** OpenTelemetry native. **Confidence HIGH.**

**Top 2 pitfalls to avoid:**

1. **Retries without budget = thundering herd / metastable failure.** Token-bucket caps retry load. Kit MUST ship retry budget by default; users opt-out only with explicit acknowledgment.

2. **Idempotency without TTL or scope contract = stale-replay risk.** Stripe doesn't specify TTL; kit MUST. Recommend 24h default + configurable; document scope (key matches request body fingerprint or only header).

**Implications for ADRs:**

- **ADR9 (idempotency convention):** Strongly confirmed. Kit auto-generates keys for `Serve<I>` adapters; auto-pairs with exp-backoff-with-jitter on retry. **Confidence HIGH.**
- **ADR10 (backpressure / token-bucket):** Strongly confirmed at Source AND Serve boundary. Token-bucket = retry budget = rate-limit; same primitive. **Confidence HIGH.**
- **ADR13 (retry policy):** AWS canonical defaults adopted. Per-stage policy + global default + override. Base 100ms / max 10-32s / max 3-5 attempts / RetryAfter respected / idempotency required for retry. **Confidence HIGH.**
- **ADR3 (sync v0, durable v1):** Outbox + Saga frame the v1 durable adapter design. v1 ships Outbox-style reliable emit; v2 ships Saga orchestration. **Confidence HIGH for sequencing.**
- **ADR18 (audit log via `Audited<I,O>`):** Outbox table schema `(id, payload, published_flag, ...)` is the audit log shape. Direct reference. **Confidence HIGH.**

**Open questions for brain adjudication:**

1. **Retry budget shape** — global per-Pipeline (composer-level) or per-Stage (adapter-level) or both? *Brain recommend: both. Stage default is bounded; composer enforces aggregate limit.*
2. **Idempotency TTL default** — 24h reasonable? Stripe doesn't specify. *Brain recommend: 24h default; document explicitly. Regulated verticals (healthcare, finance) may want longer.*
3. **Saga v2 vs Outbox v1 sequencing** — does v1 ship Outbox-only, then v2 add Saga? Or both at v1? *Brain recommend: v1 Outbox only; v2 Saga (per outline §11). Saga complexity earns its own milestone.*
4. **Circuit breaker primitive** — outline §11 v0 lists "circuit breaker" alongside token-bucket. AWS pattern says token-bucket subsumes circuit breaker for most cases. *Brain recommend: token-bucket primary; explicit circuit breaker as opt-in for users who want hard-trip semantics.*
5. **Dead-letter queue for `Serve<I>` failures** — outline §11 lists "Fallback / dead-letter on persistent failure" in §3.5. Where does it live? *Brain recommend: per-Serve adapter config (`onPersistentFailure: 'log' | 'route-to' | 'halt'`); kit ships default 'log' with structured error.*

---

## Category II — TypeScript SDK ergonomics

Why SIXTH: kit's SDK shape directly inherits from Gatewerk-family conventions (already-adopted in Gatewerk's `ideas-to-steal.md`). Sources 8-11 are CROSS-REFERENCE notes pointing to source 21 (Gatewerk catalog) since patterns are duplicated; sources 12-13 get full notes (tRPC novel, Gatewerk sdk-ts is the canonical local reference).

### 8. Stripe Node SDK — `stripe/stripe-node` (REFERENCED via Gatewerk source 21 §1+§2)
- **Purpose:** Industry-canonical TypeScript SDK ergonomics. Resource-based client, prefixed IDs, idempotency keys, cursor pagination, expandable objects, actionable errors.
- **What to lift (already inherited via Gatewerk):**
  - Prefixed IDs (`pk_pipe_/run_/atom_/src_/proc_/serve_`) — **ADR16**.
  - Resource-based client: `client.reviews.create()` style — **ADR16**.
  - Idempotency keys auto-generated on mutating SDK calls — **ADR9**.
  - Cursor pagination (`starting_after=pk_run_abc`) — **ADR16**.
  - Expandable objects (`?expand[]=template`) — **ADR16**.
  - Actionable error envelope: `{ type, code, message, param, doc_url }` — **ADR16**.
  - Built-in retry with exponential backoff + jitter respecting `Retry-After` — **ADR13**.
- **What to avoid:** Don't lift Stripe's full resource taxonomy (Customers, Subscriptions, Invoices) — kit's resources are different (Pipelines, Runs, Atoms).
- **License + community:** MIT. ~4k+ stars. Industry standard for TS SDK ergonomics.
- **Cross-ref:** Gatewerk's `ideas-to-steal.md` §1, §2.6 (built-in retry), §2.7 (auto-generated idempotency keys).

### 9. Resend SDK — `resend/resend-node` (REFERENCED via Gatewerk source 21)
- **Purpose:** Modern TS SDK ergonomics from email-API company. Simple resource-based client; bundled webhook verification.
- **What to lift (already inherited via Gatewerk):**
  - Discriminated union response: `{ data, error }` — **ADR4 + ADR16**.
  - SDK-bundled webhook verification: `resend.webhooks.verify(rawBody, sig, secret)` returns typed event union — **ADR17**.
  - Typed webhook events: `'email.sent' | 'email.delivered' | 'email.bounced' | ...` discriminated union — **ADR16**.
  - Framework-first docs landing ("How are you using Resend? → Next.js / TS / Python / cURL") — DX inspiration for pipeline-kit docs.
- **What to avoid:** Don't replicate Resend's email-domain primitives (Audiences, Broadcasts, Templates).
- **License + community:** MIT. Active. **Cross-ref:** Gatewerk catalog §2.4 (discriminated union), §3.2 (SDK webhook verification), §3.3 (typed events).

### 10. Supabase JS — `supabase/supabase-js` (REFERENCED via Gatewerk source 21 §2.2)
- **Purpose:** Modern TS SDK with `createClient()` factory pattern. ~76k+ stars; defines factory-function ergonomics for the ecosystem.
- **What to lift (already inherited via Gatewerk):**
  - `createClient({ apiKey, url })` factory — kit ships `createPipelineKit()` mirroring this — **ADR16**.
  - Env-var fallback (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) — kit uses `PIPELINE_KIT_API_KEY`, `PIPELINE_KIT_URL` — **ADR16**.
  - Allows internal config before returning client (cleaner than `new Class()`).
- **What to avoid:** Don't lift Supabase's domain-specific clients (db, auth, storage, realtime, functions) — kit's resources are different.
- **License + community:** MIT. **Cross-ref:** Gatewerk catalog §2.2 (factory function), §2.3 (env-var fallback).

### 11. Knock — `knocklabs/knock-node` (REFERENCED via Gatewerk source 21)
- **Purpose:** Notification-infrastructure SDK with strong TS DX. Typed exception hierarchy in Python, discriminated `{ data, error }` in TS, built-in retry, auto-generated idempotency keys.
- **What to lift (already inherited via Gatewerk):**
  - Typed exception hierarchy (Python side) — relevant if pipeline-kit ever ships Python; for TS, discriminated unions cover the role — **ADR4**.
  - Auto-generated idempotency keys at SDK layer — **ADR9**.
  - Built-in retry with exponential backoff respecting `Retry-After` — **ADR13**.
- **What to avoid:** Don't lift Knock's notification-specific resource model.
- **License + community:** Open SDK (Apache 2.0); cloud product paid. **Cross-ref:** Gatewerk catalog §2.5 (typed exceptions Python), §2.6, §2.7.

### 12. tRPC — https://trpc.io
- **Purpose:** End-to-end type-safe RPC for TypeScript. Server defines procedures; client gets fully-inferred types. No code generation, no schema files — types flow via TypeScript inference.
- **Core abstractions (verbatim):**
  - `t.router({})` — defines a router (collection of procedures).
  - `publicProcedure` / `protectedProcedure` — procedure builders; chain `.input(zodSchema).query/mutation(handler)`.
  - `createTRPCClient<AppRouter>({})` — type-safe client; `AppRouter` type is exported from server.
  - **Procedure types:** `query` (read, GET-style), `mutation` (write, POST-style), `subscription` (long-lived).
  - **Middleware:** chainable; can add context (auth, db).
  - **Context:** per-request data injected into procedures.
  - **Adapters:** Express, Fastify, Next.js, Cloudflare Workers, AWS Lambda, standalone.
- **API surface (canonical):**
  ```typescript
  // Server
  import { initTRPC } from '@trpc/server';
  import { z } from 'zod';

  const t = initTRPC.create();
  export const appRouter = t.router({
    pipelineRun: t.procedure
      .input(z.object({ pipelineId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const run = await ctx.composer.run(input.pipelineId);
        return run;
      }),
  });
  export type AppRouter = typeof appRouter;

  // Client (fully typed via inference)
  import { createTRPCClient } from '@trpc/client';
  import type { AppRouter } from './server';

  const client = createTRPCClient<AppRouter>({ url: '...' });
  const run = await client.pipelineRun.mutate({ pipelineId: 'pk_pipe_abc' });
  ```
- **What to lift:**
  - **End-to-end TS inference (server defines, client infers)** is a powerful pattern for kit's Composer-as-RPC v2 vision. If pipeline-kit ever exposes a Composer over HTTP for cross-process composition, tRPC's type-flow pattern is the canonical reference.
  - **Procedure builder chaining (`.input().mutation()`)** — kit's `createSource()/createProcess()/createServe()` factory functions can mirror this with chainable typed config: `createSource().withInput(zod).withCursor(...).iter(handler)`.
  - **Zod-as-input-validator integration** — kit's adapters validate inputs via Zod at the boundary (**ADR6**).
- **What to avoid:**
  - Don't adopt tRPC as kit's wire protocol by default — locks users into a specific RPC framework. v2 Composer-over-HTTP can offer tRPC adapter as one option among MCP/REST/CloudEvents.
  - tRPC's middleware system is strong but couples auth/ctx tightly to the procedure call site; kit's middleware is per-stage, not per-procedure.
- **Stated non-goals:** Not a workflow engine; not a queue; not a database client. Focused on the RPC contract.
- **License + community:** MIT. ~36k+ stars. Dominant TS RPC framework.

### 13. Gatewerk sdk-ts — `~/Claude-Workspace/gatewerk/packages/sdk-ts/` (LOCAL canonical reference)
- **Purpose:** Gatewerk's own TypeScript SDK. **The canonical reference for pipeline-kit's SDK shape** — ships in production, validated by real usage, embodies all Gatewerk-family conventions.
- **Core abstractions (verbatim from `src/index.ts` exports):**
  - `createClient(config: ClientConfig): GatewerkClient` — factory function (matches Supabase pattern).
  - **8 resources:** `gw.reviews`, `gw.templates`, `gw.feedback`, `gw.audit`, `gw.stats`, `gw.chains`, `gw.notes`, `gw.webhooks`.
  - `Result<T, E>` shape: `{ data: T, error: null } | { data: null, error: E }` — discriminated union (**ADR4**).
  - `GatewerkApiError` typed error class.
  - Per-resource typed input/output: `CreateReviewInput`, `DecideInput`, `ListFilters`, `ReviewDetail`, `ReviewTemplate`, `ChainDefinition`, `Note`, etc.
- **API surface (verbatim from README):**
  ```typescript
  import { createClient } from "gatewerk";

  const gw = createClient({
    apiKey: process.env.GATEWERK_API_KEY!,
    url: "http://localhost:3100",
  });

  const { data: review, error } = await gw.reviews.create({
    template: "email-review",
    payload: { to: "user@example.com", subject: "Hello", body: "..." },
    callback_url: "https://your-agent.example.com/callback",
  });
  if (error) {
    console.error(error.code, error.message);
    return;
  }

  const payload = gw.webhooks.verify(rawBody, signatureHeader, hmacSecret);
  ```
- **What to lift (whole-cloth for pipeline-kit's SDK shape):**
  - **`createClient(config)` factory** → `createPipelineKit(config)` — **ADR16**.
  - **`{ data, error }` Result shape** → `Result<T, E>` everywhere — **ADR4**.
  - **Resource-based client** with per-resource methods — **ADR16**.
  - **Per-resource typed input/output** exported from index — TS DX baseline. Kit exports `CreateRunInput`, `RunDetail`, `PipelineDefinition`, etc.
  - **`createClient` accepts both explicit config AND env-var fallback** (`GATEWERK_API_KEY` / `GATEWERK_URL` env vars) — **ADR16**.
  - **`gw.webhooks.verify(rawBody, sig, secret)` SDK-bundled** — kit ships `pipelinekit.webhooks.verify` mirroring exactly — **ADR17**.
  - **v1 + v2 webhook signature support** — Gatewerk has dual-header transition pattern: `X-Webhook-Signature` (v1, hash-only) + `X-Webhook-Signature-V2` (replay-safe, `t=...,v1=...`). pipeline-kit ships v2-style by default but should document migration pattern. **ADR17 augmentation.**
  - **Constant-time hex comparison via `timingSafeEqual`** — direct lift for kit's HMAC verify — **ADR17**.
  - **`X-Webhook-Id` for receiver-side dedup** — even with v2 verified, header ID is the idempotency key for downstream consumer. **Confirms ADR9.**
- **What to avoid:**
  - Don't lift the `Station` class (legacy/deprecated; sdk-ts has it for backward compat) — `createClient` is canonical.
  - Don't lift Gatewerk's domain-specific resources (templates, chains, notes) — kit's resources are pipelines/runs/atoms, not reviews/templates.
- **Stated non-goals:** SDK is for Gatewerk-the-product API; not a generic HITL SDK. pipeline-kit's `Reviewable<I>` is the abstraction layer above this SDK.
- **License + community:** Apache 2.0. In production. 18 tests passing. Reference impl for the family.

---

### Category II — Synthesis

**Top 3 patterns to lift across TS SDK ergonomics category:**

1. **`createClient(config)` factory + env-var fallback + `{ data, error }` discriminated union response.** Stripe + Supabase + Resend + Knock + Gatewerk-sdk-ts all converge. **Direct adoption** — pipeline-kit ships `createPipelineKit({ apiKey, url })` with `PIPELINE_KIT_API_KEY` + `PIPELINE_KIT_URL` env-var fallback. Maps to **ADR4 + ADR16**. **Confidence HIGH.**

2. **SDK-bundled webhook verification with typed event union return.** Resend + Stripe + Gatewerk all ship `client.webhooks.verify(rawBody, sig, secret) → typed event`. pipeline-kit ships the same. **Cross-reference Cat VII synthesis.** Maps to **ADR17 + ADR16**. **Confidence HIGH.**

3. **Resource-based client with per-resource typed input/output exports.** Stripe `client.charges.create()`, Supabase `client.from('table').select()`, Gatewerk `gw.reviews.create()` — all ship per-resource methods + exported types. pipeline-kit's resources: `pk.pipelines`, `pk.runs`, `pk.atoms`, `pk.adapters` (TBD). Maps to **ADR16**. **Confidence HIGH.**

**Top 2 pitfalls to avoid:**

1. **Throwing exceptions across SDK boundary** — Knock + Gatewerk both prefer `{ data, error }` Result shape. `throw new Error()` works in TS but loses discrimination + breaks compositional pipelines. **ADR4** strict: no thrown errors crossing public stage or SDK boundary.

2. **Tightly coupling SDK to a specific HTTP framework.** Stripe Node SDK, Resend, Knock all use a generic `fetch`-based HTTP client they own. Don't expose `axios` / `node-fetch` in public API surface; wrap.

**Implications for ADRs:**

- **ADR4 (Result<T,E>):** Strongly confirmed. Direct lift from Gatewerk-sdk-ts. **Confidence HIGH.**
- **ADR16 (naming + envelope):** Strongly confirmed. `createClient` factory + resource-based + env-var fallback + prefixed IDs + response envelope. **Confidence HIGH.** Direct lift.
- **ADR17 (webhook signing):** **Augmentation needed.** Gatewerk's v1 (hash-only) + v2 (replay-safe `t=...,v1=...`) dual-header pattern shows real-world transition path. pipeline-kit ships v2-style by default; documents migration pattern in spec. **Confidence HIGH for v2 default.**
- **ADR15 (test framework):** Gatewerk-sdk-ts uses Vitest + 18 tests. Confirms **ADR15** Vitest choice.

**Open questions for brain adjudication:**

1. **What are pipeline-kit's resources?** Gatewerk has 8 (reviews/templates/feedback/audit/stats/chains/notes/webhooks). pipeline-kit candidates: `pipelines`, `runs`, `atoms`, `adapters` (or `sources`/`stores`/`processes`/`serves`), `webhooks`. *Brain recommend: 5 resources — `pk.pipelines`, `pk.runs`, `pk.atoms`, `pk.adapters` (covers all stage types), `pk.webhooks`. Phase 2 ADR for resource taxonomy.*
2. **Does pipeline-kit's SDK ship a Composer instance, or is the SDK separate from the kit's runtime composer?** Two layers: (A) `createPipelineKit()` returns a Composer that runs pipelines locally; (B) `createPipelineKit()` returns an SDK client for talking to a hosted/cloud Composer. *Brain recommend: (A) for v0 — Composer IS the kit. v1+ adds (B) optionally.*
3. **tRPC adapter for v2 Composer-over-HTTP?** Optional adapter alongside MCP/REST/CloudEvents. *Brain recommend: include in v2 ADR catalog.*
4. **Webhook signature versioning** — kit ships v2 (`t=...,v1=...`) by default; backwards compat for v1 (hash-only)? *Brain recommend: v2 only (no v1) — kit is greenfield, no migration burden. Document v2 spec explicitly.*
5. **Python SDK?** Knock has typed exception hierarchy for Python. pipeline-kit is TS-primary; Python is via MCP bridge (**ADR20**). *Brain recommend: no Python SDK in v0; revisit if cross-language demand emerges.*

---

## Category VI — Type / schema / validation

Why SEVENTH: directly informs ADR6 (Zod boundary validation) + ADR11 (migration story / Drizzle). Cross-references Cat I source 1 (Effect Schema) and Cat II source 13 (Gatewerk-sdk-ts uses Zod).

### 33. Zod — https://zod.dev
- **Purpose:** TypeScript-first runtime schema validation with static type inference. Industry default for boundary validation in TS.
- **Core abstractions (verbatim):** `z.object`, `z.string`, `z.number`, `z.array`, `z.union`, `z.discriminatedUnion`, `z.literal`, `z.enum`, `z.coerce`, `z.refine`, `z.transform`, `ZodSchema`, `ZodError`, `z.infer<typeof Schema>`.
- **API surface (representative):**
  ```typescript
  const User = z.object({ name: z.string(), age: z.number().int().positive() });
  const data = User.parse(input);                    // throws ZodError on fail
  const result = User.safeParse(input);              // { success, data | error }
  type UserType = z.infer<typeof User>;              // static type extraction
  z.string().transform(s => s.toUpperCase());        // pipe transformations
  z.object({ password: z.string() }).refine(d => d.password.length > 8);
  ```
- **What to lift:**
  - **Whole library at every Source/Serve boundary** → **ADR6** locked. Zod is industry default; ecosystem already has bindings (`drizzle-zod`, `@hono/zod-validator`, tRPC).
  - **`safeParse` returning `{ success, data | error }` discriminated union** → mirrors kit's Result<T,E> shape (**ADR4**). Direct compatibility.
  - **`z.discriminatedUnion`** → use for kit's webhook event types, Reviewable response types, error kinds.
  - **`z.transform` + `z.coerce`** → boundary coercion at Source intake (Pydantic-boundary-coercion lesson from pursuit's `feedback_pydantic_boundary_coercion.md` — coerce, don't reject).
- **What to avoid:**
  - Don't use `z.parse` (throws) at kit boundaries — use `z.safeParse` to keep errors in Result shape.
  - Don't define schemas inside hot paths — schema construction has a one-time cost.
  - Don't pair with TypeScript `<5.5` — Zod 4 requires 5.5+ and `strict: true`.
- **Stated non-goals:** Not an ORM, not a serialization framework — boundary validator only.
- **License + community:** MIT. ~45k+ stars (per ArkType comparison). Zero dependencies. 2KB gzipped core. **Already used across Gatewerk + pursuit + agent-forge.**

### 34. Pydantic AI — https://pydantic.dev/docs/ai/overview/
- **Purpose:** Python framework for production-grade typed agent applications. Type-safe LLM interactions, structured outputs via Pydantic models, auto-derived tool schemas. **Conceptual reference for `extract-process` adapter design**, not for direct adoption (kit is TS).
- **Core abstractions (verbatim):**
  - `Agent[Deps, Output]` — main orchestrator with typed deps + output channels.
  - `Tool` — LLM-callable function with auto-derived JSON schema from type hints + docstring.
  - `RunContext` — carrier for dependency injection into tools and instructions.
  - `deps_type` / `output_type` — generic type parameters for compile-time safety.
  - `@agent.tool` — decorator registering a tool.
  - `@agent.instructions` — static or dynamic system-prompt directives.
- **API surface (canonical Python):**
  ```python
  agent = Agent('anthropic:claude-sonnet-4-6', instructions='Be concise.')

  @agent.tool
  async def customer_balance(ctx: RunContext[Deps]) -> float:
      """Returns account balance."""
      return await ctx.deps.db.fetch(ctx.deps.customer_id)

  class SupportOutput(BaseModel):
      advice: str
      risk: int = Field(ge=0, le=10)

  agent = Agent(..., output_type=SupportOutput)
  result = await agent.run('What is my balance?', deps=deps)
  ```
- **What to lift (TS-transferable patterns):**
  - **Generic agent typing `Agent<Deps, Output>`** → kit's `Process<I, O>` is conceptually similar; `extract-process` adapter wraps LLM call with input I + output O. Type-level safety from end to end.
  - **Schema-from-types via Pydantic → Zod equivalent for TS:** `extract-process` adapter accepts a Zod schema for output; auto-derives JSON schema for LLM (using `zod-to-json-schema`); validates LLM response against same schema. **Direct pattern lift.**
  - **Validation-driven retry loop on structured-output failures** → ADR13 reinforced. If LLM emits malformed JSON, kit retries with the schema in the prompt.
  - **RunContext for dependency threading** → kit's pass-through Context (**ADR5**) is conceptually equivalent.
- **What to avoid:**
  - Don't ship a Python pipeline-kit (TS-primary per CLAUDE.md). Pursuit's pursuit-kit-Python bridges via MCP per **ADR20**.
  - Don't lift Pydantic AI's decorator-based registration verbatim — TS uses higher-order functions per Cat IV synthesis open question 4.
- **Stated non-goals:** Python-only; not a workflow engine; not a multi-agent orchestrator (single-agent focus, child-agents via tools).
- **License + community:** MIT. Actively maintained by Pydantic team. ~10k+ stars. Production adoption growing.

### 35. Effect Schema — `@effect/schema` package (REFERENCED via Cat I source 1)
- **Purpose:** Effect ecosystem's data validation + serialization library. Type-aligned schemas with bidirectional encode/decode. **Alternative to Zod IF ADR1 adopts Effect.**
- **Core abstractions (verbatim, from source 1 + common knowledge):**
  - `Schema.Struct({ ... })` — object schema.
  - `Schema.String`, `Schema.Number`, `Schema.Array(...)`, `Schema.Union(...)`, etc.
  - `Schema.decode(schema)(input)` — runtime decode (returns Effect).
  - `Schema.encode(schema)(value)` — bidirectional encode (rare in Zod).
  - `Schema.transform(from, to, { decode, encode })` — bidirectional transformations.
- **API surface (representative):**
  ```typescript
  import * as Schema from "@effect/schema/Schema";

  const User = Schema.Struct({
    name: Schema.String,
    age: Schema.Number.pipe(Schema.greaterThan(0)),
  });

  const decoded = Schema.decodeUnknown(User)(input); // Effect<User, ParseError>
  ```
- **What to lift:**
  - **Bidirectional encode/decode** is genuinely novel vs Zod — useful for Atom serialization round-tripping (test plan §12 lists "Store.put().then(Store.get) round-trips Atom integrity").
  - **Effect-aware composition** — if **ADR1** adopts Effect, Schema integrates with Layer DI + error channel natively.
- **What to avoid:**
  - Don't adopt Effect Schema in v0 — locks **ADR1** decision. Vanilla TS + Zod is the v0 path.
  - Don't dual-import Zod + Effect Schema — pick one per project area.
- **Stated non-goals:** Not a standalone library — coupled to Effect runtime.
- **License + community:** MIT (part of Effect-TS monorepo). See source 2 for ecosystem.

### 36. ArkType — https://arktype.io
- **Purpose:** TypeScript runtime validator with **string-syntax schemas** (TS-string-as-schema parsing) and editor-level type feedback. Positions as faster alternative to Zod (claims 20x faster object validation; 14ns vs 281ns Node v23.6.1).
- **Core abstractions (verbatim):**
  - `type({...})` — schema definition (replaces `z.object`).
  - `type.errors` — error introspection.
  - `.extends(other)` — type relationship introspection.
  - `.or(other)` — union with discriminated narrowing.
  - **String-syntax schemas:** `"'android' | 'ios'"`, `"number > 0"`, `"string[]"`, `"date | null"` — TS strings parsed as runtime types.
  - `scope({...})` — namespaced type definitions.
- **API surface (representative):**
  ```typescript
  const User = type({
    name: "string",
    platform: "'android' | 'ios'",
    "version?": "number | string",  // optional via key suffix
  });

  const Account = type({ kind: "'admin'", "powers?": "string[]" })
    .or({ kind: "'superadmin'", "superpowers?": "string[]" });

  User.extends("object"); // true
  ```
- **What to lift:**
  - **Performance signal** is real (20x on object validation) — relevant if kit's hot path includes per-Atom Zod parsing in production. **Possible Phase 2 ADR addition** — switch to ArkType in v1+ if perf becomes a concern.
  - **String-syntax** is terse for simple types but reduces IDE ergonomics for complex schemas.
- **What to avoid:**
  - Don't switch from Zod in v0 — ecosystem maturity matters. Drizzle has `drizzle-zod`; Hono has `@hono/zod-validator`; tRPC integrates with Zod. ArkType ecosystem is younger.
  - Don't use string-syntax for complex schemas with dependent fields — Zod's fluent builder is clearer.
- **Stated non-goals:** Not an ORM; not a serialization framework. Focused on validation alone.
- **License + community:** MIT (per common knowledge — ArkType is OSS). 6.5k+ stars vs Zod's ~45k. Less mature ecosystem; faster runtime.

### 37. Drizzle ORM — https://orm.drizzle.team
- **Purpose:** "Headless TypeScript ORM with a head." Schema-first, type-safe relational database toolkit for PostgreSQL, MySQL, SQLite, MSSQL, CockroachDB, SingleStore, Gel. v0 default for pipeline-kit per **ADR11**.
- **Core abstractions (verbatim):**
  - **Schema:** `pgTable()`, `mysqlTable()`, `sqliteTable()`. Column helpers: `integer()`, `varchar()`, `text()`, `jsonb()`, `serial()`, `uuid()`, `timestamp()`. `relations()` for foreign keys + joins.
  - **Query builder:** `db.select().from().where()`, filters `eq() / and() / or() / like() / inArray()`.
  - **Mutations:** `db.insert(table).values()`, `db.update(table).set().where()`, `db.delete()`.
  - **Transactions:** `db.transaction(async (tx) => {...})`.
  - **Migrations (drizzle-kit):** `generate` (TS schema → SQL files), `migrate` (apply files), `push` (dev-only schema sync), `pull` (reverse-introspect).
- **API surface (canonical):**
  ```typescript
  import { pgTable, integer, varchar, serial, relations } from "drizzle-orm/pg-core";

  export const users = pgTable("users", {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).unique(),
  });

  // Query
  const result = await db.select().from(users).where(eq(users.email, "x@y.com"));

  // Insert / update / transaction
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ email: "z@y.com" });
    await tx.update(users).set({ email: "new@y.com" }).where(eq(users.id, 1));
  });
  ```
- **Migration story:** Schema-first → `drizzle-kit generate` → SQL files in `migrations/` → commit → `drizzle-kit migrate` in CI/prod. `drizzle-kit push` for dev-only direct sync. **Manual rollback** via folder-based versioning. v1.0-beta added migration table versioning for reliable env tracking.
- **Bun + multi-runtime:** Native `bun:sql` (PostgreSQL mode via Bun v1.2.0+), `bun-sqlite`, plus standard Node drivers (`node-postgres`, `postgres-js`), Neon HTTP, Vercel Postgres, Supabase, AWS Data API.
- **What to lift:**
  - **Whole library for v0 `postgres-store` + `sqlite-store` adapters** → **ADR11** locked. Direct adoption.
  - **`drizzle-zod` (now bundled via `drizzle-orm/zod`)** — auto-generate Zod schemas from Drizzle table definitions. Removes duplicate type definitions. **ADR6 + ADR11 alignment.**
  - **Schema-first migration workflow** → kit ships migrations alongside adapter code (e.g., `@pk-store/postgres` includes `migrations/0001_init.sql`).
  - **Native Bun support** → CLAUDE.md "Bun-tested in CI" requirement met natively.
  - **`@effect/sql-drizzle` integration** → if **ADR1** adopts Effect, the Drizzle bridge is free.
- **What to avoid:**
  - Don't use `drizzle-kit push` in production — schema drift risk. Use `generate` + `migrate` for prod.
  - Don't lift Drizzle's full multi-dialect surface in v0 — kit ships Postgres + SQLite first; MySQL/MSSQL/CockroachDB on demand.
- **Stated non-goals:** Not an "active record" ORM; not a query magic ORM (TypeORM/Prisma style). Drizzle is "SQL-shaped TypeScript."
- **License + community:** MIT. ~33k+ stars. v1.0-beta.15+ (Feb 2025). 164+ bugs fixed in beta cycle; 3000+ drizzle-kit test cases. Astro DB, SST adoption. Very active.

---

### Category VI — Synthesis

**Top 3 patterns to lift across type/schema category:**

1. **Zod at every Source/Serve boundary + schema-as-source-of-truth.** Zod schemas drive: (a) input validation at HTTP edge (Hono); (b) Atom shape per Source<O>; (c) LLM output schema for `extract-process` (zod-to-json-schema); (d) drizzle-zod-derived insert/select schemas for Store. Maps to **ADR6**. **Confidence HIGH.**

2. **Schema-first ORM workflow with Drizzle + auto-derived migrations + drizzle-zod bridging.** TypeScript schema is single source of truth; SQL migrations generated; Zod schemas auto-derived. Maps to **ADR11 + ADR6**. **Confidence HIGH.**

3. **Boundary coercion (don't reject) at Source intake + Validation-driven retry on Process output.** Cross-references Pursuit's `feedback_pydantic_boundary_coercion.md` lesson + Pydantic AI's reflection/retry pattern. Kit's Source<O> coerces malformed-but-recoverable input via `z.coerce` / `z.transform`; Process<I,O>'s LLM-backed adapters retry on schema-validation failure. Maps to **ADR6 + ADR13**. **Confidence HIGH.**

**Top 2 pitfalls to avoid:**

1. **Adopting ArkType in v0 despite perf signal.** Zod's ecosystem (drizzle-zod, hono-zod, tRPC, zod-to-json-schema, OpenAI structured outputs SDK) is materially deeper. ArkType perf advantage is real but irrelevant for v0; revisit if production hot path bottlenecks on validation.

2. **Adopting Effect Schema before adopting Effect.** Schema is coupled to Effect runtime; using it without Effect adds wrapper overhead. **ADR1** says vanilla TS v0; Effect Schema follows ADR1.

**Implications for ADRs:**

- **ADR6 (Zod at boundaries):** Strongly confirmed. Zod 4 + `strict: true` TS + ecosystem cohesion. **Confidence HIGH.**
- **ADR11 (Drizzle ORM):** Strongly confirmed. Multi-runtime Bun/Node; native Postgres + SQLite; drizzle-zod bundled; v1.0-beta production-ready. **Confidence HIGH.**
- **ADR1 (Effect.ts adoption):** Reinforced — Effect Schema is appealing IF Effect adopted, but locks ADR1. v0 vanilla + Zod is correct. **Confidence HIGH for v0 vanilla.**
- **ADR13 (retry policy):** Pydantic AI's validation-driven retry on structured output confirms kit's `extract-process` should retry on Zod parse failure with schema in prompt. **Confidence HIGH.**

**Open questions for brain adjudication:**

1. **ArkType escape hatch for hot-path validation in v1+?** Current ADR6 locks Zod; perf signal suggests revisit if production bottlenecks. *Brain recommend: defer; profile first.*
2. **Auto-derive JSON schemas for `extract-process` LLM adapter via zod-to-json-schema?** Kit ships this as default. *Brain recommend: yes, ship as utility.*
3. **drizzle-zod or Zod-from-scratch for Store schemas?** drizzle-zod removes duplication. *Brain recommend: drizzle-zod for Store schemas; standalone Zod for Source/Serve schemas.*
4. **Strict-mode TS enforcement for kit users?** Zod 4 requires it; CLAUDE.md already mandates it. *Confirmed; document explicitly.*
5. **Schema versioning for migrations?** Drizzle v1.0-beta has migration table versioning. *Brain recommend: adopt as default; document upgrade path.*

---

## Category VIII — Observability

Why EIGHTH: directly informs ADR8 (OpenTelemetry native). Cross-references Cat V (Fail at Scale + AWS Builder's Library) on observability-as-reliability-primitive.

### 43. OpenTelemetry JS — https://opentelemetry.io/docs/languages/js/
- **Purpose:** Vendor-neutral telemetry SDK for Node + browsers. Standardized APIs for traces, metrics, logs. Works with any backend speaking OTLP (Honeycomb, Datadog, Grafana, Langfuse, custom).
- **Core abstractions (verbatim from docs index):**
  - **Traces:** `Tracer`, `Span`, `SpanContext`, `TracerProvider`, `Propagator`. Status: Stable.
  - **Metrics:** `Meter`, `MeterProvider`, instruments (Counter, Histogram, Gauge). Status: Stable.
  - **Logs:** `Logger`, `LoggerProvider`. Status: Development.
  - **Cross-cutting:** `Resource` (service identity), `Attributes` (k/v on spans), `Context` (current execution context), `BaggageAttributes` (propagated context).
- **API surface (canonical TS pattern):**
  ```typescript
  import { trace, context } from '@opentelemetry/api';

  const tracer = trace.getTracer('pipeline-kit');

  await tracer.startActiveSpan('pipeline.run', async (span) => {
    span.setAttribute('pipeline.id', pipelineId);
    span.setAttribute('run.id', runId);
    try {
      // Source<O>
      await tracer.startActiveSpan('source.iter', async (childSpan) => {
        // ...
        childSpan.end();
      });
      // ... Process<I,O>, Serve<I>
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    } finally {
      span.end();
    }
  });
  ```
- **Auto-instrumentation:** Maintained in `opentelemetry-js-contrib` repo. Covers HTTP, gRPC, Postgres, Redis, MongoDB, Express, Hono, Drizzle (community), and many more. Drop-in via `@opentelemetry/auto-instrumentations-node`.
- **Three signal types:**
  - **Traces** = chained spans showing causal flow (parent/child relationships).
  - **Metrics** = aggregated numerical measurements (counters, histograms, gauges).
  - **Logs** = structured event records (correlated to spans via trace context).
- **Exporters:** OTLP (OpenTelemetry Protocol — HTTP+protobuf or gRPC+protobuf) is the standard. Backend-specific exporters: `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-metrics-otlp-grpc`, etc.
- **What to lift:**
  - **Whole library at every kit boundary** → **ADR8** locked. Pipeline run = top-level span; Source/Process/Serve invocations = child spans; Stage boundaries marked with attributes.
  - **`SpanStatusCode.OK` / `SpanStatusCode.ERROR`** → kit's Result<T,E> error path automatically translates to span status.
  - **`recordException(err)`** for stack traces → kit's structured errors carry across span lifecycle.
  - **Trace propagation across stages** → Context + Propagator pattern; matches kit's pass-through Context (**ADR5**).
  - **Resource attributes** (`service.name = 'pipeline-kit'`, `service.version = '0.1.0'`) → kit auto-populates.
- **What to avoid:**
  - Don't manually instrument every line — rely on auto-instrumentation for HTTP/DB; manual spans only at kit's stage boundaries.
  - Don't ship the OTel SDK as a hard dependency — kit's tracing API is internally OTel-shaped but the SDK is opt-in initialized by users (avoids bundle bloat for users who don't need traces).
  - Don't conflate "logs" (structured records) with "traces" (causal spans) — both have their place.
- **Stated non-goals:** Doesn't ship a backend; not a dashboard. Spec + SDK only.
- **License + community:** Apache 2.0. CNCF graduated project. Industry standard. ~3k+ stars on `opentelemetry-js`.

### 44. Langfuse — https://langfuse.com (404 on landing fetch; synthesized from common knowledge)
- **Purpose:** Open-source LLM observability platform — traces, cost tracking, evaluation, prompt management, dataset-driven testing. Self-hosted via Docker Compose; cloud SaaS available. Postgres + Redis + S3 + ClickHouse backbone.
- **Core abstractions:**
  - **Trace** — top-level execution (pipeline-kit run = Langfuse Trace).
  - **Generation** — LLM call within a trace; tokens + cost auto-computed.
  - **Span** — generic unit of work (non-LLM).
  - **Score** — quality rating attached to a trace/generation (0-1, boolean, categorical). Used for eval.
  - **Dataset** — evaluation corpus; runs against datasets compute Scores.
  - **Prompt** — versioned prompt registry (cloud-side).
  - **Session** — collection of related traces (e.g., multi-turn agent conversation).
- **API surface (TS SDK, representative):**
  ```typescript
  import { Langfuse } from 'langfuse';

  const langfuse = new Langfuse({ secretKey, publicKey, baseUrl });

  const trace = langfuse.trace({ name: 'pipeline-trades-outbound', userId: 'user_123' });

  const generation = trace.generation({
    name: 'extract-process-llm',
    model: 'claude-sonnet-4-6',
    input: { prompt: '...', userQuery: '...' },
    output: { response: '...' },
    usage: { input: 100, output: 50 },
  });

  trace.score({ name: 'output-quality', value: 0.92 });
  await langfuse.flushAsync();
  ```
- **What to lift:**
  - **Cost tracking per Generation** → kit's `extract-process` adapter emits Langfuse-shaped Generation events when wired. Auto-computes token cost from model + usage. **ADR8** extension.
  - **OTel integration via `@langfuse/opentelemetry`** → kit's OTel spans flow into Langfuse natively. **No custom Langfuse-specific code in kit.**
  - **Score-driven evaluation** → reference for kit's reference-project eval surface (Trades Outbound A/B test booked-meeting rate as a Score).
- **What to avoid:**
  - Don't bundle Langfuse SDK in kit's core — it's a userland Observability backend choice. Kit emits OTel; users wire OTel→Langfuse.
  - Don't replicate Langfuse's prompt registry — kit's `Reviewable<I>` describe callback is the prompt-equivalent for review templates; full prompt registry is product surface.
- **Stated non-goals:** Not a workflow engine; not a runtime. Pure observability.
- **License + community:** MIT. ~10k+ stars. Postgres + Redis + S3 + ClickHouse. Strong YC-adjacent traction. **Already mentioned multiple times in Gatewerk's `ideas-to-steal.md` (§3 auto-disable webhooks, §3 SSRF prevention, §8 typed job queue with BullMQ + Zod payloads).**

### 45. Sentry's error UX patterns (REFERENCED via Gatewerk source 21 §1)
- **Purpose:** Industry-canonical actionable error format. Already adopted by Gatewerk; inherited by pipeline-kit per **ADR16**.
- **Pattern (verbatim from Gatewerk catalog):**
  ```json
  {
    "error": {
      "type": "invalid_request",
      "code": "template_not_found",
      "message": "Template 'proposal-review' does not exist in project 'upwork-intel'",
      "param": "template",
      "doc_url": "https://docs.pipelinekit.dev/errors/template_not_found"
    }
  }
  ```
- **What to lift:**
  - **Whole error envelope shape → ADR4 + ADR16.** Already inherited via Gatewerk catalog §1. Direct adoption.
  - **`request_id` for support correlation** — kit auto-generates `pk_run_<id>` per Pipeline.run; surfaces in errors for log correlation.
- **What to avoid:** Don't lift Sentry's full SDK surface (breadcrumbs, performance monitoring, replay) — userland concern via OTel.
- **License + community:** Sentry SDK BSL-1.1 (functional source license — caveat for kit users). The error-envelope *pattern* is industry common knowledge; kit doesn't depend on Sentry SDK. **Cross-ref:** Gatewerk catalog §1 actionable errors.

---

### Category VIII — Synthesis

**Top 3 patterns to lift across observability category:**

1. **OpenTelemetry as the universal observability protocol.** Kit emits OTel spans at every Source/Process/Serve boundary; users wire OTel exporters to their chosen backend (Langfuse, Honeycomb, Datadog, Grafana). Maps to **ADR8**. **Confidence HIGH.**

2. **Langfuse Generation + cost-tracking integration via OTel.** Kit's `extract-process` LLM adapter emits OTel spans with Generation-shaped attributes; Langfuse auto-ingests. No Langfuse-specific code in kit. **Confidence HIGH.**

3. **Sentry-shape actionable error envelope** (already inherited via Gatewerk catalog). **Confidence HIGH.**

**Top 2 pitfalls to avoid:**

1. **Bundling specific observability backends in kit core.** Langfuse, Datadog, Honeycomb, Grafana are userland choices. Kit emits OTel; users wire backends.

2. **Manual instrumentation everywhere.** Auto-instrumentation covers HTTP/DB. Manual spans only at kit's stage boundaries. Over-instrumentation creates trace noise.

**Implications for ADRs:**

- **ADR8 (OpenTelemetry native):** Strongly confirmed. OTel JS at every kit boundary; auto-instrumentation for HTTP/DB; SpanStatusCode tied to Result<T,E>. **Confidence HIGH.**
- **ADR4 + ADR16 (error envelope):** Sentry-shape inherited via Gatewerk. **Confidence HIGH.**

**Open questions for brain adjudication:**

1. **OTel SDK as hard dep or peerDep?** Hard dep simplifies user experience; peerDep avoids bundle bloat. *Brain recommend: peerDep — users opt in by installing `@opentelemetry/api` + their chosen exporter.*
2. **Cost-tracking attributes on Generation spans** — standardized? Langfuse expects `usage.input`, `usage.output`, `model`. *Brain recommend: kit emits canonical OTel-Generation attributes (semantic conventions); document explicitly.*
3. **Default OTel exporter for dev?** OTLP gRPC requires running collector. Console exporter is dev-friendly. *Brain recommend: ship `ConsoleSpanExporter` for dev; OTLP for prod.*

---

## Category IX — Marketplace + community references

Why NINTH: validates pipeline-kit's reference-adapter list against real-world usage (what users actually automate). Lighter ADR-impact; informs positioning + prioritization.

### 46. n8n.io/workflows community catalog (~9573 workflows)
- **Purpose:** Public library of automation templates. Discovery/learning surface for non-coders. 9,573 workflows; 186,849 stars on n8n core.
- **Top categories (verbatim):** AI agents/RAG, Sales (lead automation, CRM), IT Operations, Security Operations, Marketing, Document Operations, Support.
- **Top 10 patterns:** API endpoint creation, AI agent chat, web scraping + AI summarization, dataset joining/transformation, GitHub backup, quick-start templates, AI data enrichment, third-party API pulls, JSON-to-Excel conversion, Telegram chatbot.
- **What pipeline-kit users automate** (mirroring catalog): data pipelines (ETL, joining), AI/LLM orchestration (agents, chat), integration workflows (multi-app sync), document/content ops, notification/alert systems.
- **What to lift:** Validates pipeline-kit's reference adapters list — Source<O> for data extraction, Process<I,O> for AI summarization/enrichment, Serve<I> for notifications/CRM. **No new ADR.**
- **What to avoid:** Don't compete with n8n's catalog breadth; pipeline-kit is library-tier, not workflow-builder-tier.
- **License + community:** n8n Sustainable Use License (kit users at >$5M revenue must license n8n separately if composing INTO n8n nodes; not pipeline-kit's concern per Cat III synthesis Q5).

### 47. enescingoz/awesome-n8n-templates (280+ templates)
- **Purpose:** Curated open-source collection of n8n templates by vertical. CC-BY-4.0; 19,000+ stars. 18 categories.
- **Categories:** Gmail/Email (9), Telegram (18), Google Drive/Sheets (13), WordPress (6), PDF/Document, Discord, Database/Storage, DevOps, Airtable, Notion, Slack, OpenAI/LLMs, WhatsApp, Social Media, Forms, AI Research/RAG.
- **Notable patterns relevant to pipeline-kit:**
  - **"Human in the Loop" email response system** (IMAP + AI + draft) — validates `Reviewable<I>` is a top-of-mind pattern for users.
  - **LeadPilot Lite — AI cold email writer from Sheets** — confirms `extract-process` + `email-serve` (or `smartlead-serve`) adapter combo.
  - **InboxZero Lite — AI email classifier** — `classify-process` adapter.
  - **RAG chatbots with Pinecone/Qdrant** — confirms `pgvector-store` + `qdrant-store` v1 reference adapters.
- **What to lift:** Validates v0/v1 reference adapter list. Most-templated patterns: Gmail/email, OpenAI/Claude, Slack, Notion, Airtable, Google Drive/Sheets, Telegram, Discord, RAG. Cross-reference outline §11 v0/v1.
- **What to avoid:** Don't build 18-category breadth in v0; kit is library, not template marketplace.
- **License + community:** CC-BY-4.0; 280+ templates; 19k+ stars; multilingual (15 languages).

### 48. Activepieces marketplace top-50 pieces (REFERENCED via Cat III source 19)
- **Purpose:** Top pieces in the Activepieces marketplace (~280 total, ~400 MCP servers). 60% community-contributed.
- **Pattern overlap:** Same surface as n8n templates (Gmail, Slack, Notion, OpenAI, Discord) — confirms the consensus integration set across workflow ecosystems.
- **What to lift:** Validates pipeline-kit's adapter-as-npm-package distribution model. Activepieces auto-MCP is the model for kit's `@pk-mcp/<adapter>` auto-generation (Cat III synthesis Q4).
- **License + community:** MIT (Community Edition). See source 19 for full coverage.

### 49. Composio Tool Router — https://docs.composio.dev
- **Purpose:** Tool aggregator for AI agents — 1000+ toolkits with built-in OAuth/API-key management. MCP-native session model.
- **Core abstractions (verbatim):** `Toolkit` (e.g., GitHub) → `Tool` (e.g., `GITHUB_CREATE_ISSUE`) → `Action` / `Trigger`. `Auth Config`, `Connected Account`, `Session` per `user_id`.
- **API surface:**
  ```typescript
  import { Composio } from "@composio/core";
  const composio = new Composio();
  const session = await composio.create("user_123");
  const tools = await session.tools();
  // MCP mode: session.mcp.url + session.mcp.headers
  ```
- **Auth manager pattern:** Composio handles OAuth/API-key flows internally. Users never manage auth configs manually. Credential storage, refresh, injection at execution time.
- **MCP integration:** Each session exposes `session.mcp.url` + `session.mcp.headers` for MCP clients (Claude Desktop, Cursor, OpenAI Agents). **Removes provider-specific SDK packages.**
- **What to lift:**
  - **Auth manager pattern** — relevant for v1 `enrich-process` adapter waterfall (Apollo → Hunter → Bricks). pipeline-kit could ship `@pk-auth/composio` as optional bridge so users skip OAuth dance.
  - **MCP-by-default exposure** — confirms `mcp-tool-source` + `mcp-tool-serve` v0 adapters in outline §11. Composio shows industry-standard pattern.
- **What to avoid:** Don't replicate Composio's full toolkit catalog — kit's adapters serve typed-stage thesis, not auth aggregation.
- **License + pricing:** Not disclosed in fetch.

### 50. Saraev's "5 Automations You Can Sell" + Maker School (REFERENCED via pursuit/operatoros context)
- **Purpose:** Productized-service-tier playbook by Saraev (founder of Maker School). 5-automation blueprint for $1-3K/mo agency tier.
- **5 automations Saraev teaches (per pursuit context):** lead gen, cold outreach, CRM cleanup, content automation, customer support automation.
- **Pricing tier:** $1-3K/mo agency tier (per pursuit's HANDOFF — "Saraev/Ottley student tier").
- **What to lift:** Validates **Project A (Trades Outbound)** pricing band ($1.5K setup + $1.2K/mo retainer per outline §9). Saraev's saturated lane = cold outreach as commodity; pipeline-kit's edge is HITL-gated outreach (Gatewerk integration), not cold-outreach competition.
- **What to avoid:** Don't position pipeline-kit as a competitor in Saraev's lane; kit is the infrastructure beneath the productized service.
- **License + community:** Maker School commercial.

### 51. Liam Ottley's AAA Accelerator + AIOS framework (REFERENCED via pursuit context)
- **Purpose:** Productized-service blueprint for AI agency model. AAA = "AI Automation Agency." AIOS framework structures agency operations. Same $1-3K/mo agency tier as Saraev.
- **What to lift:** Validates portfolio-project pricing strategies. **Positions pipeline-kit as the underlying infrastructure** for agencies graduating beyond no-code (Make/n8n) to typed code automation.
- **What to avoid:** Don't mistake the agency-tier audience for pipeline-kit's primary buyer. Kit's primary is the developer who builds for these agencies (or the agency itself once it needs typed reliability).
- **License + community:** Morningside.ai commercial.

---

### Category IX — Synthesis

**Top 3 patterns to lift across marketplace category:**

1. **Adapter-as-npm-package distribution + auto-MCP exposure** (Activepieces + Composio converge). pipeline-kit ships `@pk-source/...`, `@pk-process/...`, `@pk-serve/...` as separate npm packages, each auto-generates an `@pk-mcp/<adapter>` MCP server. Maps to **ADR16 + Cat III synthesis Q4**. **Confidence HIGH.**

2. **HITL pattern is a top-of-mind workflow user need** (validated by awesome-n8n-templates having "Human in the Loop" email response as a featured template). Confirms `Reviewable<I>` is not a niche concern. Maps to **ADR14**. **Confidence HIGH.**

3. **Top integration set is well-known** (Gmail, Slack, Notion, OpenAI, Google Drive/Sheets, Telegram, Discord, Airtable, RAG). Outline §11 v0 + v1 reference adapter list aligns. **No new ADR; validates existing list.**

**Top 2 pitfalls to avoid:**

1. **Competing with workflow builders on breadth** (n8n has 9.5k+ integrations, Activepieces has 280+ pieces). pipeline-kit ships ~16 v0 adapters + grows by reference-project demand.

2. **Confusing tier-buyers** — Saraev/Ottley land is the productized-service tier ($1-3K/mo). pipeline-kit's primary buyer is the engineer/builder; Saraev/Ottley land is the audience for projects BUILT WITH pipeline-kit, not for the kit itself.

**Implications for ADRs:** No new ADRs from Cat IX. Validation of existing adapter list (outline §11) and positioning (outline §1).

**Open questions for brain adjudication:**

1. **Auto-MCP exposure for every kit adapter** — should kit ship a code-gen tool (`pk gen-mcp`) that produces MCP servers from any Source/Process/Serve adapter? *Brain recommend: yes, v1 feature; aligns with Activepieces + Composio industry standard.*
2. **Composio integration as reference auth manager?** kit users could plug Composio in via `@pk-auth/composio` adapter. *Brain recommend: design space for v1; not v0.*

---

## Category X — Pursuit + Idris's existing surface (light pass per outline)

Why TENTH (light pass): contextual references for pipeline-kit's positioning vs. Idris's existing project family. Doesn't drive ADR design; validates dogfood architecture (HRP → Gatewerk → pipeline-kit → portfolio).

### 52. pursuit/docs/strategy/essentials-kit.md (LOCAL)
- **Purpose:** Pursuit's own internal "essentials kit" — shared infrastructure consumed by every portfolio project. Hexagonal (ports + adapters) architecture. **The Python ancestor of pipeline-kit-TS.**
- **5-stage pipeline frame:** SOURCES → INGESTION → STORAGE → ANALYSIS → OUTPUT, with LEARNING LOOP. **Direct conceptual ancestor of pipeline-kit's Source/Process/Serve.**
- **Folder structure (selected highlights):**
  - `agents/core/` — types, location classifier, config, structured logging, resilience (retry+rate-limit+CB), errors, health, prompts, registry.
  - `agents/tools/apify/` — generic actor runner + actor catalog by category (social/commerce/jobs/local/ads/web).
  - `agents/tools/llm/` — base ABC + openai/anthropic/gemini/router/structured/batch/streaming/cost_tracker.
  - `agents/tools/storage/` — relational/vector/memory/graph/cache/blob/checkpointer.
  - `agents/tools/hitl/` — `gatewerk.py` (kit's HITL adapter; **pre-existing Gatewerk integration in pursuit confirms ADR14 patterns**).
  - `agents/tools/{crm,voice,email,messaging,http,export}/` — full provider catalog.
  - `agents/orchestration/` — multi-agent + workflow patterns + replay.
- **Math behind shared kit:** without shared = 12 projects × 5 days = 12 weeks; with shared = Week 1 kit + 12 × 2-3 days = 6-8 weeks. **Shared infrastructure as the single biggest lever.**
- **What to lift:**
  - **TS pipeline-kit's reference adapter list (outline §11) maps almost 1:1 to pursuit's `tools/` folder.** Direct heritage.
  - **5-stage pipeline frame** is Source/Process/Store/Serve under different names. Confirms typed-stage thesis.
  - **Hexagonal architecture (ports + adapters)** confirms kit's design philosophy.
  - **Per-provider abstraction patterns** (LLMClient ABC + concrete impls + router with fallback) inform kit's `extract-process` LLM provider design.
- **What to avoid:** Don't directly port pursuit's Python code. **ADR20** says pursuit Python stays via MCP bridge.
- **License + community:** Idris's internal project. Foundational architectural reference for pipeline-kit.

### 53. pursuit/docs/strategy/portfolio_shortlist_v1.md (locked 2026-05-06)
- **Purpose:** Final 4-project portfolio slate, demand-validated from row-level Upwork mining + ATS + 2026 web research. Replaces 12-project ideation.
- **The 4 projects (atom + buyer + pricing):**
  - **P1 GTM Engine:** `Prospect` atom; B2B vertical-ICP outbound. $321K Clio + $147K AI lead-gen demand. Stack: Apollo + Clay + Smartlead + GoHighLevel + Claude API + Python + n8n.
  - **P2 Competitive-Intel Monitor (AgencyReport):** `CompetitorSignal` atom; weekly delta detection. $192K + $87K + $250K demand. Crayon/Klue charge $20-40K/yr for what this ships open-source.
  - **P3 Internal AI Ops Kit:** `OpsRequest` atom; chat-initiated request kit. $97K + $57K + $40K demand. **Industry quote: "replaces a $5,000 to $15,000 monthly agency retainer with a Claude Code session and the kit."**
  - **P4 Production Multi-Agent Platform:** B2B sales (Pydantic AI + LangGraph + RAG + Langfuse).
- **Architectural backbone (verbatim):** `SOURCES (adapters) → INGEST → STORE → ANALYZE → EMIT → HITL gate → ACTION` with learn loop. **Direct pipeline-kit thesis confirmation.**
- **What to lift:**
  - **Adapter pattern is the moat** — once kit ships, each project is ~80 lines of `pipeline.py` composition. Validates pipeline-kit's value proposition.
  - **Demand-row-level evidence** — every project anchored to specific Upwork rows with $ + applicants. Methodology to lift for pipeline-kit reference projects (Trades Outbound, Multi-CRM Sync per outline §9).
- **What to avoid:** Don't build all 4 projects under pipeline-kit; pipeline-kit IS the library, projects compose on top.
- **License + community:** Idris's internal portfolio plan.

### 54. pursuit/data/demand_intel/2026-05-05/demand_report.md (DIR; not directly read in this pass)
- **Purpose:** Pursuit's 6-section demand report from 5 SQL views joining ATS × Upwork via brain-authored archetype mapping.
- **6 sections (per HANDOFF):** hybrid bets, freelance lanes, top tools, ATS reach (incl. bridge-band slice), sample premium rows, auto-flag observations.
- **What to lift:** Methodology — pipeline-kit reference projects similarly anchor each adapter to specific demand rows. Already captured in source 53 narrative.
- **License + community:** Idris's internal data.

### 55. pursuit/docs/research/automation-portfolio-research-2026-04-22.md
- **Purpose:** Original 12-project ideation. Macro market data + 108K ATS + 387 Upwork + n8n templates.
- **Macro signals:** 88% of orgs use AI automation (Deloitte 2026); $169B market; 75% of high-growth cos run RevOps (Gartner). SMB avg AI spend $18K/yr; #1 barrier is cost (61%); #2 expertise (54%); #3 data quality (41%). SMB pain verbatim: *"We know AI might help, but we don't know where to begin."*
- **Agency findings:** 47% of agencies lose up to $500K/yr to untracked hours; retainer agencies 56-month avg client lifespan vs 24 for project-based. **Fastest-ROI improvement: automated client reporting.**
- **What to lift:**
  - **SMB pain framing** — pipeline-kit's positioning: *"We don't just build the automation; we ship the path-to-value."*
  - **Fastest-ROI = automated reporting** — relevant for `report-process` + `pdf-serve` adapters (outline §11 v1).
  - **Path-to-value over tool-completeness** reinforces pipeline-kit's "library-not-framework" positioning.
- **License + community:** Idris's research output.

### 56. agent-forge/README.md (LOCAL)
- **Purpose:** Idris's earlier Python project — AI-powered job search automation with multi-agent architecture. Pattern source pipeline-kit lifts adapter design from.
- **5-agent architecture:** Research / Qualify / Strategy / Outreach / Execute (+ HITL dashboard).
- **Stack:** Supabase, Qdrant, SearXNG, Tavily, Apify, OpenAI, Streamlit (now replaced), Langfuse.
- **What to lift:**
  - **5-agent layering** maps to pipeline-kit's stage thesis (Research = Source; Qualify/Strategy/Outreach = Process; Execute = Serve).
  - **Provider stack** confirms reference adapter list (Apify, Tavily, SearXNG, OpenAI, Langfuse).
- **What to avoid:** Don't lift Streamlit (replaced); don't lift outdated provider integrations (CLAUDE.md "What NOT to lift" discipline).
- **License + community:** Idris's internal project.

### 57. mediaflow/README.md (LOCAL)
- **Purpose:** Multi-tenant social media automation platform (FAST = FastAPI Automation Service). Production-grade API for social publishing.
- **Stack:** FastAPI + Python 3.12 + Supabase + Directus + Claude/OpenAI + Langfuse + Telegram + Docker/Coolify/Tailscale.
- **What to lift:** **Langfuse integration** confirms ADR8 + Cat VIII source 44 alignment. Cross-reference.
- **What to avoid:** **Multi-tenant patterns explicitly NOT lifted** per CLAUDE.md ("Mediaflow's multi-tenant patterns — that's mediaflow's product, not kit's"). pipeline-kit is single-tenant library.
- **License + community:** Private.

### 58. operatoros/README.md + STATUS.md (LOCAL)
- **Purpose:** Productized automation service for US trades SMBs (appliance/HVAC/plumbing/electrical). Beachhead client: Alp Appliance Repair. Year 1: 5-10 retainers = $6-12K MRR; Year 2: 15-25 retainers = $20-30K MRR.
- **4 phases:** Phase 0 (advisory now) → Phase 1 (full build, $1.5K setup + $1.2K/mo + 5% perf) → Phase 2 (months 4-12, productize) → Phase 3 (year 2+ scale).
- **Strategic frame:** Beachhead as case study + referral engine; productized service template lifts to other clients.
- **What to lift:**
  - **Productization pattern** — pipeline-kit ships once, **Trades Outbound (outline §9 Project A)** composes on top, ships per-client. Each client = thin composition. **Validates kit's value proposition.**
  - **Pricing model** ($1.5K + $1.2K/mo + 5%) anchored in real client. **Validates Project A pricing in outline §9.**
- **What to avoid:** Don't conflate operatoros (productized service business, Layer 4 in dogfood diagram) with pipeline-kit (typed library, Layer 3). Different layers.
- **License + community:** Private (project docs); commercial (productized service).

---

### Category X — Synthesis

**Top 3 patterns to lift across pursuit + family category:**

1. **Pipeline-kit IS pursuit's essentials-kit ported to TypeScript** — confirmed by source 52's folder structure. Outline §11 reference adapter list aligns 1:1 with `pursuit/agents/tools/`. Co-evolution per **ADR20**: Python pursuit stays + MCP bridge; TS pipeline-kit ships TS twins. **Confidence HIGH.**

2. **Demand-row-level evidence anchors every reference project.** Pursuit's portfolio shortlist demands $ + applicants per row; pipeline-kit's reference projects (Trades Outbound, Multi-CRM Sync, Internal Ops Kit) inherit this discipline.

3. **Productized service builds ON TOP of pipeline-kit, not WITH it.** OperatorOS = Layer 4 (productized service) + pipeline-kit = Layer 3 (typed library). Three-layer dogfood architecture (HRP → Gatewerk → pipeline-kit → portfolio per outline §2) is validated.

**Open questions for brain adjudication:**

1. **Pursuit-Python ↔ pipeline-kit-TS bridge — which adapters prioritize?** Outline §11 lists `pursuit-demand-source` in v1. **Brain recommend: prioritize the adapters where pursuit's Python investment is hardest to re-implement (apify-* adapter catalog with credentials; pgvector embeddings; demand-mining SQL views).**
2. **Co-evolution governance** — when pursuit + pipeline-kit need a shared abstraction, who owns it? *Brain recommend: pipeline-kit owns the type/interface; pursuit consumes via MCP. Versioning is pipeline-kit's responsibility.*

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
| **ADR3** | Sync vs durable execution | v0 sync (in-process). v1 durable adapter; **Inngest as primary reference** (TS-first, step-as-boundary). Trigger.dev second; Hatchet third; Temporal too heavy; `@effect/workflow` if Effect adopted. | **HIGH** |
| **ADR14** | HRP review primitive | `Reviewable<I>` interface with `ReviewableConfig = { allowApprove, allowReject, allowEdit, allowRetry, allowIgnore }` + `describe: (input: I) => string`. Reference impl `GatewerkReviewable`; alternatives `SlackEmojiReviewable`, `EmailLinkReviewable`, `ConsoleReviewable`. List-of-responses return shape from day one. | **HIGH** |
| **ADR19** | Edit-in-place semantics | `EditableField<T> = { suggested: T, approved: T \| null, wasEdited: boolean }` flowing through pipeline. Direct lift from gotoHuman + Agent Inbox + Gatewerk. | **HIGH** |
| **ADR17** | Webhook signing | v2-style by default (`X-Webhook-Signature-V2: t=<unix>,v1=<hex>`); SDK-bundled `pipelinekit.webhooks.verify`; multi-auth support (HMAC default; Basic / Bearer / API Key alternatives); constant-time compare. | **HIGH** |
| **ADR9** | Idempotency convention | Kit auto-generates idempotency keys for `Serve<I>` mutating adapters; pairs with exp-backoff-with-jitter on retry; 24h default cache window (configurable); document scope (header-level + request-fingerprint hybrid). | **HIGH** |

### 5 net-new ADR candidates for Phase 2 (not in outline §7)

A. **Webhook signature versioning policy** (v2 default; document migration pattern). Surfaced from Gatewerk-sdk-ts (Cat II source 13).
B. **Composer ownership of durable layer** — outline §7 doesn't lock this. *Recommendation: pipeline-kit is library called BY user's durable function (architecture B), not durable runtime itself (architecture A).* Surfaced from Cat I synthesis Q1.
C. **Route-policy shape** unifying `stakes` (HumanLayer) + `confidence` (Gatewerk) + `priority` (Hatchet/Inngest) — three orthogonal signals into one config. Surfaced from Cat IV synthesis Q3 + Cat I synthesis Q5.
D. **CloudEvents emission mode** for `webhook-serve` (Stripe-shape default; CloudEvents-shape opt-in for AWS EventBridge / Azure Event Grid / Knative interop). Surfaced from Cat VII synthesis Q1.
E. **Resource taxonomy for kit's SDK** — Gatewerk has 8 resources; pipeline-kit candidates: `pipelines`, `runs`, `atoms`, `adapters`, `webhooks`. Surfaced from Cat II synthesis Q1.

### Open questions for brain (consolidated, deduplicated)

1. **(Cat I)** Composer wraps durable executor in v1 vs Composer is library called BY user's durable function. *Recommendation: B.*
2. **(Cat IV)** Resume granularity — stage-boundary-only for v0 vs intra-stage. *Recommendation: stage-boundary-only.*
3. **(Cat V)** Retry budget shape — global per-Pipeline + per-Stage vs single-level. *Recommendation: both layers.*
4. **(Cat V)** Idempotency TTL default — 24h reasonable? *Recommendation: 24h default, configurable; regulated verticals may want longer.*
5. **(Cat VI)** ArkType escape hatch for hot-path validation in v1+? *Recommendation: defer; profile first.*
6. **(Cat VII)** CloudEvents-formatted webhook payload as opt-in for `webhook-serve`? *Recommendation: yes, design as opt-in mode for v1.*
7. **(Cat IX)** Auto-MCP exposure code-gen for every kit adapter? *Recommendation: v1 feature.*
8. **(Cat X)** Pursuit-Python ↔ pipeline-kit-TS bridge — which adapters prioritize? *Recommendation: apify-* catalog, pgvector embeddings, demand-mining SQL views.*

### Memory candidates from session

1. **pipeline-kit Phase 1 research lifted ~40% of patterns from Gatewerk's `ideas-to-steal.md`** (Cat II/IV/V/VII/VIII overlap is significant). Phase 2 spec should explicitly reference Gatewerk catalog rather than re-deriving.
2. **Effect.ts ecosystem cohesion is a v1 reconsideration trigger** — `@effect/workflow` + `@effect/sql-drizzle` + `@effect/opentelemetry` + `@effect/ai-*` cascade through ADR1, ADR3, ADR8, ADR11. Adopting Effect means cascading commit; decline means re-implementing bridges.
3. **HumanLayer pivot lesson:** SDK alone is insufficient. Ship the Composer (the wiring), not just typed interfaces. Library-without-composer = unused interfaces.
4. **`/prime` slash command isn't a registered skill in current Claude Code env** — manual orientation step (read priming docs in order) is the equivalent. Document for future Phase-1 sessions.

### Phase 2 readiness: PARTIAL

Strong signal across all 10 categories. ADRs 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19 have HIGH-confidence patterns to lock. ADR5 (state/context shape), ADR12 (composition syntax), ADR20 (Pursuit interop) need brain interpretation. **5 net-new ADR candidates** (A-E above) should be added to Phase 2 catalog before spec drafting.

**Recommended Phase 2 sequence:**
1. Brain reviews this research-notes.md + adjudicates the 8 open questions.
2. Brain confirms 5 new ADR candidates (A-E) are in scope.
3. Brain drafts `pipeline-kit-spec.md` with all 25 ADRs (20 from outline §7 + 5 new) resolved.
4. Phase 3 v0 build follows.

---

*End of Phase 1 research notes. ~58 sources processed across 10 categories. Author: Claude Code session, 2026-05-06 evening. File size: ~2100 lines (over the outline's 1500 split trigger; per-category split deferred to user-as-curation step).*
