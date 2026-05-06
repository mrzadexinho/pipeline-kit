# pipeline-kit — Research Outline (Phase 1 input doc)

> **Purpose:** scope what gets researched in Phase 1 (Deep Research) before any
> code or spec is written. Loaded by brain + executor at Phase 1 kickoff;
> consumed via Claude Code bulk reading; outputs land in
> `pipeline-kit-research-notes.md` and feed Phase 2 (Spec).
>
> **Author:** brain — 2026-05-06 evening
> **Status:** Draft — open for comment + iteration. Quality-first, no timing
> bound. Phase 1 begins when this outline locks.

---

## 1. Goals & non-goals

### What pipeline-kit IS

A thin TypeScript library that:
- Names the four stages of any automation as typed interfaces — `Source<O>`,
  `Store<T>`, `Process<I,O>`, `Serve<I>`
- Ships reference adapters per stage (REST/webhook/Apify/scraping/MCP for
  Source; Postgres/SQLite/pgvector/Qdrant/blob for Store; etc.)
- Provides a Composer that wires stages with retry / rate-limit /
  idempotency / observability / HRP review checkpoints built in
- Aligns conventions with Gatewerk (prefixed IDs, response envelope, idempotency
  keys, HMAC webhook signing, actionable errors, Stripe-style API design)
- Composes deeply with Gatewerk via HRP — `Reviewable<I>` is a first-class
  primitive, not a bolt-on
- Stays a library, not a runtime; not a framework; not a workflow builder

### What pipeline-kit is NOT

- Not a workflow engine (n8n / Activepieces / Make / Zapier already do this)
- Not an agent runtime (LangGraph / Pydantic AI / Agency Swarm / OpenSwarm)
- Not a data warehouse ETL tool (Airbyte / Meltano / Singer / Fivetran)
- Not a tool aggregator (Composio handles 800+ services + auth)
- Not a HITL station (Gatewerk handles this — pipeline-kit composes Gatewerk,
  not replaces it)
- Not a monitoring dashboard (use Langfuse / Grafana / OpenTelemetry tooling)

It LIVES BENEATH these tools. Workflow engines call pipeline-kit composers via
webhook. Agent runtimes use Process<I,O> as a tool. Composio MCPs plug into
Source<O>. Gatewerk is the canonical Reviewable backend.

### Why this kit exists at all (the gap)

Every developer at every automation-tool-company building integrations
re-implements: retry policies, rate-limit policies, idempotency, observability,
typed stage I/O, HITL gate plumbing, audit trails. Each project ends up with a
slightly-different version of the same primitives.

`pipeline-kit` extracts the typed-stage abstraction once, with Gatewerk as the
HITL primitive, so every subsequent build is a thin composition. **The
abstraction layer below the workflow engine, above the tool aggregator.**

---

## 2. The three-layer dogfood architecture (HRP → Gatewerk → pipeline-kit → portfolio)

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  LAYER 4 — Portfolio Projects (real-world value, paying clients) │
   │                                                                  │
   │   Trades Outbound  · Multi-CRM Sync · Internal Ops Kit · Atoms  │
   │   (OperatorOS)       (HubSpot ↔        (Idris's daily              │
   │                       Pipedrive)        operating layer)          │
   └──────────────────────────────────────────────────────────────────┘
                                ↑ compose
   ┌──────────────────────────────────────────────────────────────────┐
   │  LAYER 3 — pipeline-kit (typed stages + Composer)                │
   │  Source<O>  · Store<T>  · Process<I,O>  · Serve<I>              │
   │  Reviewable<I>  · FeedbackAware<I,O>  · Audited<I,O>            │
   │  Composer  · Result<T,E>  · Atom<T>  · Context                  │
   └──────────────────────────────────────────────────────────────────┘
                                ↑ uses HRP
   ┌──────────────────────────────────────────────────────────────────┐
   │  LAYER 2 — Gatewerk (HITL station — SHIPPED v1.0 + v1.1 prod)    │
   │  Structured-form templates · Edit-in-place · Feedback memory    │
   │  Audit log (HMAC) · Retry-with-feedback · External signed links │
   │  TypeScript SDK · Python SDK · MCP server · REST API            │
   └──────────────────────────────────────────────────────────────────┘
                                ↑ implements
   ┌──────────────────────────────────────────────────────────────────┐
   │  LAYER 1 — HRP (Human Review Protocol — open spec, Apache 2.0)   │
   │  The contract any HITL station implements                       │
   └──────────────────────────────────────────────────────────────────┘
                                ↑ (Idris also dogfoods)
   ┌──────────────────────────────────────────────────────────────────┐
   │  LAYER 0 — Pursuit (opportunity-pursuit framework, parallel-evol)│
   │  Demand DB (1037 Upwork × 2533 ATS) — pipeline-kit Source        │
   │  Qualifier funnel — pipeline-kit Process composition             │
   │  Co-evolves with pipeline-kit; informs adapters; uses kit        │
   └──────────────────────────────────────────────────────────────────┘
```

### Reinforcement loops

**Loop α — pipeline-kit dogfoods Gatewerk:** every Reviewable<I> primitive in
pipeline-kit calls Gatewerk via HRP. Reference impl `GatewerkReviewable` ships
in v0. Alternative impls (`SlackEmojiReviewable`, `EmailLinkReviewable`,
`ConsoleReviewable` for dev) follow same HRP contract.

**Loop β — Gatewerk's own internal flows are pipeline-kit pipelines:**
Gatewerk's review-routing flow (incoming review → enrich with context → route to
right approver → notify) becomes a pipeline-kit pipeline. Webhook delivery
retries become pipeline-kit retry policies. **Gatewerk is its own first user.**

**Loop γ — Portfolio projects compose both:** every portfolio project ships as
a thin pipeline-kit composition that uses Gatewerk for HITL. Each project
produces real-client outcomes; each fix to pipeline-kit or Gatewerk improves
all projects.

**Loop δ — Pursuit demand DB feeds pipeline-kit Source adapters:** Pursuit's
1037 × 2533 row corpus is exposed as `PursuitDemandSource<DemandRow>`. Atoms
like `archetype-credential-mapper` use it. Pursuit and pipeline-kit
co-evolve — Pursuit's research adapters port to TypeScript pipeline-kit
Source adapters where it makes sense; Pursuit-the-application stays in
Python and consumes pipeline-kit via MCP bridge.

---

## 3. Engineering research — 6 axes

Each axis has a reading list (Section 13) and feeds specific architectural
decisions (Section 7).

### 3.1 Composition / effect handling
- How do typed pipelines compose in modern TypeScript?
- Result<T, E> vs throws? Effect.ts adoption vs vanilla TS?
- Structured concurrency, fiber-based scheduling, cancellation semantics
- Backpressure handling (RxJS / Effect Stream / AsyncIterable)
- DAG vs linear chain vs sub-pipeline composition

### 3.2 Source adapters
- Pull (Singer-style) vs push (CDC-style) vs hybrid
- Cursor-based pagination, state checkpointing, incremental sync
- Schema discovery (capability negotiation)
- Webhook-source security (SSRF, CloudEvents conformance)
- Rate-limiting at source boundary (token-bucket)

### 3.3 Store adapters
- Idempotency on writes; optimistic concurrency
- Migrations as code (Drizzle pattern)
- Schema validation at boundaries (Zod everywhere)
- Vector + relational hybrid (pursuit's pgvector pattern)
- Cache + semantic-cache patterns

### 3.4 Process primitives
- Pure functions + side effects separation
- Result<T,E> error handling convention
- Composability — `runnable.pipe(other)` LCEL-style
- Per-step observability (OpenTelemetry spans)
- LLM-call patterns: structured output, retry, semantic cache, fallback

### 3.5 Serve adapters
- Idempotent emit (don't double-send on retry)
- Outbox pattern for reliable cross-system writes
- Retry policies per output type (email vs CRM vs voice differ)
- HRP gate as composable wrapper (not built-in to every Serve)
- Fallback / dead-letter on persistent failure

### 3.6 Orchestration / observability
- OpenTelemetry native (traces / metrics / logs unified)
- Structured logging conventions
- Memory / state via DI Layer (Effect.ts pattern) or context pass-through
- Durable execution (Inngest / Trigger.dev / Temporal patterns) — v0 sync,
  v1 durable
- Cancellation / graceful shutdown semantics

---

## 4. Business + market research — 4 sub-axes

### 4.1 Marketplace mapping
For every layer of the automation stack, document the commercial landscape.
Output: layer-by-layer competitor matrix with pricing, community size, GTM.

| Layer | Competitors to map |
|---|---|
| Workflow engines | n8n, Make.com, Zapier, Activepieces, Inngest, Trigger.dev, Temporal, Airflow, Hatchet |
| Agent runtimes | LangGraph, Pydantic AI, CrewAI, Mastra, OpenSwarm, Agency Swarm, Vercel AI SDK, OpenAI Agents SDK |
| Tool aggregators | Composio, MCP server registries (smithery.ai), Anthropic MCP catalog |
| Data integration | Airbyte, Meltano, Singer, Fivetran, RudderStack, Segment, Hightouch, Census |
| HITL stations | gotoHuman, HumanLayer, LangChain Agent Inbox, Preloop, Gatewerk |
| Cold-email infra | Smartlead, Instantly, lemlist, Apollo, Postal (OSS), Maizzle |
| Lead enrichment | Clay, Apollo, Hunter, Cognism, Persana, FullEnrich, SyncGTM, Bricks (OSS) |
| Lifecycle email | Customer.io, Mautic, Listmonk, Dittofeed, Sequenzy, Novu |
| CRM | HubSpot, Pipedrive, Salesforce, Attio, GoHighLevel |
| Voice / SMS | Vapi, Bland, Twilio, LiveKit, Retell |
| Observability | OpenTelemetry, Langfuse, Grafana, Datadog, Sentry |
| Type / schema | Zod, Pydantic, Effect Schema, ArkType, Valibot |
| ORM | Drizzle, Prisma, Knex, TypeORM |

### 4.2 Pricing & buyer-persona maps
Tiers and who lives in each:
- **Free OSS** — community capture, MIT/Apache, GitHub stars as currency
- **$99/mo SaaS** — solo operator / SMB end user, self-serve onboard
- **$1-3K/mo agency tier** — Saraev/Ottley student tier, productized service
- **$5-25K/mo retainer** — Idris's target band — established consultant, multi-system delivery
- **$50K+ enterprise project** — Fortune 1000 ops modernization, long sales cycle

For each tier: typical buyer title, budget authority, decision velocity, success
metric, churn driver.

### 4.3 Demand-signal triangulation
Three independent signals minimum before locking any portfolio project:
- **Pursuit demand DB** (1037 Upwork × 2533 ATS) — applicant-normalized sweet-spot
- **LinkedIn hiring posts** — JD scraping for trending titles + tools combos
- **Reddit/HN/Producthunt/IndieHackers community sentiment** — what's people
  *complaining about* (not just buying)

### 4.4 Adjacent-market displacement
What's automation actually replacing? Document for each portfolio project:
- The role/contractor/tool being displaced
- Pre-displacement cost ($X/yr salary, $Y/mo contractor)
- Post-displacement cost (kit + maintenance)
- Net savings per client
- Why-now pressure (AI capability lift, talent shortage, margin compression)

This creates the client-pitch frame: *"We replace your $60K/yr leadgen
contractor with a $1,200/mo automation system + Gatewerk approval gate.
Savings $48K/yr, faster execution, full audit trail."*

---

## 5. Competitive landscape mining — by layer

For each direct competitor at each layer, document:
1. **What they do well — lift these patterns** (architecture, DX, naming, docs)
2. **What they do poorly — avoid these mistakes**
3. **Pricing + community + GTM** — informs our positioning
4. **Their stated philosophy / non-goals** — informs our positioning

Format per entry (template):

```
### {ProjectName}
- **Layer:** {workflow / agent runtime / etc.}
- **Pricing:** {free OSS / $X-$Y SaaS / etc.}
- **Community:** {GitHub stars, contributors, Discord size, age}
- **License:** {MIT / Apache / commercial / source-available}
- **Lift:**
  - {pattern 1 — what to adopt}
  - {pattern 2}
- **Avoid:**
  - {mistake 1 — what NOT to do}
  - {mistake 2}
- **Their stated non-goals:** {what they explicitly DON'T do}
- **Our positioning relative to them:** {where pipeline-kit sits, what's
  different / complementary}
```

Target ~20 entries across the layers in §4.1.

---

## 6. Inspiration mining (broader scope)

Per Idris's direction: "we shouldnt hesitate to research, inspire (maybe
sometimes ethically steal) the public or cloud projects on our way."

This list is intentionally broader than just direct competitors. It includes
projects that solved adjacent problems beautifully and whose patterns translate
across domains.

Note: explicit credit policy DEFERRED to v1 per Idris (2026-05-06). v0 builds
informed by these sources without per-line citation; revisit at v1.

### Engineering excellence
- **Stripe** — API design exemplar (prefixed IDs, idempotency keys, expandable
  objects, actionable errors, webhook HMAC). Already adopted by Gatewerk; extend
  conventions to pipeline-kit.
- **Resend / Knock / Supabase** — modern TypeScript SDK ergonomics (resource-
  based client, factory function, env-var fallback, typed errors)
- **Effect.ts** — typed effect system, structured concurrency, Layer DI
- **Drizzle ORM** — type-safe SQL builder, migration story, Bun-friendly
- **Hono** — modern HTTP framework, edge-friendly, typed routing
- **tRPC** — end-to-end type safety
- **Zod** — boundary validation as types
- **fast-check** — property-based testing for invariants

### Reliability primitives
- **Inngest** — durable function semantics, sleep + retry, event idempotency
- **Trigger.dev** — durable workflow patterns, observability native
- **Hatchet** — durable task execution + multi-auth webhooks
- **Temporal** — workflow durability gold standard (heavyweight reference)
- **Outbox / Saga / Idempotency-key patterns** from microservices literature

### Source / connector inspiration
- **Airbyte CDK** — most-mature OSS connector pattern (Source/Destination ABC,
  cursor pagination, schema discovery, state checkpointing)
- **Singer protocol** — industry tap/target spec (also implemented by Meltano)
- **Apify SDK** — crawler best practices, retry, proxy rotation, queue mgmt
- **n8n core nodes** — Trigger vs Action distinction, marketplace metadata
- **Activepieces pieces** — TypeScript piece pattern, MCP server generation
  (~400 MCP servers — largest OSS MCP toolkit in 2026)
- **Composio** — auth manager pattern for 800+ services

### Process / agent inspiration
- **LangChain LCEL** — `runnable.pipe(other)` chainable composition
- **Pydantic AI** — typed agent + tool patterns
- **OpenAI Agents SDK** — tool-call + handoff patterns
- **Mastra** — TypeScript-first agent framework
- **Cole Medin's PIV Loop** — Plan/Implement/Validate as agentic-engineering
  meta-process

### Serve / output inspiration
- **OpenTelemetry** — distributed tracing standard
- **CloudEvents** — webhook payload spec
- **Postal** — OSS mail server (self-hosted SendGrid)
- **Vapi / LiveKit** — voice infrastructure patterns

### HITL / oversight inspiration
- **Gatewerk** — Idris's own HITL station (already-shipped v1.0+v1.1, see
  philosophy.md + ideas-to-steal.md inside that repo)
- **gotoHuman** — direct competitor to Gatewerk; structured-review UX patterns
- **HumanLayer** — Python decorator pattern for HITL (`@require_review`)
- **LangChain Agent Inbox** — chat-style review interface
- **LangGraph interrupt()** — framework-level HITL primitive

### DX / docs inspiration
- **Drizzle docs** — interactive query builder, type-first examples
- **Pydantic AI docs** — short examples that compose
- **Effect.ts docs** — comprehensive, conceptual scaffolding
- **Cal.com architecture** — modular OSS, app-store pattern
- **Hatchet** — SDK + dashboard + API monorepo pattern

### Observability / dashboard inspiration
- **Langfuse** — beautiful dashboard, cost tracking, OSS
- **Grafana** — dashboard composition
- **Sentry** — actionable error UX

### Marketplace / template-library inspiration
- **n8n.io/workflows** — 9573 community workflows (categories, search, ratings)
- **awesome-n8n-templates** — 280+ curated patterns (vertical-organized)
- **Activepieces marketplace** — 400+ MCP servers + community pieces
- **Saraev's Maker School / Ottley's AAA** — tier pricing for productized
  automation services (informs Idris's portfolio commercial spec)

---

## 7. Architectural decisions to lock (Phase 2 input)

Each ADR will be 2-3 paragraphs in `pipeline-kit-spec.md`. Default + alternatives
+ rationale + reference. Listed here as the input set for Phase 1 research:

| # | Decision | Default | Alternatives | Reference signal |
|---:|---|---|---|---|
| 1 | Effect.ts as dependency? | Vanilla TS v0, evaluate Effect adoption v1 | Full Effect adoption | Effect learning curve vs payoff |
| 2 | Source semantic | Pull (Singer-compatible) | Push (CDC-style) | Singer protocol, webhook-source as exception |
| 3 | Sync vs durable execution | Sync v0, durable v1 (Inngest-style adapter) | Durable from v0 | Inngest, Trigger.dev |
| 4 | Result<T,E> vs throws | Result<T,E> kit-wide | Native throws | fp-ts, Effect, Gatewerk's discriminated-union pattern |
| 5 | State / context approach | Pass-through Context (DI) + orchestr8 backend | Effect Layers / global registry | Effect Layers, Hatchet context |
| 6 | Schema validation scope | Zod at every Source/Serve boundary; optional inside Process | Zod only at API edges | Zod, Pydantic AI |
| 7 | Streaming vs batch primary | Both — `Source.iter()` AsyncIterable + `Source.fetch()` batch | Batch only | Singer + RxJS |
| 8 | Observability stack | OpenTelemetry native | Custom logging | OpenTelemetry standard |
| 9 | Idempotency convention | Mandated on Serve adapters that mutate external state | Caller-managed | Stripe + Knock pattern |
| 10 | Backpressure model | Token-bucket at Source/Serve boundary | RxJS-style buffer/drop | Token-bucket standard |
| 11 | Migration story | Drizzle ORM | Prisma / raw SQL | Drizzle Bun-friendly |
| 12 | Composition syntax | `Pipeline.from(s).through(p).store(st).to(srv)` chainable | Effect Stream / Observable | LCEL inspired |
| 13 | Retry policy | Per-stage policy, kit default + override | Caller-managed | Hatchet, Inngest |
| 14 | HRP review primitive | First-class `Reviewable<I>` interface | Gatewerk-specific gate | Gatewerk HRP spec |
| 15 | Test framework | Vitest + fast-check property tests | Bun test | Vitest matches existing devshield suite |
| 16 | Naming conventions | Stripe-style (prefixed IDs `pk_pipe_`, response envelope) | Custom | Already adopted by Gatewerk |
| 17 | Webhook signing | HMAC-SHA256 + timestamp tolerance | Bearer token | Already in Gatewerk |
| 18 | Audit log | Optional `Audited<I,O>` wrapper writing to Gatewerk audit log | Per-project DIY | Gatewerk HMAC-signed audit |
| 19 | Edit-in-place semantics | `Result.suggested + Result.approved` carries through pipeline after Reviewable | Single-value Result | gotoHuman + Gatewerk pattern |
| 20 | Pursuit interop | `PursuitDemandSource` (Python via MCP bridge OR TS port) | Direct TS rewrite of Python pursuit | Co-evolution preserves Python investment |

---

## 8. pipeline-kit ↔ Gatewerk integration design — deep dogfood

### Core integration primitives

- **`Reviewable<I>`** — wraps any pipeline stage with HRP review checkpoint.
  Reviewer sees structured form (Gatewerk template), can edit fields,
  returns approved (possibly modified) I. If approved, downstream resumes.
  If rejected, halts (or routes to fallback path).
- **`FeedbackAware<I,O>`** — wraps any Process to query Gatewerk feedback
  memory before run. Process learns from past human edits via cross-pipeline
  feedback corpus.
- **`Audited<I,O>`** — wraps any stage to log every input/output to Gatewerk's
  HMAC-signed audit log. Compliance feature for regulated verticals.
- **`EditableField<T>`** — type carrying `{ suggested: T, approved: T | null,
  wasEdited: boolean }`. Flows through pipeline so downstream Process knows
  what was changed and learns from it.

### 16 creative Gatewerk uses (beyond approve/reject)

1. **Multi-stage pipeline reviews** — pause at any Source/Process/Serve
   transition for HRP review. Different reviewer per stage.

2. **Edit-in-place propagation** — reviewer modifies data; modifications flow
   through the rest of the pipeline. `suggestedValue` vs `approvedValue` diff
   becomes downstream Process input + training signal.

3. **Conditional pipelines branching on reviewer choice** — Gatewerk button-
   group field returns "branch A" / "branch B" / "merge" / "escalate"; pipeline
   routes accordingly.

4. **External reviewer signed URLs** — OperatorOS clients review their own
   automations without accounts. Email/SMS link → Gatewerk review form →
   pipeline resumes.

5. **Retry-with-feedback loops** — Process emits suboptimal output → reviewer
   rejects with feedback comment → Process re-runs with feedback as augmented
   input. Iterative refinement, captured in HRP.

6. **Cross-pipeline feedback memory** — every pipeline querying Gatewerk
   feedback API learns from cross-pipeline corpus. Trades Outbound learns from
   Lifecycle Stack learns from Multi-CRM Sync. Compounding intelligence.

7. **Audit-as-compliance-feature** — for OperatorOS regulated trades clients
   (HVAC EPA-cert, plumbing licensing, healthcare HIPAA): every customer-facing
   automation has Gatewerk audit. Compliance-as-a-feature, not a chore.

8. **Reviewer routing by expertise** — pipeline-kit `route-process` routes
   reviews based on payload type: legal contracts → ops manager, customer
   escalations → CSM, technical decisions → engineer. Gatewerk template defines
   routing.

9. **updateForReviewId-style versioning** — agent generates draft v1, reviewer
   rejects, agent regenerates v2 (linked to v1). Full version history per
   review. Useful for proposal-style outputs.

10. **Templated form-driven inputs** — Internal Ops Kit users fill structured
    Gatewerk forms (project-brief template, customer-update template, deal-
    status template) instead of free-form prompts. Forms ARE the canonical
    schemas; downstream Process consumes typed data.

11. **Inter-agent reviews** — two pipelines review each other's outputs through
    Gatewerk. Trades Outbound's response-classifier reviews Multi-CRM Sync's
    deal-stage decisions. Agent → Gatewerk → Agent loop with humans optionally
    in middle.

12. **Atom marketplace gating** — Idris's published atoms ship with default
    `Reviewable` wrapper. Open-source users get HITL safety free; commercial
    users buy Gatewerk Cloud for managed compliance. Differentiates atom
    distribution.

13. **Reviewer-as-demand-validator** — Idris drafts new atom v0 → ships to
    small set of Gatewerk reviewers (CSMs of OperatorOS clients) → they review
    test runs → approval/edit/feedback → v1 ships with proven copy + edge
    cases captured.

14. **Audit-log-as-source** — Gatewerk audit log → pipeline-kit
    `GatewerkAuditSource` → Process (summarize) → Serve (PDF). One-line
    compliance-report pipeline shipped per client.

15. **Template-as-schema-as-form** — every pipeline I/O type that crosses
    human review = a Gatewerk template. Template renders form for reviewer;
    pipeline-kit imports template definition for typed I/O. Single source of
    truth for schema + UI.

16. **Pipeline-kit pipelines AS Gatewerk's own internal flows** — Gatewerk's
    review-routing, notification-fanout, and audit-aggregation pipelines are
    themselves pipeline-kit compositions. Gatewerk dogfoods the kit; the kit
    is validated by Gatewerk's own production usage.

### Integration milestones

| Milestone | What ships | Validates |
|---|---|---|
| **M0** | `Reviewable<I>` interface + `GatewerkReviewable` reference impl | Loop α (kit dogfoods Gatewerk) |
| **M1** | `FeedbackAware<I,O>` + Gatewerk feedback API integration | Cross-pipeline learning |
| **M2** | `Audited<I,O>` + Gatewerk audit log integration | Compliance feature |
| **M3** | `EditableField<T>` flows through pipeline, downstream Process consumes | Edit-in-place training signal |
| **M4** | Gatewerk's internal flows refactored to use pipeline-kit | Loop β (Gatewerk dogfoods kit) |
| **M5** | First portfolio project (Trades Outbound) ships with HRP gates | Loop γ (full-stack dogfood) |

---

## 9. Portfolio project commercial spec

Every project locks: buyer / pricing / pipeline-kit deps / Gatewerk integration
/ real-world value / demand evidence / FT credentialing band. Drafted explicitly
before any executor brief.

### Project A — Trades Outbound (OperatorOS dual-purpose)
- **Buyer:** trades-vertical SMB owner (HVAC, appliance, electrical, plumbing,
  garage door, pest control). First client = Alp Appliance Repair (Phase 1
  trigger).
- **Pricing:** $1.5K setup + $1.2K/mo retainer + 5% performance (per
  operatoros/README.md Phase 1 spec). Year-1 target: 5-10 retainers = $6-12K
  MRR.
- **pipeline-kit deps:** `ApolloSource`, `BuiltWithSource` (SaaS-signal
  targeting for LSA/GMB shops), `ApifyGoogleMapsSource`, `PostgresStore` +
  `PgVectorStore` (similarity dedup), `EnrichProcess`, `PersonalizeProcess`,
  `SmartleadServe` or `PostalServe`, `SlackServe`.
- **Gatewerk integration:** first 100 sends per campaign = `Reviewable`;
  daily-batch first-pass review; deal-stage transitions in GHL gated;
  external-reviewer signed URLs for client co-review.
- **Real-world value:** 10-30 booked appointments/month from cold outreach
  with HITL safety; OperatorOS productization template; Alp deployment as
  case study at Phase 1 trigger.
- **Demand evidence:** $321K Clio outbound (8 apps, sweet-spot) + $147K AI
  Lead Gen + every GHL trades premium row + OperatorOS Phase 1 spec.
- **FT cred (primary):** revops_ic, sales_ops_ic, founding_gtm at AI Series A/B.
- **FT cred (stretch):** growth_engineer, FDE-flavor at automation-tool cos.

### Project B — Multi-CRM Operational Sync (HubSpot ↔ Pipedrive v0)
- **Buyer:** mid-market sales orgs running multiple CRMs (M&A integration,
  vertical-team-split, channel-partner-shared-CRM scenarios).
- **Pricing:** $5-15K project setup + $1-3K/mo retainer for ongoing rule
  evolution + sync monitoring.
- **pipeline-kit deps:** `HubSpotSource`, `PipedriveSource`, `PostgresStore` +
  audit log, `TranslateProcess` (workflow logic translation), `DedupProcess`
  (uses migratoor pattern), `HubSpotServe` + `PipedriveServe` (bidir).
- **Gatewerk integration:** every sync conflict = `Reviewable`; workflow-
  translation drift requires reviewer approval; rule changes versioned via
  `updateForReviewId`; rollback-via-Gatewerk.
- **Real-world value:** unifies sales orgs running parallel CRMs without
  data loss or workflow regression; closes the multi-CRM operational gap that
  Airbyte/Meltano explicitly don't fill.
- **Demand evidence:** $2.09M HubSpot/Pipedrive (8 apps — #1 sweet-spot in
  pursuit corpus) + $499K NetSuite QuickBooks + $161K Method CRM.
- **FT cred (primary):** integration_engineer (51 ATS), revops_ic (48),
  bizops (66), forward_deployed_engineer (64 selective).
- **FT cred (stretch):** ai_agent_engineer at AI-CRM cos (Attio, Salesforce
  Einstein).

### Project C — Internal Ops Kit (Idris's daily layer)
- **Buyer:** Idris first; expansion to fellow GTM consultants + agency
  owners; productize as $99/mo SaaS subscription or $499 one-time license.
- **pipeline-kit deps:** `TavilySource`, `NotionSource` (read), `HubSpotSource`
  (read), `PursuitDemandSource`, `orchestr8` memory adapter, `ClaudeProcess`,
  `SlackServe`, `EmailDraftServe`, `NotionServe` (write).
- **Gatewerk integration:** every external write (Notion-create,
  HubSpot-update, email-send) gated through Gatewerk Slack-emoji approval;
  forms-driven inputs use Gatewerk templates as canonical schemas.
- **Real-world value:** Idris's own daily operating layer; demonstrates
  pipeline-kit + Gatewerk + pursuit working together; productizes for fellow
  GTM Engineers.
- **Demand evidence:** $97K Senior Operations Lead + Idris dogfood + every
  fractional-GTM-advisor pattern.
- **FT cred (primary):** GTM Engineer at AI Series A/B, Founding GTM.
- **FT cred (stretch):** Anthropic FDE (explicitly stretch, not primary).

### Project D — Atomic primitives (5-7 published atoms, post-projects)
- **Buyer:** fellow developers + automation consultants who use pipeline-kit;
  inbound traffic to senior-tier consulting.
- **Pricing:** OSS, drives lead-gen for senior-tier engagements.
- **pipeline-kit deps:** one Source/Store/Process/Serve adapter per atom.
- **Gatewerk integration:** atoms that mutate external state ship with
  default `Reviewable` wrapper.
- **Real-world value:** typed primitives composable in any pipeline-kit
  pipeline; published as standalone npm packages extending devshield-suite
  pattern.
- **Demand evidence:** each atom cited to specific demand row OR multi-row
  pattern (per "atomic-automations-library-design.md" 4-pillar discipline).
- **FT cred:** showcases compositional architecture; reinforces pipeline-kit
  thesis at every interview.

---

## 10. Pursuit parallel-evolution plan

Pursuit is not done. It evolves alongside pipeline-kit + Gatewerk rather than
freezing.

### Pursuit's role in the family
- **Application layer** consuming pipeline-kit (Layer 4 in dogfood diagram)
- **Data corpus** (1037 × 2533 rows + growing daily) exposed as
  `PursuitDemandSource<DemandRow>` to any pipeline-kit pipeline
- **Methodology reference** (demand mining, archetype mapping, qualifier
  funnel) — patterns surfaced into pipeline-kit Process primitives
- **Python codebase** continues; TypeScript bridge via MCP for cross-language
  interop

### Co-evolution contract
- Pursuit's Source adapters (Apify Upwork, ATS index, JSearch) evolve in
  Python; pipeline-kit ships TypeScript twins for JS-land users; both share
  same archetype + demand-mining vocabulary
- Pursuit's qualifier extraction patterns inform pipeline-kit's
  `ExtractProcess<I,O>` design
- Pipeline-kit's `Reviewable<I>` propagates back to pursuit Stage-2 `/prep`
  flow when Idris ships next iteration
- Pursuit's demand DB feeds pipeline-kit atoms (e.g., `archetype-credential-
  mapper`, `icp-to-bid-targets`)

### What this unlocks
- Pursuit's existing investment isn't redone in TS — it's bridged
- Pipeline-kit gets battle-tested demand-mining patterns for free
- Idris can demo pipeline-kit + pursuit together as a polyglot story
  ("Python where Python is best, TS where TS is best, MCP bridges them")

---

## 11. Reference adapter list (v0 / v1 / v2 candidates)

### v0 (ships with research-validated minimum surface)

**Source (4):**
- `api-source` — REST/GraphQL with cursor pagination + auth
- `webhook-source` — incoming webhook with HMAC verify (Hono-backed)
- `apify-source` — wrap any Apify actor
- `mcp-tool-source` — wrap any MCP tool call

**Store (3):**
- `postgres-store` — Drizzle ORM, idempotency, migration story
- `sqlite-store` — local + dev (orchestr8-style)
- `pgvector-store` — embedding store (pursuit pattern)

**Process (5):**
- `extract-process` — LLM extraction with Zod schema validation
- `classify-process` — rule-based or LLM classifier
- `validate-process` — boundary coercion (per
  `feedback_pydantic_boundary_coercion.md` — coerce, don't reject)
- `route-process` — Gatewerk reviewer-routing
- `reviewable-wrapper` — `Reviewable<I>` HRP gate

**Serve (4):**
- `email-serve` — SMTP / Postal / Resend
- `slack-serve` — message + reaction-emoji approval (legacy gate alongside HRP)
- `webhook-serve` — outbound webhook with HMAC signing
- `mcp-tool-serve` — exposes pipeline output as MCP tool

**Composer + observability:**
- Retry policy + token-bucket rate-limit + circuit breaker + OpenTelemetry
  hooks + structured logging + memory adapter (orchestr8-backed)

### v1 (driven by real portfolio-project needs)
- `enrich-process` (waterfall: Apollo → Hunter → Bricks)
- `dedup-process` (migratoor-pattern dedup)
- `summarize-process`
- `crm-serve` (HubSpot, Pipedrive, GHL, Attio)
- `pgvector-store` semantic-cache layer
- `qdrant-store`
- `pursuit-demand-source` (DB + MCP bridge)
- `audit-process` (`Audited<I,O>` Gatewerk-backed)
- `feedback-aware-process` (Gatewerk feedback memory)
- `voice-serve` (Vapi, Twilio Voice)
- `sms-serve` (Twilio SMS, GHL SMS)
- `pdf-serve` (mediaflow PDF pattern)

### v2 (durable execution + advanced patterns)
- Inngest-backed durable Composer
- Saga-pattern multi-system writes
- Effect.ts adoption evaluation (re-spec if adopting)
- `dashboard-serve` (Datasette / Retool / Supabase Dashboard)
- `gatewerk-audit-source` (audit log → pipeline)

---

## 12. Test plan + invariants

Property-based tests (fast-check) for kit-level laws:
- `Source.fetch` is deterministic given same `(query, cursor)`
- `Source.iter` and `Source.fetch` produce same data on equivalent params
- `Store.put` is idempotent given same idempotency key
- `Store.put().then(Store.get)` round-trips Atom integrity
- `Process<I,O>.run` is referentially-transparent for pure-Process subclass
- `Serve.emit` is idempotent given same idempotency key
- `Reviewable<I>` preserves `I` shape on approve; rejects propagate halt
- `EditableField<T>.suggested ≠ approved → wasEdited === true`
- `Pipeline.run` cancellation is graceful (in-flight stage completes or
  cleanly aborts)
- `OpenTelemetry` traces span every stage with parent/child relationships

Test-suite target: 250+ property + unit + integration tests, mirroring kit
structure. Vitest + fast-check.

---

## 13. Reading list — categorized for Claude Code batch consumption

Per Idris's direction: don't bound the list, leverage Claude Code's bulk-data
analysis. Organized so Claude Code can summarize each category in batch and
extract architectural decisions.

### Category I — Architecture references (read for ABC patterns + DI)

1. Effect.ts docs — https://effect.website
2. Effect.ts `effect-ts/effect` repo — Layer + Context + Stream sources
3. Inngest engineering blog — durable function semantics
4. Trigger.dev docs — workflow patterns, event triggers
5. Hatchet docs — durable task execution
6. Temporal SDK overview — workflow durability primitives
7. Cole Medin's "Principles of Agentic Engineering" — PIV Loop + AI Layer

### Category II — TypeScript SDK ergonomics

8. Stripe Node SDK — https://github.com/stripe/stripe-node
9. Resend SDK — https://github.com/resend/resend-node
10. Supabase JS — `createClient()` factory pattern
11. Knock SDK — typed exception hierarchy
12. tRPC docs — end-to-end type safety
13. Gatewerk's `packages/sdk-ts/` — already adopts these patterns

### Category III — Source / connector patterns

14. Airbyte CDK — https://docs.airbyte.com/connector-development/cdk-python
15. Singer protocol spec — https://github.com/singer-io/getting-started
16. Meltano connector dev — https://docs.meltano.com
17. Apify SDK docs — https://docs.apify.com/sdk
18. n8n core nodes — https://github.com/n8n-io/n8n/tree/master/packages/nodes-base
19. Activepieces pieces — https://github.com/activepieces/activepieces/tree/main/packages/pieces

### Category IV — HITL patterns

20. Gatewerk's `docs/philosophy.md` + `docs/blueprint.md` (READ FIRST)
21. Gatewerk's `docs/research/ideas-to-steal.md` — pattern catalog
22. Gatewerk's `docs/research/competitive-analysis.md`
23. Gatewerk's `docs/research/gotohuman-teardown.md`
24. gotoHuman docs — https://docs.gotohuman.com
25. HumanLayer Python decorator pattern — https://github.com/humanlayer
26. LangChain Agent Inbox — https://github.com/langchain-ai/agent-inbox
27. LangGraph `interrupt()` docs

### Category V — Reliability patterns

28. "Outbox Pattern" — Microservices.io reference
29. "Saga Pattern" — Microservices.io reference
30. Stripe idempotency-key engineering blog
31. AWS reliability whitepaper — backoff + jitter
32. "Fail at Scale" — Facebook Engineering reliability paper

### Category VI — Type / schema / validation

33. Zod docs — https://zod.dev
34. Pydantic AI docs — https://ai.pydantic.dev
35. Effect Schema — https://effect.website/docs/schema
36. ArkType docs (alternative)
37. Drizzle ORM docs — type-safe SQL + migrations

### Category VII — HTTP / webhook / event

38. Hono docs — https://hono.dev
39. CloudEvents 1.0 spec — https://github.com/cloudevents/spec
40. Stripe webhook engineering — HMAC + tolerance window
41. Hatchet webhook patterns
42. Resend webhook verification SDK pattern

### Category VIII — Observability

43. OpenTelemetry JS — https://opentelemetry.io/docs/languages/js
44. Langfuse architecture — https://langfuse.com (open source backbone)
45. Sentry's error UX patterns

### Category IX — Marketplace + community references

46. n8n.io/workflows top-100 — pattern catalog from 9573 community workflows
47. enescingoz/awesome-n8n-templates — 280+ curated by-vertical
48. Activepieces marketplace top-50 pieces
49. Composio Tool Router documentation
50. Saraev's "5 Automations You Can Sell" + Maker School blueprint list
51. Liam Ottley's AAA Accelerator + AIOS framework

### Category X — Pursuit + Idris's existing surface (READ for context)

52. `pursuit/docs/strategy/essentials-kit.md` — current Idris pipeline frame
53. `pursuit/docs/strategy/portfolio_shortlist_v1.md` — locked portfolio
54. `pursuit/data/demand_intel/2026-05-05/demand_report.md` — demand DB
55. `pursuit/docs/research/automation-portfolio-research-2026-04-22.md`
56. `agent-forge/README.md` — research stack patterns
57. `mediaflow/README.md` — multi-tenant SaaS patterns
58. `operatoros/README.md` + `operatoros/STATUS.md` — productized service

### Reading workflow (Claude Code-optimized)

For each category:
1. Claude Code bulk-fetches docs / repo READMEs / key source files
2. Generates structured note per source (purpose / core abstractions / API
   surface / what to lift / what to avoid)
3. Cross-references against pipeline-kit ADR table (Section 7)
4. Outputs `pipeline-kit-research-notes.md` with category-level summaries
5. Brain reviews + finalizes ADRs in `pipeline-kit-spec.md`

---

## 14. Roadmap v0 → v1 → v2

### v0 — Ship the kit + Trades Outbound (validates loops α + γ)
- Core ABCs + Composer + 16 reference adapters (per §11)
- 250+ tests with fast-check property tests
- `GatewerkReviewable` reference impl (loop α)
- Trades Outbound portfolio project on top (loop γ)
- README + ADR doc + 1 hero blog post on idriszade.com

### v1 — Ship Multi-CRM Sync + Gatewerk dogfoods kit (validates loop β)
- Real portfolio-project-driven adapters added (§11)
- `Audited<I,O>` + `FeedbackAware<I,O>` shipped
- Gatewerk's internal flows refactored to use pipeline-kit (loop β)
- Multi-CRM Sync portfolio project ships on kit
- 5-7 atoms published as standalone npm packages
- Public roadmap on idriszade.com

### v2 — Durable execution + advanced patterns
- Inngest-backed durable Composer adapter
- Saga-pattern multi-system writes
- Effect.ts adoption re-evaluation (decide adopt or stay vanilla)
- Marketplace (community-contributed adapters)
- Cloud-managed pipeline-kit hosting (parallel to Gatewerk Cloud)

---

## 15. Public commitment — idriszade.com positioning

Headline:
> **Idris Idriszade — Automation Consultant. Pipeline architecture for AI-
> native operations.**

Hero subhead:
> *I build the abstraction layer beneath the workflow engine. Six MCP servers
> on npm, one HITL station in production, one demand-intelligence framework,
> one productized service for trades businesses. Pipeline-kit ties it all
> together — and so will yours, if we work together.*

In-flight commitments (publish as a roadmap section):
- `pipeline-kit` — research outline drafted; spec + v0 build in motion
- `gatewerk` — v1.0 + v1.1 shipped; v1.2 dashboard redesign in flight
- `pursuit` — qualifier funnel + demand mining shipped; pipeline-kit bridge in motion
- Trades Outbound (OperatorOS productization template) — Phase 1 trigger pending
- Multi-CRM Operational Sync — v0 spec post-Trades-Outbound

Three-section landing structure:
1. **Architecture** — pipeline-kit + Gatewerk + pursuit; the dogfood story
2. **Reference projects** — Trades Outbound, Multi-CRM Sync, Internal Ops Kit
3. **Atomic library** — published primitives extending devshield suite pattern

This commitment goes public when this research outline is approved.

---

## 16. Phase 1 → Phase 2 → Phase 3 sequence

| Phase | Output | Triggers next phase |
|---|---|---|
| **Phase 1 (this doc → research notes)** | `pipeline-kit-research-notes.md` populated by Claude Code bulk reading | All categories I-X notes complete |
| **Phase 2 (Spec)** | `pipeline-kit-spec.md` — locks all 20 ADRs + API surface + reference adapter list + test plan + roadmap | Spec doc complete + brain-reviewed |
| **Phase 3 (v0 build + Trades Outbound)** | npm package `@mrzadexinho/pipeline-kit` + portfolio project ships | v0 ships + 250+ tests + first portfolio project deployed |

Quality > timing. No artificial deadline. Each phase ends when its output
is defensible, not when the calendar says.

---

## 17. Open questions / what to confirm before Phase 1 begins

These are reserved for brain + Idris adjudication, not Claude Code research:

1. **Gatewerk v1.3 ecosystem features** — should pipeline-kit integration be
   part of Gatewerk v1.3 plan, or shipped as a separate package that imports
   Gatewerk's existing v1.1 SDK? My initial pick: separate package, using v1.1
   SDK; pipeline-kit work doesn't block Gatewerk v1.2 launch.

2. **HRP spec versioning** — pipeline-kit pins to HRP v1 OR tracks latest? My
   initial pick: pins to v1, upgrades explicitly per release.

3. **Pursuit Python ↔ TypeScript bridge mechanism** — MCP server (preferred,
   matches existing pursuit pattern) vs gRPC vs JSON-RPC? My initial pick: MCP.

4. **Atom naming** — `@mrzadexinho/pk-atom-{name}` (kit-prefixed) vs
   `@mrzadexinho/{atom-name}` (flat)? My initial pick: flat — consistent with
   existing devshield suite, atoms compose pipeline-kit but aren't lock-in.

5. **idriszade.com publish trigger** — when this research outline is approved,
   or when Phase 2 spec lands? My initial pick: outline approval = public
   commitment, since the outline IS the artifact proving architectural
   thinking.

---

*Research outline drafted 2026-05-06 evening. Ready for Phase 1 reading kickoff
when Idris locks. Quality-first, no timing bound.*
