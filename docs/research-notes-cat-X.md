> Phase 1 research notes — Category X (Pursuit + Idris's existing surface). Back to [research-notes.md](research-notes.md) (synthesis) · [research-notes-full.md](research-notes-full.md) (master).

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

