> Phase 1 research notes — Category III (Source/connector patterns). Back to [research-notes.md](research-notes.md) (synthesis) · [research-notes-full.md](research-notes-full.md) (master).

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

