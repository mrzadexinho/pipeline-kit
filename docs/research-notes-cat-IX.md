> Phase 1 research notes — Category IX (Marketplace + community references). Back to [research-notes.md](research-notes.md) (synthesis) · [research-notes-full.md](research-notes-full.md) (master).

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

