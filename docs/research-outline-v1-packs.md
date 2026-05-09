# pipeline-kit — v1 Pack Roster & Vision Additions (Claude draft)

> **Purpose:** companion to `research-outline-v1.md`. Holds the
> deliverable-architecture model, the expanded pack roster, pack design
> principles, vision additions, and explicit non-scope.
>
> **Author:** Claude (Opus 4.7, 1M ctx) — 2026-05-08.
> **Companion to:** `research-outline-v1.md`,
> `research-outline-v1-constellation.md`.
> **Status:** Draft — for user review and merge into v1 spec.

---

## §1 — The four-tier deliverable architecture

Kit ships in four tiers, each with a distinct mandate. Tier 4 is the only
tier kit *doesn't* ship — every project on the web lives there equally.

```
   ┌──────────────────────────────────────────────────────────────┐
   │  TIER 1 — CORE KIT                                            │
   │  Product-agnostic. Use-case-agnostic. Stable contracts.       │
   │                                                                │
   │  • Source<O> / Store<T> / Process<I,O> / Serve<I>            │
   │  • Composer (retry / idempotency / rate-limit / OTel)         │
   │  • Reviewable<I>, Result<T,E>, Zod boundaries                │
   │  • PipelineContext (signal / metadata / trace)               │
   │  • Cross-cuts (NEW): replay / dry-run / MCP-expose            │
   └──────────────────────────────────────────────────────────────┘
                                ▲
                                │ extends
   ┌──────────────────────────────────────────────────────────────┐
   │  TIER 2 — STAGE PRIMITIVES (v1 research output)               │
   │  New typed shapes from the 10-category research.              │
   │                                                                │
   │  • Trigger<O>, Agent<I,O>, Gate<I>, Aggregate<I[],O>          │
   │  • Fan<I,Branches>, Signal                                    │
   │  • DAG composer + two-plane data/control split                │
   │  • Cross-runtime wire (kit speaks JSON-RPC / MCP / A2A)       │
   └──────────────────────────────────────────────────────────────┘
                                ▲
                                │ implements with opinions
   ┌──────────────────────────────────────────────────────────────┐
   │  TIER 3 — FEATURE PACKS                                       │
   │  Opinionated bundles. Each pack: vendor-neutral, optional,    │
   │  owns common 80% of its domain.                               │
   └──────────────────────────────────────────────────────────────┘
                                ▲
                                │ ergonomics layer
   ┌──────────────────────────────────────────────────────────────┐
   │  TIER 3.5 — TEMPLATES & ASSISTED COMPOSITION                  │
   │  pk new <template>, pk gen "<intent>", starter catalog        │
   └──────────────────────────────────────────────────────────────┘
                                ▲
                                │ composed by
   ┌──────────────────────────────────────────────────────────────┐
   │  TIER 4 — USER GLUE  (NOT shipped by kit)                     │
   │  Anyone's automations, anywhere. The constellation lives      │
   │  here as example use cases, no different from any project     │
   │  on the web.                                                  │
   └──────────────────────────────────────────────────────────────┘
```

---

## §2 — Pack roster

Packs sort by **launch tier** (when ready) and **thematic cluster** (what they
do). Launch tier ≈10 packs; expand tier ≈7; domain tier ≈9.

### Launch tier (v1 — ships with stage-primitive ADRs)

| Cluster | Pack | Domain / Vendors |
|---------|------|------------------|
| Communication | `@idriszade/notify` | email / telegram / slack / discord / sms / push |
| Observability | `@idriszade/observe` | langfuse / helicone / otel / sentry / posthog |
| Identity | `@idriszade/secrets` | doppler / infisical / sops / age / env |
| Runtime | `@idriszade/durable` | pg-boss / inngest / trigger.dev / bullmq / hatchet |
| AI providers | `@idriszade/llm` | anthropic / openai / google / groq / mistral / ollama / bedrock |
| Embeddings | `@idriszade/embed` | openai / cohere / voyage / sentence-transformers / ollama |
| Memory | `@idriszade/memory` | orchestr8 / mem0 / zep / langmem |
| Cost | `@idriszade/cost` | provider usage / langfuse / helicone / budget caps |
| DX | `@idriszade/cli` | pk run / inspect / trace / dry-run / new / gen |
| DX | `@idriszade/config` | PRP / JSON / YAML loaders |

### Expand tier (v2 — once stage primitives stabilise)

| Cluster | Pack | Domain / Vendors |
|---------|------|------------------|
| Information | `@idriszade/search` | tavily / serper / brave / exa / perplexity / algolia / meilisearch |
| Information | `@idriszade/scrape` | playwright / firecrawl / scrapingbee / apify-actors |
| Information | `@idriszade/parse` | pdf (pymupdf / marker) / office / ocr / whisper / deepgram |
| Compute | `@idriszade/sandbox` | e2b / modal / replit / daytona / cloudflare-workers |
| AI patterns | `@idriszade/rag` | chunking / retrieval / reranking / RRF / hybrid search |
| AI patterns | `@idriszade/browser` | stagehand / browserbase / browser-use / hyperbrowser |
| Cross-runtime | `@idriszade/python` | Python binding (Cat IX output) |
| Quality | `@idriszade/eval` | LLM-pipeline eval harness (NEW v1 must-have, see §5.1) |

### Domain tier (v3+ — ship when real demand surfaces)

| Cluster | Pack | Domain / Vendors |
|---------|------|------------------|
| Workspace | `@idriszade/workspace` | notion / airtable / linear / github / trello / asana |
| Time | `@idriszade/calendar` | google / outlook / calendly / cal.com / iCal |
| Money | `@idriszade/payments` | stripe / paddle / polar / lemon-squeezy |
| Realtime | `@idriszade/voice` | elevenlabs / openai-realtime / livekit / pipecat / daily |
| Media | `@idriszade/media` | cloudinary / dall-e / sd / replicate / fal.ai / runway |
| Auth | `@idriszade/auth` | oauth (auth0 / clerk / workos / supabase-auth) |
| Analytics | `@idriszade/analytics` | posthog / mixpanel / amplitude / segment |
| Data | `@idriszade/sync` | bidirectional sync / CDC / conflict resolution |
| Distribution | `@idriszade/publish` | apify actors / npm / docker / helm / vercel |

---

## §3 — Pack design principles

```
┌────────────────────────────────────────────────────────────────────┐
│  RULE 1 — Vendor-neutral on day one                                 │
│  Every pack ships ≥2 vendor implementations. Forces the contract    │
│  to be vendor-neutral, not vendor-shaped. One-vendor "packs"        │
│  are just adapters — fine, but not packs.                           │
│                                                                      │
│  RULE 2 — Optional dependency                                       │
│  Core kit never depends on a pack. Packs may depend on each other   │
│  (e.g. @idriszade/rag depends on /embed + /memory). Users        │
│  install only the packs they need.                                  │
│                                                                      │
│  RULE 3 — Owns the common 80%, ducks the bespoke 20%                │
│  Pack handles retry / formatting / fallback / SDK quirks /          │
│  observability hooks. User glue (Tier 4) handles routing logic,     │
│  copy templates, gating, business rules.                            │
└────────────────────────────────────────────────────────────────────┘
```

A pack failing any of these three rules is a smell — either it's actually
just an adapter, or core absorbed something that shouldn't be there, or the
abstraction is too thin to be useful.

---

## §4 — Five vision additions beyond packs

### 4.1 Replay & time-travel debugging *(core feature)*

Every pipeline run records its atoms + state at each stage; you can replay
any past run, optionally with modifications.

```
   pk trace pk_run_abc123                    # see what happened
   pk replay pk_run_abc123                    # rerun with same inputs
   pk replay pk_run_abc123 --from=process     # replay only the tail
   pk replay pk_run_abc123 --inject='{...}'   # rerun with patched atom
```

Composes with Cat I (durable) — if a run is durable, it's replay-able. The
personal-automation equivalent of Datadog Replay or LangSmith trace debug,
built into kit.

### 4.2 Dry-run + cost-cap = responsible-automation primitive *(core)*

Three composed safeties under one ergonomic surface:

```ts
const result = await pipeline.run(input, {
  dryRun: true,           // simulate; no Serve side effects
  costCap: { usd: 5 },    // abort if Cat X meters exceed budget
  validateOnly: true,     // only type-check the topology
})
```

Promotion gradient:

```
   ┌────────────┐     ┌────────────┐     ┌────────────┐
   │  Dry-run   │ ──► │  Cost-cap  │ ──► │  Armed     │
   │            │     │            │     │            │
   │ no Serves  │     │ Serves on, │     │ full prod  │
   │ no spend   │     │ spend cap  │     │            │
   └────────────┘     └────────────┘     └────────────┘
   "type-check?" "within budget?"   "ship it"
```

### 4.3 Pipelines as MCP tools *(core integration)*

Cat II handles kit pipelines *calling* MCP tools. The other direction is
just as powerful: every pipeline auto-exposes as an MCP tool.

```
   pipeline.expose() ─► MCP server with tool definition
   Any MCP client (Claude Code, Cursor, agents) can invoke this
   pipeline as a tool. Streaming, signal cancellation, auth all
   wired through kit primitives.
```

Recursive composition: agents call pipelines that contain Agent stages that
call other pipelines.

### 4.4 Pipeline template catalog *(Tier 3.5)*

A small curated catalog of canonical pipeline shapes — generic skeletons,
not bespoke automations.

```
   pk new <template>

   Templates:
     cron-extract-store       scheduled API → LLM → store
     rag-chat                  query → embed → retrieve → llm
     webhook-review-act        webhook → review → execute
     multi-source-enrich       N sources → merge → enrich
     daily-digest              N sources → summarise → notify
     code-watcher              git event → analyse → comment
     inbox-triage              email → classify → route → act
     meeting-prep              calendar → research → digest
     document-pipeline         upload → parse → embed → store
     agent-loop                input → agent (tools) → output
```

Time-from-zero-to-running drops from hours to minutes.

### 4.5 AI-assisted pipeline composition *(Tier 3.5)*

A kit-aware assistant — Claude Code subagent or CLI subcommand — that takes
plain English and proposes a pipeline using available packs.

```
   $ pk gen "every Monday at 9am, summarise last week's GitHub
            commits in repos I star, post to my Telegram"

   Proposed pipeline:
     trigger.cron('0 9 * * MON')
       → source.github({ kind: 'starred-commits', since: '7d' })
       → process.llm.summarise({ model: 'claude-sonnet-4-6' })
       → serve.telegram({ chat: env.TG_CHAT })

   Packs needed: @idriszade/durable, /source-web, /llm, /notify
   Estimated cost: ~$0.02 / week
   Generate code? (y/n)
```

Collapses time between idea and runnable skeleton; the skeleton is then
yours to shape.

---

## §5 — Three v1 must-haves

### 5.1 Eval harness for LLM-heavy pipelines

For any pipeline with an LLM in it, "is the new version better?" is
unanswerable without eval. fast-check property tests cover stage-level laws,
not output quality.

```
   pk eval my-pipeline.ts --dataset=evals/my-pipeline.jsonl

     ✓ accuracy:      0.87  (was 0.85, +0.02)
     ✓ format-valid:  1.00
     ✗ p95 latency:   3.2s  (target 2s) ← regression
     ✓ cost / run:    $0.012 (was $0.018)

   3/4 metrics pass · 1 regression · suggest revert
```

Ships as `@idriszade/eval` (expand tier promoted to v1). Composes Cat X
(cost) + Cat I (durable replay over a dataset) + observability. **Without
this, every LLM pipeline silently rots.**

### 5.2 Local-first dev → durable-prod seam

The same pipeline file runs two ways: in-process for dev (instant, no infra)
and on pg-boss / Inngest for prod (durable). Kit decides which based on
environment.

```
   pipeline.run(input)               # dev: in-process, instant feedback
   pipeline.run(input, { durable })  # prod: pg-boss, resumable

   pk dev                            # watches files, reloads on change
   pk dev --replay pk_run_abc        # replay a prod run locally
```

Kit-level concern (the *seam* between dev and prod), not a pack concern.
**Without this, every pipeline has two implementations or none.**

### 5.3 PII / secret redaction in observability

Atoms flowing through stages carry user data, secrets, API responses. Kit's
observability traces those — and silently leaks them to Langfuse / Helicone
/ OTel collectors.

```ts
const Atom = z.object({
  user_email: z.string().email().describe('@redact'),
  prompt:     z.string(),
  api_key:    z.string().describe('@secret'),
})
// Schema annotations drive automatic redaction in OTel + observe pack
```

Sub-concern of Cat VIII Identity/Secrets. **Default-on, with explicit
opt-out.** Leak-by-default is unforgivable for personal automations
carrying real data.

---

## §6 — Out of scope (the rejection list)

Discipline of deciding what kit *isn't*:

```
   ✗  Visual workflow builder UI         (n8n / Pipedream territory)
   ✗  Hosted SaaS tier                    (kit is library, not runtime)
   ✗  Plugin marketplace with payments    (npm is enough)
   ✗  Multi-tenant identity / RBAC        (downstream apps wire this)
   ✗  Workflow simulation game UI         (too far from shovel)
   ✗  Built-in scraping legality engine   (out-of-scope; user concern)
   ✗  Auto-generated documentation site   (let users own their docs)
```

Each rejection is a small win — kit stays sharp, doesn't drift toward
becoming a product.

---

## §7 — Mapping research categories to packs

Research yields contracts; packs yield implementations. Some categories
ship to core; some feed packs; some packs need no research at all.

| v1 Research Category | Primary Pack(s) / Output |
|----------------------|--------------------------|
| Cat I Durable Execution | `@idriszade/durable` |
| Cat II Agent Protocols | `@idriszade/agent` (subset of `/llm`) |
| Cat III DAG Composition | core kit (no pack) |
| Cat IV Trigger / Schedule | `@idriszade/durable` (overlap) |
| Cat V Memory / Feedback | `@idriszade/memory` |
| Cat VI Stage Model Extension | core kit (no pack) |
| Cat VII Config / DX | `@idriszade/cli` + `/config` |
| Cat VIII Identity / Secrets | `@idriszade/secrets` + redaction (§5.3) |
| Cat IX Cross-Runtime | core wire + `@idriszade/python` |
| Cat X Cost / Usage | `@idriszade/cost` |

Packs without a research category (well-understood — just ship): `notify`,
`observe`, `embed`, `llm`, `source-web`, `store-extra`, `rag`, `parse`,
`scrape`, `sandbox`, `browser`, `eval`.

---

## §8 — v1 final scope at a glance

```
   ✓ Core kit (Tier 1)
   ✓ Stage primitives (Tier 2 — from 10-cat research)
   ✓ ~10 launch packs (Tier 3 launch tier)
   ✓ Templates + AI-assisted gen (Tier 3.5)
   ✓ Cross-cuts: replay / dry-run / MCP-expose (§4.1–4.3)
   ✓ Eval harness (§5.1 — promoted from v2)
   ✓ Local-first dev seam (§5.2)
   ✓ PII redaction default-on (§5.3)
```

A credible, opinionated personal automation shovel — comprehensive without
being a product, ergonomic without being precious, modular without being
sprawl.

---

*End of pack roster + vision additions (Claude draft).*
*Author: Claude (Opus 4.7, 1M ctx) — 2026-05-08.*
*Companion to: research-outline-v1.md, ...constellation.md.*
