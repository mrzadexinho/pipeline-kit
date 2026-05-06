> Phase 1 research notes — Category IV (HITL patterns). Back to [research-notes.md](research-notes.md) (synthesis) · [research-notes-full.md](research-notes-full.md) (master).

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

