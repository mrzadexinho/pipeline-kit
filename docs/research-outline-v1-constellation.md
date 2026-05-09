# pipeline-kit — v1 Constellation Observations (seed for Phase 0 friction catalog)

> **Purpose:** companion to `research-outline-v1.md`. Initial seed
> observations from `Claude-Workspace/` projects to bootstrap Phase 0.
> These are seeds, not final entries — the actual catalog
> (`docs/research-friction-catalog.md`) is built during Phase 0 via deeper
> per-project reads.
>
> **Important framing:** These projects are *example use cases*, not kit
> customers. They live in Tier 4 (user glue) — equal to any n8n flow,
> Apify actor, or Python script anywhere on the web. Kit reads them only
> because we have direct file access; the friction surfaced here is meant
> to be **general to all automation**, not specific to these projects. Kit
> must not bake in any project-specific assumption.
>
> **Author:** Claude (Opus 4.7, 1M ctx) — 2026-05-07.
> **Companion to:** `research-outline-v1.md` (split from Appendix A).

---

## Friction tag taxonomy

Friction observations are tagged for cross-category synthesis:

| Tag | Meaning | Maps to category |
|-----|---------|------------------|
| F-DURABILITY | Long-running / resumable execution gaps | Cat I |
| F-AGENT | Multi-turn / multi-agent composition gaps | Cat II |
| F-LINEAR | DAG / fan-out / parallel composition gaps | Cat III |
| F-TRIGGER | Schedule / webhook / event entry-point gaps | Cat IV |
| F-MEMORY | Cross-run state / feedback / RAG gaps | Cat V |
| F-PRIMITIVE | Missing stage type / control-plane gaps | Cat VI |
| F-CONFIG | Pipeline-as-data / template / DX gaps | Cat VII |
| F-AUTH | Secrets / identity / scoping / rotation gaps | Cat VIII |
| F-INTEROP | Cross-runtime / cross-language gaps | Cat IX |
| F-COST | Usage / budget / resource accounting gaps | Cat X |
| F-RETRY | Retry / idempotency / rate-limit gaps | Cat I (likely) |
| F-OBSERVE | Observability / replay / debug gaps | Cat I or Cat VI (TBD) |

---

## pursuit (v2.3, Python)

**What it is:** unified opportunity-pursuit framework with 3 modes
(job_search / freelance / local_business). Modes are config-on-core; the core
is product-agnostic.

**Pipeline-kit-relevant patterns:**
- Modes ↔ `Branch<I, O[]>` candidate.
- Market-intel scripts ↔ `Trigger<O>` candidate.
- Feedback corpus pattern ↔ `MemoryAdapter` candidate.

**Friction (kit-providable):**
- F-INTEROP: Python ↔ TS — kit can't underpin pursuit until cross-runtime.
- F-TRIGGER: scripts as triggers — no shared `Trigger<O>`.
- F-AUTH: Supabase service-role unscoped — no rotation, no lease.
- F-MEMORY: feedback corpus shape ≠ orchestr8 / gatewerk shapes.

**Friction (cross-project):**
- pursuit ↔ gatewerk: no Reviewable<I> bridge in Python; pursuit can't route
  decisions through gatewerk natively without a custom HTTP shim.

**Anchor refs:** `pursuit-v2.3/README.md`, `pursuit-v2.3/scripts/market_intel/`,
`pursuit-v2.3/src/` (specific files TBD in Phase 0).

---

## agent-forge / Apify Studio (Python + JS)

**What it is:** marketplace-publishing automation business — build, publish,
monetize Apify actors at scale. 8-step lifecycle:
research → demand-gate → plan → execute → validate → deploy → battle-test →
marketing → consolidate.

**Pipeline-kit-relevant patterns:**
- 8-step DAG with HRP gates between most steps — perfect Composer test bed.
- Slash-commands as triggers (`/studio/research`, `/studio/execute`, etc.).
- Demand-gate is exactly `Gate<I>` (predicate-based pass/fail).

**Friction (kit-providable):**
- F-LINEAR: lifecycle is a DAG (parallel marketing/consolidate) — kit's linear
  Composer can't express it today.
- F-DURABILITY: battle-test is long-running, must resume after VPS reboot.
- F-COST: battle-test costs tracked manually in reports.
- F-TRIGGER: slash-commands as triggers — no kit form.
- F-AUTH: Apify keys in `~/.apify/auth.json` — fine for solo, breaks for
  multi-user / scoped.
- F-PRIMITIVE: demand-gate is a Gate but agent-forge built it bespoke.

**Friction (cross-project):**
- agent-forge ↔ orchestr8: actor-runtime sessions don't persist via orchestr8
  memory; agent-forge has its own session log files.
- agent-forge ↔ pipeline-kit: kit could orchestrate the 8-step lifecycle but
  agent-forge can't import kit (kit is TS-only).

**Anchor refs:** `agent-forge/STUDIO.md`, `agent-forge/STUDIO-STATUS.md`,
`agent-forge/CLAUDE.md`.

---

## orchestr8 (TypeScript MCP)

**What it is:** agent coordination MCP server with shared memory, smart
routing, learning. 13 MCP tools across memory / coordinator / learning
modules. SQLite + Vector hybrid backend. Already published to npm.

**Pipeline-kit-relevant patterns:**
- IS the candidate `MemoryAdapter` reference impl — kit's Cat V should adopt
  rather than re-invent.
- Coordinator module (`analyze_task`, `score_agents`, `create_delegation_plan`)
  overlaps with kit's Composer fan-out + Reviewable routing.

**Friction (kit-providable):**
- F-MEMORY: kit doesn't use orchestr8 yet — `MemoryAdapter` stub still has no
  reference impl.
- F-INTEROP: orchestr8 lives as MCP; kit treats MCP as dumb tool boundary
  (per Cat II spike).
- F-PRIMITIVE: orchestr8's task scoring overlaps with kit's Branch routing —
  potential dedup opportunity.

**Friction (cross-project):**
- orchestr8 ↔ gatewerk: gatewerk's feedback memory and orchestr8's shared
  memory are independent stores — no cross-pollination.

**Anchor refs:** `orchestr8/README.md`, `orchestr8/src/` (specific files
TBD in Phase 0).

---

## gatewerk (TypeScript + Python SDKs)

**What it is:** open-source human oversight station. Reviewable<I> reference
impl already in M0 (`@idriszade/process-reviewable`). Multi-framework SDK
precedent (LangChain, CrewAI, AutoGen, OpenAI Agents, Vercel AI SDK, n8n,
Claude/Cursor/Windsurf via MCP, Dify).

**Pipeline-kit-relevant patterns:**
- Cross-language SDK pattern (TS + Python) is Cat IX precedent.
- Feedback memory pattern is Cat V evidence.
- HMAC webhook auth is Cat VIII evidence.

**Friction (kit-providable):**
- F-INTEROP: TS / Python SDK ergonomic divergence — gatewerk team writes them
  by hand twice; kit could provide a generated bridge.
- F-MEMORY: feedback memory shape ≠ orchestr8 memory shape (one is HRP
  decision-history, the other is agent-shared facts).
- F-AUTH: HMAC-only signing, no rotation story; works fine until you have to
  rotate.

**Friction (cross-project):**
- gatewerk ↔ pursuit: pursuit (Python) needs gatewerk Reviewable but Python
  SDK is thinner than TS SDK.

**Anchor refs:** `gatewerk/README.md`, `gatewerk/CLAUDE.md`,
`gatewerk/apps/` and `gatewerk/packages/` (specific files TBD in Phase 0).

---

## cole-obsidian-ai-agent (Python)

**What it is:** RAG-based Obsidian AI agent. Backend RAG pipeline +
Alembic migrations + Docker stack. Cole Medin reference architecture for
personal AI.

**Pipeline-kit-relevant patterns:**
- RAG flow = `Source(obsidian) → Process(chunk) → Process(embed) →
  Store(pgvector) → Process(retrieve) → Process(extract)`.
- Reference linear pipeline; would benefit from kit's Composer for retry / OTel
  / idempotency.
- Streaming response pattern (`test_streaming.py` exists).

**Friction (kit-providable):**
- F-INTEROP: full Python stack — kit unreachable without Cat IX.
- F-COST: Ollama as cost-dodge signal — kit should make local-vs-API cost
  trade-off explicit, not invisible.
- F-MEMORY: RAG-as-memory pattern overlaps with Cat V (orchestr8 vs gatewerk
  feedback vs RAG retrieval — three flavours of "memory").
- F-DURABILITY: chunk/embed jobs need pg-boss equivalent; alembic migrations
  imply state-management awareness.
- F-RETRY: backend_rag_pipeline likely re-rolls retry logic.

**Friction (cross-project):**
- cole-obsidian ↔ orchestr8: both are "memory" but live in separate worlds —
  RAG memory (semantic) vs shared agent memory (structured).

**Anchor refs:** `cole-obsidian-ai-agent/README.md`,
`cole-obsidian-ai-agent/backend_rag_pipeline/`,
`cole-obsidian-ai-agent/test_streaming.py`.

---

## context-engineering-hub

**What it is:** Cole Medin's Claude Code workflow framework: PRP templates,
slash-commands, subagents, hooks, global-rules.

**Pipeline-kit-relevant patterns:**
- PRP template = `Spec<I>` primitive candidate (context + req + validation
  in one structured doc).
- Slash-commands = trigger model (already cross-referenced from agent-forge).
- Subagents + hooks = control-plane precedent for kit's Cat VI two-plane.

**Friction (kit-providable):**
- F-CONFIG: PRP as structured-prompt format kit could speak natively — kit's
  `pipeline.describe()` doesn't yet emit PRP-shaped specs.
- F-PRIMITIVE: hooks as control-plane reference — Claude Code's hook lifecycle
  (PreToolUse / PostToolUse / Stop / SessionStart / etc.) is exactly the
  control-plane shape kit's two-plane model needs.

**Anchor refs:** `context-engineering-hub/README.md`,
`context-engineering-hub/prp-templates/`,
`context-engineering-hub/claude-hooks/`,
`context-engineering-hub/subagents/`.

---

## ai-agent-mastery (notes / projects / sentinel)

**What it is:** user's working notes from Cole Medin's AI Agent Mastery
course. Contains `sentinel` and `sentinel-app` — monitoring / governance
agent pattern.

**Pipeline-kit-relevant patterns:**
- Sentinel pattern = `Process<I,O>` with policy predicate = `Gate<I>` candidate.
- Course `kb/` and `projects/` directories likely contain reference automations
  Phase 0 should sample.

**Friction (kit-providable):**
- F-PRIMITIVE: sentinel as Gate evidence — generalises Reviewable<I> beyond
  human review to policy review.

**Anchor refs:** `ai-agent-mastery/sentinel/`, `ai-agent-mastery/sentinel-app/`,
`ai-agent-mastery/LEARNINGS.md`, `ai-agent-mastery/PROGRESS.md`.

---

## codeguard / devshield / scanline / sessionx / migratoor / ruflo (TypeScript)

**What they are:** static-analysis / utility libraries. Linear
`source → analyse → output` pipelines. No durability, no shared retry, no
shared observability.

**Pipeline-kit-relevant patterns:**
- Low-hanging adoption — wrap existing logic in kit's Composer for
  retry / OTel / idempotency.

**Friction (kit-providable):**
- F-RETRY: each project re-rolls retry logic.
- F-OBSERVE: each project re-rolls logging.
- F-CONFIG: each project re-rolls config-loading.
- F-AUTH: each project re-rolls API-key handling for the upstream service it
  wraps.

**Anchor refs:** `codeguard/README.md`, `devshield/README.md`,
`scanline/README.md`, `sessionx/README.md`, `migratoor/README.md`,
`ruflo/README.md`.

---

## mediaflow / falmatic / upwork-intel / operatoros (mixed, lower priority)

**What they are:** older / smaller projects. Spot-check during Phase 0;
deprioritise if unmaintained.

**Why lower priority:**
- mediaflow: older n8n-based work; reference for n8n trigger model only.
- falmatic / falmatic-main: older project; sample for legacy patterns.
- upwork-intel: scraping-focused; overlap with pursuit freelance mode.
- operatoros: small; sample only.

---

## supabase-mcp-gateway / archon / archon-setup / agent-orchestrator (infra-side)

**What they are:** infrastructure / platform projects rather than automation
flows. Sample only if Phase 0 catalog already covers automation projects.

---

## Recurring patterns (preliminary)

After a first read of the constellation, these patterns recur most often:

| Pattern | Frequency | Severity | Cat |
|---------|-----------|----------|-----|
| F-AUTH (every adapter re-rolls credentials) | 10/10 projects | Medium | VIII |
| F-INTEROP (Python ↔ TS divide) | 6/10 projects | High | IX |
| F-CONFIG (every project re-rolls config-loading) | 9/10 projects | Low-Med | VII |
| F-MEMORY (incompatible memory shapes across projects) | 5/10 projects | High | V |
| F-RETRY (every adapter re-rolls retry) | 7/10 projects | Medium | I |
| F-COST (no cost visibility) | 4/10 projects (LLM-using) | High when applies | X |
| F-DURABILITY (long-running not resumable) | 3/10 projects | High when applies | I |
| F-LINEAR (DAGs forced into chains) | 2/10 projects | High when applies | III |
| F-PRIMITIVE (Gate / Aggregate / Trigger missing) | 4/10 projects | Medium | VI |
| F-TRIGGER (no shared trigger model) | 7/10 projects | Low-Med | IV |

**Reading:** F-AUTH and F-CONFIG are the most ubiquitous — every project
touches them. F-INTEROP and F-MEMORY have the highest per-incidence severity.
F-COST and F-DURABILITY apply less often but bite hardest when they do.

**Phase 0 confirmation:** these counts are first-read estimates. Phase 0
deeper reads will adjust.

---

## Beyond the constellation (broader evidence sources)

The constellation is convenient because of file access, but it's a small
sample. Where Phase 0 finds a friction axis under-represented in the 9
projects, supplement with:

- **n8n template gallery** — community-published flow patterns; reveals
  common Source/Process/Serve compositions and trigger shapes.
- **Apify actor marketplace** — published scraping/automation actors;
  reveals adapter ergonomics and config-format patterns.
- **GitHub Actions / GitLab CI marketplaces** — workflow primitives at
  scale; reveals trigger / gate / matrix patterns.
- **LangGraph / LangChain examples** — agent + memory + DAG patterns.
- **Inngest / Trigger.dev / Temporal example libraries** — durable-
  execution patterns at production scale.
- **Automation post-mortems on engineering blogs** — what *broke* in real
  deployments (often the highest-signal source for severity assessment).
- **Awesome-* lists** (awesome-mcp, awesome-langchain, etc.) — surfaces
  patterns at high recall, low precision.

The constellation is the seed; the broader evidence is the validation.

---

*End of constellation observations (seed).*
*Author: Claude (Opus 4.7, 1M ctx) — 2026-05-07.*
*Companion to: research-outline-v1.md.*
*Promoted to: docs/research-friction-catalog.md after Phase 0 deep reads.*
