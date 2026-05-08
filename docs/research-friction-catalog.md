# pipeline-kit — v1 Friction Catalog (Phase 0)

> **Purpose:** Phase 0 output of the v1 research cycle. Per-project pain
> points where pipeline-kit could have provided a shovel primitive. Each
> entry is anchored in concrete file refs, not impressions.
>
> Seed observations live in `research-outline-v1-claude-constellation.md`.
> Canonical entries here are deeper reads. Outline & methodology in
> `research-outline-v1-claude.md` § Phase 0.
>
> **Important framing:** projects below are *example use cases*, not kit
> customers. Every friction tagged is meant to generalise to "anyone,
> anywhere" automating something — kit must not bake in any
> project-specific assumption.
>
> **Author:** Claude (Opus 4.7, 1M ctx) — Phase 0 seed read, 2026-05-08.

---

## Friction tags (recap)

`F-DURABILITY` (Cat I) · `F-AGENT` (Cat II) · `F-LINEAR` (Cat III) ·
`F-TRIGGER` (Cat IV) · `F-MEMORY` (Cat V) · `F-PRIMITIVE` (Cat VI) ·
`F-CONFIG` (Cat VII) · `F-AUTH` (Cat VIII) · `F-INTEROP` (Cat IX) ·
`F-COST` (Cat X) · `F-RETRY` (Cat I) · `F-OBSERVE` (Cat I or VI, TBD).

---

## gatewerk

**What it is:** open-source self-hosted human oversight station for AI
agents. Bun + Express API, React/Vite/Tailwind dashboard, PostgreSQL,
Docker, VPS-deployed. TS-primary with parallel TS + Python SDKs. Apache 2.0.

**Pipeline-kit-relevant patterns observed:**
- Reviewable<I> reference impl: `reviews.create()` with template-defined
  editable fields, three action types (approve / reject / request_changes),
  inline editing flag-driven, timeout + timeout_action.
- Two decision-delivery mechanisms: per-review `callback_url` vs project-
  level webhook subscriptions — same payload shape, different lifecycles.
- HMAC-signed webhook envelope (Cat VIII evidence).
- API-key auth with project-scope (`gw_key_…`) — keys shown once, raw value
  never re-displayable (Cat VIII evidence).
- Multi-framework integration table (LangChain / CrewAI / AutoGen / OpenAI
  Agents / Vercel AI SDK / n8n / MCP-clients / Dify) — framework-neutral
  API surface by design.
- Idempotent migration pipeline (`gatewerk-migrate` one-shot init container
  blocks API start until exit 0; every migration `IF NOT EXISTS`).

**Friction (kit-providable):**
- **F-AUTH-1:** API keys + HMAC webhooks but no rotation semantics
  documented. Kit's `SecretsAdapter` (Cat VIII) should provide pre / mid /
  post-rotation guarantees — gatewerk would adopt.
- **F-INTEROP-1:** TS SDK + Python SDK hand-written twice with subtle
  ergonomic divergence (`createClient` vs `create_client`, error shape
  differs). Kit's Cat IX wire-protocol output would collapse this to a
  single contract with codegen.
- **F-MEMORY-1:** feedback memory shape is gatewerk-specific (suggested vs
  approved field tracking). Kit's `MemoryAdapter` should generalise so
  pursuit's feedback corpus and orchestr8's shared memory speak the same
  contract.
- **F-TRIGGER-1:** `callback_url` vs project webhook = two trigger shapes
  for the same conceptual event. Kit's `Trigger<O>` (Cat IV) should unify.
- **F-PRIMITIVE-1:** review timeout + timeout_action is exactly `Gate<I>`
  with TTL — gatewerk built it bespoke.

**Friction (cross-project):**
- **F-X-1:** gatewerk ↔ kit: `@pipeline-kit/process-reviewable` already
  wraps gatewerk for TS, but Python kit users have no equivalent. Cat IX
  cross-runtime would close the gap; until then, Python pursuit can't reach
  gatewerk through kit.
- **F-X-2:** gatewerk ↔ MCP clients: gatewerk ships its own MCP server
  (`packages/mcp`); kit currently treats MCP as a dumb tool boundary. Cat
  II spike should examine gatewerk's MCP package as a richer-MCP reference.
- **F-X-3:** gatewerk ↔ n8n: gatewerk publishes `packages/n8n-nodes-
  gatewerk` (community node) — cross-engine bridge precedent. Cat IX
  should lift the bridge pattern, not just the wire format.

**Anchor refs:**
- `gatewerk/README.md` lines 1–80 (vision, framework integration table) and
  113–170 (reviews API + dual-language SDK examples).
- `gatewerk/CLAUDE.md` lines 7–17 (monorepo layout: api / web / shared / mcp
  / sdk-ts / sdk-py / n8n-nodes / db) and 39–78 (migration pipeline).
- `gatewerk/packages/sdk-ts/src/{client.ts, http.ts, station.ts}` and
  `gatewerk/packages/sdk-py/gatewerk/` — parallel TS / Python SDK shape
  (F-INTEROP anchor).
- `gatewerk/packages/shared/src/{envelope.ts, ids.ts, errors.ts}` —
  cross-SDK shared types (Cat IX evidence: kit could ship a similar shared
  contract package).

---

## pursuit (v2.3)

**What it is:** unified opportunity-pursuit framework (Python / uv).
3 modes — job_search / freelance / local_business — as configs on a
product-agnostic core. Phase 1 complete (2026-05-06): 2,533-row ATS corpus
+ 1,037-row Upwork corpus, 768-dim pgvector embeddings, Datasette views.

**Pipeline-kit-relevant patterns observed:**
- Source adapter pattern: Apify LinkedIn + Indeed + Upwork adapters with
  per-actor schema normalisation in `agents/research/adapters/`.
- Process<I,O>-shaped extraction: 18-field `JobExtraction` Pydantic schema,
  `mode="before"` truncation/coercion validators (never strict caps that
  reject batches) — saved as `feedback_pydantic_boundary_coercion.md`.
  Maps directly to kit's Zod boundary discipline.
- Provider-pluggable LLM adapter (`agents/tools/llm/openai.py`, 281 lines)
  with three-tier env override (`PURSUIT_UPWORK_OPENAI_MODEL` →
  `PURSUIT_OPENAI_MODEL` → module default). GPT-5-family quirks handled
  per-family (`_default_reasoning_effort_for`).
- Numbered SQL migrations (`0005..0010`) applied as `supabase_admin` with
  `NOTIFY pgrst, 'reload schema'` baked in.
- Cost tracked in markdown STATUS notes (`$0.034 / 30 jobs`).
- Multi-mode pattern: each mode is a config bundle, core is shared.

**Friction (kit-providable):**
- **F-INTEROP-2:** full Python stack — kit unreachable until Cat IX.
- **F-AUTH-2:** six credential surfaces (Supabase service-role + admin role,
  Apify, OpenAI, formerly Anthropic, formerly Gemini); no shared rotation.
- **F-PRIMITIVE-2:** modes = `Branch<I, O[]>` built as if/else routing.
- **F-CONFIG-2:** three hand-rolled YAML shapes (`portfolio_archetype_mapping`,
  `description_keywords`, `qualify_rules`); no shared loader.
- **F-COST-2:** cost tracked in prose, not in code; Cat X meter would close.
- **F-DURABILITY-2:** runs are scripts; VPS-reboot recovery = manual rerun.
- **F-OBSERVE-2:** Datasette is bespoke; kit OTel + replay should compose.

**Friction (cross-project):**
- **F-X-4:** pursuit ↔ gatewerk: Stage 2 `/prep` is Claude Code slash skill
  (subscription, $0/mo), NOT an Anthropic API agent — could route to
  gatewerk Reviewable<I> in TypeScript world, but Python pursuit has no
  ergonomic bridge.
- **F-X-5:** pursuit ↔ orchestr8: pursuit's "durable lessons" live as
  markdown in `~/.claude/projects/.../memory/`, not in orchestr8. Memory
  shapes incompatible.
- **F-X-6:** pursuit ↔ kit: `JobExtraction`'s Pydantic-`mode="before"` is
  exactly kit's Zod-boundary discipline in Python form. Cross-runtime
  schema bridge (Cat IX) would unify.

**Anchor refs:**
- `pursuit-v2.3/README.md` lines 1–29 (modes + quickstart) ·
  `pursuit-v2.3/STATUS.md` (Phase 1 wrap-up).
- `pursuit-v2.3/scripts/{pull_us_jobs.py, qualify_jobs.py,
  qualify_upwork_jobs.py, build_qualified_db.py}` — script-as-pipeline.
- `pursuit-v2.3/agents/qualify/{extract.py, upwork_extract.py,
  upwork_runner.py}` · `agents/tools/llm/openai.py` ·
  `agents/research/adapters/ats_index.py`.

---

## agent-forge (and Apify Studio sub-project)

**What it is:** production AI agent products portfolio (Python).
Architecture: **LangGraph workflows orchestrating Pydantic AI agents**.
Three product phases each implement the same shared framework:
*Research → Qualify → Strategy → Evaluate → Execute → Learn*. Phase 1 (Job
Search Agent) in progress. Sub-project Apify Studio publishes Apify actors
on a separate 8-step lifecycle: research → demand-gate → plan → execute →
validate → deploy → battle-test → marketing → consolidate. 10+ actor /
MCP-server pairs in `actors/` (apify-store-intel, bbb-scraper, etc.).

**Pipeline-kit-relevant patterns observed:**
- **HITL as architecture** — explicit principle: "Research = auto. Analysis =
  auto. Strategy = escalation trigger. External action = approval gate."
  Maps directly to `Reviewable<I>` + `Gate<I>` placement in a DAG.
- **Reusable 6-step framework** shared across products = canonical
  pipeline-kit DAG candidate; agent-forge built it bespoke per product.
- **API/MCP-first** principle: agent backends exposed as both REST APIs
  *and* MCP servers (`bbb-mcp-server`, `clutch-mcp-server`, etc.). Cat II
  evidence (richer-MCP than kit's current dumb-tool boundary).
- **Concrete VPS infra layout** at `100.123.79.63` over Tailscale:
  Langfuse :3000 / Qdrant :6333 / SearXNG :8888 / n8n :5678 / Nous MCP
  :8051. **This is the deployment target reality** for VPS spike work.
- **JSA backlog by epic** (JSA-AO2 / JSA-LL / JSA-RP / JSA-QE) — IMP-NNN
  ticket pattern, ~150+ tickets. Production-ops shape.

**Friction (kit-providable):**
- **F-INTEROP-3:** deep Python stack (LangGraph + Pydantic AI) — kit
  unreachable until Cat IX.
- **F-PRIMITIVE-3:** the 6-step framework + 8-step Studio lifecycle are
  built bespoke; both are kit-DAG-shaped.
- **F-LINEAR-3:** 8-step Studio lifecycle has parallel marketing + consolidate
  — forced linear today.
- **F-DURABILITY-3:** workflow runs span days; VPS-reboot recovery
  undesigned.
- **F-OBSERVE-3:** Langfuse already running on VPS — kit's
  `@pipeline-kit/observe` Langfuse adapter would plug in immediately.
- **F-AUTH-3:** ≥7 credential surfaces (Apify / Supabase / Anthropic /
  Pydantic AI / Tailscale / Nous MCP / Langfuse).

**Friction (cross-project):**
- **F-X-7:** agent-forge Phase 1 ↔ pursuit v2.3 — same Job Search Agent
  in two repos with unclear boundary; pursuit is v2.3 of what agent-forge
  Phase 1 plans to ship. Pattern signal: shared kit-DAG would obviate.
- **F-X-8:** agent-forge ↔ orchestr8: agent-forge has its own session-log
  + memory in markdown / SQL; orchestr8's memory MCP isn't wired.
- **F-X-9:** agent-forge ↔ Nous MCP @ 8051: knowledge-base MCP already
  consumed; kit's Cat II MCP enrichment should examine this pattern.

**Anchor refs:**
- `agent-forge/CLAUDE.md` lines 1–80 (HITL principle, 6-step framework,
  VPS layout) · `agent-forge/STUDIO.md` (8-step Studio lifecycle).
- `agent-forge/STATUS.md` (JSA backlog with 150+ IMP tickets).
- `agent-forge/actors/{apify-store-intelligence, bbb-scraper, bbb-
  mcp-server, clutch-scraper, clutch-mcp-server, ...}` — actor + MCP pair
  pattern.
- `agent-forge/.claude/commands/` (slash-command lifecycle).

---

## orchestr8

**What it is:** agent-coordination MCP server (TypeScript). Five modules
exposing 13 MCP tools: memory (dual-write SQLite + vector) / coordinator
(task analysis + agent scoring + delegation) / router (pattern matching +
outcome recording) / learning (pattern store with promotion lifecycle) /
message-bus (priority deques pub/sub). Published to npm as
`orchestr8-mcp`. 90 tests across 13 suites.

**Pipeline-kit-relevant patterns observed:**
- **Already kit-shaped:** memory queries are Source-like, coordinators are
  Process-like, routers are Serve-like, message-bus is Trigger-like.
  orchestr8 is the candidate **first production kit consumer** once Cat IX
  exists.
- **Dual-write memory** (SQLite structured + vector semantic) is the exact
  shape Cat V should standardise. Reference impl candidate confirmed.
- **6-dimension agent scoring** (capability / load / performance / health /
  availability) — Cat VI Aggregate<I[],O> over heterogeneous agents.
- **Strategy auto-selection** (sequential / parallel / pipeline / fan-out)
  exactly mirrors what kit's Composer must do for DAG composition (Cat III).
- **sql.js (WASM)** choice — pure JS SQLite, no native compile. Useful
  precedent for kit's cross-runtime story (Cat IX).

**Friction (kit-providable):**
- **F-MEMORY-1:** orchestr8 IS the missing reference, but kit's stub never
  adopts it — Cat V spike must wire orchestr8 in.
- **F-PRIMITIVE-4:** strategy selector + agent scorer are Composer-shaped
  but built standalone.
- **F-AUTH-4:** namespace isolation handled internally; no shared rotation.

**Friction (cross-project):**
- **F-X-10:** orchestr8 ↔ gatewerk: gatewerk's feedback memory and
  orchestr8's shared memory are independent — same conceptual axis,
  incompatible shapes.
- **F-X-11:** orchestr8 ↔ devshield: devshield bundles orchestr8 as one of
  its 5 modules — orchestr8 is already a *pack-shaped* deliverable. Cat V
  pack design should lift this packaging precedent.

**Anchor refs:**
- `orchestr8/README.md` lines 80–125 (architecture + key design decisions).
- `orchestr8/src/{memory, coordinator, router, learning, message-bus, mcp}/`
  (5-module folder layout = pack candidate).

---

## cole-obsidian-ai-agent (Paddy)

**What it is:** Obsidian RAG agent (Python, Pydantic AI + FastAPI). Exposes
OpenAI-compatible `/v1/chat/completions` API for Obsidian Copilot plugin.
Stack: PostgreSQL + pgvector, RAG pipeline as background service, Supabase
SDK, SQLAlchemy + Alembic, Pydantic Settings, Vertical Slice Architecture.
3 consolidated tools (Anthropic best practices). MyPy + Pyright + Ruff +
Docker.

**Pipeline-kit-relevant patterns observed:**
- RAG flow as 6-step kit DAG: Source(obsidian / brave) →
  Process(chunk / embed) → Store(pgvector) → Process(retrieve) →
  Process(extract via LLM) → Serve(openai-compat response).
- **Background RAG pipeline as separate service** — vector indexing runs
  in its own service. Cat I durability + Cat IV trigger evidence (chunk +
  embed = scheduled jobs).
- OpenAI-compatible API surface is a Serve adapter shape that kit could
  ship as `@pipeline-kit/serve-openai-compat` (lets any OpenAI-client tool
  consume any kit pipeline).
- Vertical-slice architecture maps cleanly to kit's stage-per-package
  pattern.

**Friction (kit-providable):**
- **F-INTEROP-4:** full Python (Pydantic AI / FastAPI / SQLAlchemy) — Cat
  IX needed.
- **F-DURABILITY-4:** RAG indexing background service has bespoke retry /
  resume; Cat I durable would replace.
- **F-COST-4:** Anthropic + Brave + embeddings — three cost surfaces, no
  kit-level meter.

**Friction (cross-project):**
- **F-X-12:** cole-obsidian ↔ orchestr8: RAG memory (semantic via pgvector)
  vs orchestr8 memory (dual-write) — Cat V must reconcile.
- **F-X-13:** cole-obsidian ↔ context-engineering-hub: both are Cole Medin
  reference designs — RAG-as-product vs PRP-as-method. Kit's Cat VII
  Spec<I> primitive should be informed by both.

**Anchor refs:**
- `cole-obsidian-ai-agent/README.md` lines 1–80 (stack + capabilities).
- `cole-obsidian-ai-agent/{backend_rag_pipeline, app, alembic}/`.

---

## TS-utility cluster (codeguard / devshield / scanline / migratoor)

**What they are:** TypeScript libraries that ship dual as MCP servers and
npm libraries. **codeguard** — context-aware AI code review (25 rules,
zero API calls). **scanline** — security scanning (semgrep wrapper +
SARIF parser + baseline diff + framework-aware ruleset selection).
**migratoor** — SQL migration safety (14 rules from Squawk +
strong_migrations). **devshield** — *meta-bundle* exposing codeguard +
scanline + migratoor + docguard + orchestr8 as one MCP server (5 modules,
17+ tools, one-line install).

**Pipeline-kit-relevant patterns observed:**
- **Library-and-MCP dual surface** — every utility ships both as importable
  library and as MCP server. This is the **kit pack pattern in the wild** —
  proves the shape works.
- **devshield as meta-pack** — bundles five smaller MCP-shaped tools as
  one. Direct precedent for `@pipeline-kit/observe` etc. bundling several
  vendor-implementations.
- All four are linear pipelines (parse → analyse → report). Kit Composer
  wrap would add retry / OTel / idempotency for free.

**Friction (kit-providable):**
- **F-RETRY-1:** each project re-rolls retry logic for its scanner /
  parser invocation.
- **F-OBSERVE-4:** each project re-rolls logging output. Cat I OTel +
  replay would unify.
- **F-CONFIG-3:** each project re-rolls config loading.
- **F-PRIMITIVE-5:** the linear pipeline shape is exactly kit's chain;
  these utilities would gain very little from DAG but a lot from
  cross-cutting concerns.

**Friction (cross-project):**
- **F-X-14:** devshield ↔ kit: devshield IS the proof of pack architecture
  — five tools bundled with consistent contracts. Kit's pack design
  principles should mirror devshield's bundling discipline.

**Anchor refs:**
- `codeguard/README.md` · `scanline/README.md` · `migratoor/README.md` ·
  `devshield/README.md` (the bundle pattern).

---

## ruflo (RuFlo v3.5)

**What it is:** "Enterprise AI Orchestration Platform" — multi-agent swarm
orchestrator for Claude Code. Forked from / sister to claude-flow by ruv.
Architecture: User → Ruflo (CLI/MCP) → Router → Swarm → Agents → Memory →
LLM Providers, with a learning loop. Rust WASM kernels under JS for
policy / embeddings / proofs. 60+ specialized agents, fault-tolerant
consensus, "self-learning" claims.

**Pipeline-kit-relevant patterns observed:**
- **Direct kit-space competitor** — Ruflo is positioned in the same
  multi-agent orchestration territory. Studying its API surface clarifies
  kit's own positioning (kit is library beneath; Ruflo is platform).
- **Rust+JS hybrid** — WASM kernels for hot paths. Cat IX evidence for
  cross-runtime within a single deliverable.
- Router → Swarm → Agents pattern parallels orchestr8's coordinator →
  router → agents.

**Friction (kit-providable):**
- **F-INTEROP-5:** Rust + JS hybrid is Cat IX evidence — kit could ship
  WASM-shaped kernels for hot paths if research surfaces a need.

**Friction (cross-project):**
- **F-X-15:** ruflo ↔ kit: deliberately differentiate — ruflo is the
  *platform* (user-facing); kit is the *library beneath*. v1 spec should
  reference ruflo as a non-overlap example.

**Anchor refs:** `ruflo/README.md` (architecture + WASM kernel notes).

---

## context-engineering-hub

**What it is:** Cole Medin's Dynamous-community Claude Code workflow
framework. Contents: PRP templates / slash-commands / global-rules
(Archon, .cursorrules) / claude-hooks / subagents. Defines "context
engineering" as paradigm shift from prompt engineering — comprehensive
context system (docs + examples + rules + patterns + validation), not
clever phrasing.

**Pipeline-kit-relevant patterns observed:**
- **PRP (Product Requirement Prompt)** — structured spec format = kit's
  Cat VII `Spec<I>` candidate. PRP holds context + requirement +
  validation in one document.
- **Slash-commands as triggers** — Claude Code's slash-command surface =
  Cat IV `Trigger<O>` reference shape.
- **Subagents + hooks as control plane** — already noted in seed but
  hub frames them as *first-class engineering primitives*. Cat VI
  two-plane model should treat hooks as canonical control-plane events.
- **Global rules** (.cursorrules, Archon configs) — kit could ship a
  "shared rule" loader so kit-aware editors auto-pick up project context.

**Friction (kit-providable):**
- **F-CONFIG-4:** PRP format is structured prompt, not yet a kit-spoken
  format. Cat VII spike should test PRP-as-Spec<I> roundtrip.
- **F-PRIMITIVE-6:** Claude Code hooks (PreToolUse / PostToolUse / Stop /
  SessionStart) are exactly the control-plane events kit's two-plane
  model needs to lift.

**Friction (cross-project):** PRP pattern propagates across projects
(agent-forge uses PRDs, pursuit uses briefs, gatewerk uses specs) — all
convergent on the same idea. Kit's `Spec<I>` should unify.

**Anchor refs:**
- `context-engineering-hub/README.md` lines 1–50.
- `context-engineering-hub/{prp-templates, slash-commands, claude-hooks,
  subagents, global-rules}/`.

---

## sessionx + legacy sample (light spot-check only)

**sessionx:** Claude Code session browser TUI (npm CLI). Different shape
from the rest — terminal UI app, not MCP / library / pipeline. Out of
scope for kit primitives. Useful only as evidence that kit must not
*assume* MCP or HTTP — some user glue is purely local CLI.

**Legacy sample (mediaflow / falmatic / upwork-intel / operatoros):**
- **mediaflow / mediaflow-n8n:** older n8n-based work. Reference for n8n
  trigger model only (Cat IV evidence).
- **falmatic / falmatic-main:** older project; sample for legacy
  Source/Process patterns if Phase 0 has time.
- **upwork-intel:** scraping-focused; overlap with pursuit freelance
  mode — same `F-INTEROP` / `F-AUTH` shapes, no new signal.
- **operatoros:** small; sample only.

**Friction (kit-providable):** none new — all already covered by the top
5 projects. Legacy spot-check confirms F-AUTH / F-CONFIG / F-RETRY are
universal across automation projects, regardless of vintage.

---

## Phase 0 progress tracker

```
[x]  gatewerk                ← 2026-05-08
[x]  pursuit (v2.3)          ← 2026-05-08
[x]  agent-forge             ← 2026-05-08
[x]  orchestr8               ← 2026-05-08
[x]  cole-obsidian-ai-agent  ← 2026-05-08
[x]  TS-utility cluster      ← 2026-05-08 (codeguard/devshield/scanline/migratoor)
[x]  ruflo                   ← 2026-05-08 (kit-space competitor; differentiate)
[x]  context-engineering-hub ← 2026-05-08
[x]  sessionx + legacy       ← 2026-05-08 (spot-check only)
```

**All projects catalogued. Phase 0 ready for ranking + brain adjudication.**

---

## Top-15 friction ranking (frequency × severity)

| # | Tag | Cat | Freq | Severity | Notes |
|---|-----|-----|------|----------|-------|
| 1 | F-INTEROP | IX | 5/9 | High | Python in 4/9, hybrid in 1; kit only reaches half the world today |
| 2 | F-AUTH | VIII | 9/9 | Med | Every project re-rolls credentials; rotation never solved |
| 3 | F-PRIMITIVE | VI | 6/9 | Med | Gate / Aggregate / Branch built bespoke everywhere |
| 4 | F-MEMORY | V | 4/9 | High | 4 incompatible shapes (gatewerk feedback / orchestr8 dual / pursuit corpus / cole RAG) |
| 5 | F-OBSERVE | I or VI | 4/9 | Med | OTel + replay would unify Datasette / Langfuse / structured-log shapes |
| 6 | F-CONFIG | VII | 4/9 | Low-Med | YAML / JSON / .env / PRP — no shared loader; PRP candidate Spec<I> |
| 7 | F-DURABILITY | I | 3/9 | High when applies | VPS-reboot recovery undesigned in agent-forge + cole-obsidian + pursuit |
| 8 | F-COST | X | 3/9 | High when applies | Tracked in prose, not in code; budget caps impossible |
| 9 | F-RETRY | I | 6/9 | Med | TS-utility cluster (4) + pursuit + agent-forge — universal pattern |
| 10 | F-TRIGGER | IV | 5/9 | Low-Med | Slash-commands / scripts / webhooks / cron / MCP calls — five shapes |
| 11 | F-LINEAR | III | 2/9 | High when applies | agent-forge 8-step + parallel marketing/consolidate |
| 12 | F-AGENT | II | 3/9 | Med | gatewerk MCP + agent-forge actor+MCP pairs + Nous MCP — three richer-than-tool patterns |
| 13 | F-X-mem | V | 3 | High | orchestr8 ↔ gatewerk ↔ cole-obsidian — memory shapes never reconcile |
| 14 | F-X-pack | VI / pack | 1 | High | devshield IS the pack architecture in the wild — lift its bundling discipline |
| 15 | F-X-langbridge | IX | 4 | High | Python ↔ TS bridge (gatewerk SDKs / pursuit / agent-forge / cole-obsidian); priority for Cat IX |

**Phase 0 headline:** Cat IX (Cross-Runtime) is the **highest-leverage**
research category by evidence weight — without it kit underpins exactly
one shape of automation (TS-only). Cat VIII (Identity/Secrets) is the
most **ubiquitous** — every adapter touches it. Cat V (Memory) has the
highest **per-incidence severity** — three independent memory shapes
exist, none speak each other.

**Recommendations for brain at v1 spec time:**
- Promote Cat IX from "new add" to *first* spike target.
- Promote Cat VIII redaction sub-concern to v1 launch must-have (already
  done in `…-claude-packs.md` §5.3).
- Treat orchestr8 as the assumed `MemoryAdapter` reference impl — Cat V
  spike is wiring, not selection.
- Lift devshield's bundling discipline as the pack architecture model.
- Drop F-LINEAR from urgent list — only 2/9 projects need DAG today; can
  wait for v2 if Cat I + Cat IV land first.

Phase 0 ends when every active project has an entry, recurring patterns are
tagged, top-15 friction items are ranked by frequency × severity, and
brain adjudicates which items deserve a Phase 1 category. Constellation seed
(in `…-constellation.md`) is the starting point; deeper reads here adjust.

---

*v1 Friction Catalog (Phase 0). Updated incrementally as each project is
read. Author: Claude (Opus 4.7, 1M ctx) — 2026-05-08.*
