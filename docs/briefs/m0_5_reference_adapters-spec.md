> NOTE 2026-05-09: kit packages renamed @pipeline-kit/* →
> @idriszade/* in M0.5b. Brief text below is the spec at the time
> of writing — package names there are historical.

# M0.5 — Per-Adapter Signature Spec (15 packages)

> Drilldown for [m0_5_reference_adapters.md](m0_5_reference_adapters.md).
> Section 5 of the M0.5 brief, lifted into its own file because the
> consolidated brief exceeded 1500 lines (per
> `feedback_spec_doc_discipline.md`). 15 adapters per
> `spec-adapters.md` §2 minus #12 (`reviewable-wrapper`, shipped in M0).
>
> **Author:** Brain — 2026-05-07.

---

## Conventions (apply to all 15 unless stated otherwise)

- Each adapter exports a **factory function** `create<Name><Kind>` (e.g.,
  `createApiSource`, `createPostgresStore`, `createExtractProcess`,
  `createEmailServe`) that returns the kit's stage interface
  (`Source<O>` / `Store<T>` / `Process<I, O>` / `Serve<I>`).
- Each adapter embeds a stable `id: pk_<kind-prefix>_<name>`; e.g.,
  `pk_src_api`, `pk_store_postgres`, `pk_proc_extract`, `pk_serve_email`.
- Each adapter validates its config via Zod `.safeParse` at construction;
  invalid config returns a thrown `Error` (construction-time, not
  cross-stage; per ADR4, only stage-method returns are Result-shaped).
- Each adapter implements its retry policy via a `retryPolicy?:
  Partial<RetryPolicy>` field on construction config — defaults inherit
  from Composer (per ADR13).
- Each adapter implements rate-limit via `rateLimit?: TokenBucketConfig`
  (Source/Serve only; per ADR10).
- Each adapter ships a minimal `README.md` (~10-15 lines: what-it-is +
  install line + 1-block quickstart + link to `docs/spec.md`).
- Each adapter's `package.json` carries `"description"` for npm display
  and `"keywords": ["pipeline-kit", "<kind>", ...]`.

Each subsection: Path / Public exports / Config schema / Behavior /
Tests / ADR anchors.

---

## Source (4 adapters)

### 1 — `@pipeline-kit/source-api` (REST/GraphQL with cursor)

- **Path:** `packages/source-api/`
- **Public exports:** `createApiSource`, `ApiSourceConfig`,
  `ApiSourceError`.
- **Config schema:**

```typescript
ApiSourceConfig<O> = {
  id?: string;                          // default: pk_src_api_<ulid>
  baseUrl: string;
  endpoint: string;                     // path appended to baseUrl
  method?: 'GET' | 'POST';              // default 'GET'
  auth?:
    | { type: 'bearer'; value: string }
    | { type: 'apiKey'; header: string; value: string }
    | { type: 'basic'; user: string; password: string }
    | { type: 'none' };
  paginate?:
    | { type: 'cursor'; cursorField: string; cursorParam: string }
    | { type: 'offset'; pageSize: number; offsetParam: string }
    | { type: 'page'; pageSize: number; pageParam: string }
    | { type: 'none' };
  schema: ZodSchema<O>;                 // validates each emitted atom's data
  responseShape?: 'array' | 'wrapped';  // default 'array'; 'wrapped' = { items: O[], next_cursor? }
  responsePath?: string;                // dot-path to items array if wrapped non-canonical
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucketConfig;
};
```

- **Behavior:**
  - `iter(query, ctx)`: yields atoms one at a time. For paginated
    sources, fetches page-by-page; advances cursor; emits each item
    individually. Honors `Retry-After` via Composer's RetryPolicy
    (`type: 'rate_limited'` triggers respect).
  - `fetch(query, ctx)`: collects all items across all pages into a
    single `Atom<O>[]`. Same pagination logic as `iter`, just
    array-wrapped at the end.
  - HTTP errors mapped to `SourceError`: 401/403 → `auth`; 429 →
    `rate_limited`; 5xx → `transient`; 4xx other → `validation`;
    network → `network`.
  - **SSRF check** if `baseUrl` is user-supplied (config from runtime,
    not compile-time): private-IP block; DNS resolution validation.
    For library-time-bound `baseUrl` (in code), skip the check.

- **Tests** (`packages/source-api/tests/`):
  - `api-source.test.ts` — 6 cases: GET success, POST success, bearer
    auth, apiKey auth, 401 → `auth`, 429 → `rate_limited`.
  - `pagination.test.ts` — 4 cases: cursor pagination (3 pages), offset,
    page, no-pagination.
  - `iter-vs-fetch.property.test.ts` — fast-check: for arbitrary
    paginated mock, `iter` and `fetch` produce same atom data.

- **ADR anchors:** ADR2 (pull default), ADR6 (Zod boundary), ADR7
  (iter+fetch), ADR10 (rate-limit), ADR13 (retry policy).

### 2 — `@pipeline-kit/source-webhook` (Hono-backed HMAC intake)

- **Path:** `packages/source-webhook/`
- **Public exports:** `createWebhookSource`, `WebhookSourceConfig`,
  `WebhookHandler`.
- **Config schema:**

```typescript
WebhookSourceConfig<O> = {
  id?: string;
  path: string;                         // e.g., '/webhooks/stripe'
  secret: string;
  schema: ZodSchema<O>;
  verify?: {
    tolerance?: number;                 // ms; default 300_000 (5 min)
    acceptedAlgorithms?: ('v1' | 'v2')[];  // default ['v1']
    headerName?: string;                // default 'X-Pipeline-Kit-Signature'
  };
  idempotencyHeader?: string;           // e.g., 'X-Webhook-Id'; passes to ctx
  ssrf?: { enabled: boolean };          // default true if any callback URL handling
  retryPolicy?: Partial<RetryPolicy>;
};
```

- **Public exports also include:** `app: Hono` (when constructed with
  `createWebhookSource`, the source exposes a `.app` property with the
  Hono instance pre-wired); `handler: (req: Request) => Promise<Response>`
  (raw web-standards handler for non-Hono runtimes).

- **Behavior:**
  - Hono `app.post(config.path, ...)` registers the route; on POST,
    reads raw body, calls `pk.webhooks.verify(rawBody, sigHeader,
    secret, options)`; on success, parses body via `config.schema.safeParse`,
    emits as `Atom<O>` to a buffer.
  - `iter(query, ctx)` yields buffered atoms as they arrive (async
    iteration over an internal queue; respects `ctx.signal`).
  - `fetch(query, ctx)` returns currently-buffered atoms as
    `Atom<O>[]`; non-blocking.
  - Verification failure → 400 response + buffer NOT updated; error
    type `validation` / `auth` per failure mode.
  - Idempotency: `X-Webhook-Id` (or configured header) propagates to
    `Atom.metadata.idempotency_key`.

- **Tests** (`packages/source-webhook/tests/`):
  - `webhook-source.test.ts` — 5 cases: valid signature → atom buffered;
    invalid signature → 400; expired timestamp → 400; missing header →
    400; valid + parsing failure → 400 with `validation` error.
  - `hono-integration.test.ts` — 2 cases: app.fetch() with mock Request;
    handler() raw call.
  - `iter-buffer.test.ts` — atoms buffered while iter is awaiting;
    cancellation aborts iter.

- **ADR anchors:** ADR2 (push exception), ADR6 (Zod), ADR17 (HMAC),
  ADR21 (single-header canon).

### 3 — `@pipeline-kit/source-apify` (Apify actor wrapper)

- **Path:** `packages/source-apify/`
- **Public exports:** `createApifySource`, `ApifySourceConfig`.
- **Config schema:**

```typescript
ApifySourceConfig<O> = {
  id?: string;
  actorId: string;                      // e.g., 'apify/web-scraper'
  input: Record<string, unknown>;       // actor-specific input
  schema: ZodSchema<O>;                 // validates each dataset item
  datasetMode?: 'append' | 'reset';     // default 'append'
  apifyToken: string;                   // or APIFY_TOKEN env
  pollIntervalMs?: number;              // default 5_000
  maxWaitMs?: number;                   // default 300_000 (5 min)
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucketConfig;
};
```

- **Behavior:**
  - `iter(query, ctx)`: launches actor via `apify-client`; polls run
    status; once `SUCCEEDED`, paginates dataset (default page 1000);
    emits each item as `Atom<O>` after `schema.safeParse`. Respects
    `ctx.signal` between polls.
  - `fetch(query, ctx)`: same flow; collects all dataset items into
    `Atom<O>[]`.
  - Run failures: `FAILED` / `TIMED-OUT` / `ABORTED` → `SourceError`
    with `type: 'transient' | 'unavailable'` per status mapping.
  - Schema validation failure on a dataset item: emit
    `error: { type: 'validation', code: 'apify_item_invalid', metadata:
    { item_index, parse_error } }` and skip that item; continue
    iteration. (Per `feedback_pydantic_boundary_coercion.md` — coerce
    when possible, skip when not, never panic.)

- **Tests** (`packages/source-apify/tests/`):
  - `apify-source.test.ts` — 5 cases with mocked apify-client: SUCCEEDED
    + dataset; FAILED status; TIMED-OUT; schema validation skips bad
    item, continues; cancellation mid-poll.
  - `pagination.test.ts` — dataset with 2500 items pages through 1000-
    item batches.

- **ADR anchors:** ADR2 (pull), ADR6 (Zod), ADR7 (iter+fetch), ADR20
  (pursuit MCP bridge composability).

### 4 — `@pipeline-kit/source-mcp` (generic MCP tool wrapper)

- **Path:** `packages/source-mcp/`
- **Public exports:** `createMcpToolSource`, `McpToolSourceConfig`.
- **Config schema:**

```typescript
McpToolSourceConfig<O> = {
  id?: string;
  serverUrl: string;                    // MCP server endpoint
  toolName: string;
  args: Record<string, unknown>;
  schema?: ZodSchema<O>;                // optional; auto-derived from MCP tool's outputSchema if absent
  expectArray?: boolean;                // default false (single-atom emit); true → unpack array result
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucketConfig;
};
```

- **Behavior:**
  - On construction: connects to MCP server; fetches tool definition;
    if `config.schema` absent, **attempts** to derive Zod from MCP
    tool's `outputSchema` (JSON Schema → Zod via simple shape detect;
    document failure modes — fall back to `z.unknown()` if conversion
    fails and surface a warning).
  - `iter(query, ctx)`: invokes tool with `args` (merged with `query`
    if any); receives result. If `expectArray`, unpacks each item as
    a separate atom; else single atom.
  - `fetch(query, ctx)`: same; array-wrapped output.
  - Errors: MCP transport failure → `transient`; tool error →
    `validation` (per MCP `isError: true` response shape); auth →
    `auth`.

- **Tests** (`packages/source-mcp/tests/`):
  - `mcp-source.test.ts` — 6 cases with mocked MCP server: tool call
    success single-atom; tool call success multi-atom array;
    `expectArray=false` returns first item only (with metadata noting
    truncation); MCP isError → `validation`; transport timeout →
    `transient`; cancellation mid-call.
  - `schema-derive.test.ts` — 3 cases: derived from JSON Schema with
    object shape; derived with unknown fallback; user-provided schema
    wins over derived.

- **ADR anchors:** ADR6 (Zod), ADR7 (iter+fetch), ADR20 (MCP server-
  namespacing implicit).

---

## Store (3 adapters)

### 5 — `@pipeline-kit/store-postgres` (Drizzle Postgres)

- **Path:** `packages/store-postgres/`
- **Public exports:** `createPostgresStore`, `PostgresStoreConfig`,
  `defineAtomTable` (Drizzle table-builder helper).
- **Config schema:**

```typescript
PostgresStoreConfig<T, TTable extends PgTable> = {
  id?: string;
  connectionString: string;             // or PG_CONNECTION env
  table: TTable;                        // Drizzle table for atom data
  schema: ZodSchema<T>;                 // validates atom.data
  idempotencyTable?: PgTable;           // if absent, idempotency cache disabled (per ADR9 — kit doesn't ship cache)
  idempotencyTtlMs?: number;            // default 86_400_000 (24h)
  retryPolicy?: Partial<RetryPolicy>;
};
```

`defineAtomTable(name)` is a helper that returns a Drizzle PgTable
matching the canonical Atom shape (`id text primary key, object text,
created_at timestamptz, metadata jsonb, data jsonb, source_id text,
stage_id text, run_id text`). Users wanting custom shape define their
own table conforming to Drizzle's PgTable — kit auto-derives Zod
insert/select via `drizzle-zod` if user hasn't provided.

- **Behavior:**
  - `put(atom, ctx)`: upserts on `id`. If `idempotencyTable` configured
    and `ctx.idempotencyKey` present, opens transaction: SELECT cached
    response by key → return cached on hit; else INSERT atom + UPSERT
    cache; commit. On hit, return cached atom (no re-write).
  - `get(id, ctx)`: SELECT by id; null on miss.
  - `list(filters, ctx)`: parametrized SQL with ORDER BY created_at
    DESC, LIMIT/OFFSET cursor.
  - Errors mapped: connection refused → `transient`; constraint violation
    → `validation`; timeout → `timeout`.
  - **Migrations:** ships `migrations/0001_init.sql` for the canonical
    atom + idempotency cache tables; `drizzle-kit migrate` documented in
    README; never `push` in prod (per ADR11 + spec-build-plan §5 #13).

- **Tests** (`packages/store-postgres/tests/`):
  - Integration tests use `pg-mem` in-memory PG (or testcontainers if
    pg-mem doesn't cover pgvector — but plain PG should work with pg-mem).
    If `[skip-ci]` flagging needed for live PG, follow spec-build-plan
    §3 pattern.
  - `postgres-store.test.ts` — 6 cases: put + get round-trip; list with
    cursor; idempotency cache hit; idempotency cache miss; constraint
    violation → `validation`; connection failure → `transient`.
  - `migrations.test.ts` — 2 cases: 0001_init applies cleanly; idempotent
    on re-apply.
  - `round-trip.property.test.ts` — fast-check: `put(atom).then(get) ===
    atom` for arbitrary atom data.

- **ADR anchors:** ADR4 (Result), ADR6 (Zod via drizzle-zod), ADR9
  (idempotency mandatory), ADR11 (Drizzle).

### 6 — `@pipeline-kit/store-sqlite` (Drizzle SQLite)

- **Path:** `packages/store-sqlite/`
- **Public exports:** `createSqliteStore`, `createSqliteStoreForBun`,
  `SqliteStoreConfig`, `defineAtomTable`.
- **Config schema:**

```typescript
SqliteStoreConfig<T, TTable> = {
  id?: string;
  path: string;                         // file path or ':memory:'
  table: TTable;
  schema: ZodSchema<T>;
  idempotencyTable?: SqliteTable;
  idempotencyTtlMs?: number;            // default 86_400_000
  retryPolicy?: Partial<RetryPolicy>;
};
```

- **Behavior:**
  - Same semantics as `store-postgres` (put/get/list/idempotency).
  - `createSqliteStore` uses `drizzle-orm/better-sqlite3` (Node).
  - `createSqliteStoreForBun` uses `drizzle-orm/bun-sqlite` (no extra
    install; Bun-native).
  - `:memory:` mode for tests; persistent file for dev/edge.

- **Tests** (`packages/store-sqlite/tests/`):
  - `sqlite-store.test.ts` — 5 cases mirroring postgres-store basic cases
    against `:memory:`.
  - `bun-mode.test.ts` — 2 cases: bun runtime check (skipped on Node);
    factory differences. Marked with vitest `skip` if not on Bun.
  - `round-trip.property.test.ts` — same property as postgres-store.

- **ADR anchors:** Same as store-postgres.

### 7 — `@pipeline-kit/store-pgvector` (pgvector embeddings)

- **Path:** `packages/store-pgvector/`
- **Public exports:** `createPgvectorStore`, `PgvectorStoreConfig`,
  `pgvectorColumn`, `defineEmbeddingTable`.
- **Config schema:**

```typescript
PgvectorStoreConfig<T, TTable> = {
  id?: string;
  connectionString: string;
  table: TTable;                        // includes vector column via pgvectorColumn(dim)
  dimension: number;
  distance: 'cosine' | 'l2' | 'inner_product';
  indexType?: 'hnsw' | 'ivfflat';       // default 'hnsw'
  schema: ZodSchema<T>;
  retryPolicy?: Partial<RetryPolicy>;
};
```

`pgvectorColumn(dim)` returns a Drizzle custom-type column expressing
`vector(<dim>)`; helper exposes ~30 lines of Drizzle custom-type code.
`defineEmbeddingTable(name, dim)` returns a Drizzle PgTable with atom
shape + vector column + appropriate index.

- **Behavior:**
  - `put(atomWithEmbedding, ctx)`: stores atom + vector; idempotency
    via atom id + per-stage hash.
  - `get(id, ctx)`: SELECT by id; returns `Atom<T> & { embedding:
    Float32Array | null }`.
  - `list(filters, ctx)`: standard cursor pagination by created_at.
  - `search(embedding, k, filters?, ctx)`: KNN query with `<distance>`
    operator (`<=>` cosine, `<->` l2, `<#>` inner-product); returns
    `Atom<T>[]` ordered by similarity. **NEW method beyond Store<T>
    surface** — exposed as `pgvectorStore.search(...)`, not part of
    Store<T> interface; users access via concrete type.
  - Errors: `pgvector` extension absent → `validation` with
    `code: 'pgvector_extension_missing'` + clear remediation in
    error.message.

- **Tests** (`packages/store-pgvector/tests/`):
  - Integration tests gated on PG with pgvector; if testcontainer
    available, use it; else `[skip-ci]` tag and run locally.
  - `pgvector-store.test.ts` — 5 cases: put + get with embedding;
    search with cosine returns nearest; search with l2; missing
    extension error; index type fallback to ivfflat.
  - `custom-type.test.ts` — 3 cases: pgvectorColumn(384) round-trips
    a Float32Array; binary serialization; dimension mismatch rejected.

- **ADR anchors:** ADR6 (Zod boundary), ADR9 (idempotency), ADR11
  (Drizzle custom-type), ADR20 (pursuit pgvector bridge).

---

## Process (4 adapters)

### 8 — `@pipeline-kit/process-extract` (LLM extraction)

- **Path:** `packages/process-extract/`
- **Public exports:** `createExtractProcess`, `ExtractProcessConfig`,
  `ExtractError`.
- **Config schema:**

```typescript
ExtractProcessConfig<I, O> = {
  id?: string;
  provider: 'openai' | 'anthropic' | 'gemini';   // 'router' deferred to v1 (see OQ)
  model: string;                        // e.g., 'gpt-4o', 'claude-sonnet-4-6'
  prompt: string | ((input: I) => string);
  inputSchema?: ZodSchema<I>;
  outputSchema: ZodSchema<O>;
  apiKey?: string;                      // env fallback per provider
  temperature?: number;
  maxRetriesOnSchemaFailure?: number;   // default 2
  systemPrompt?: string;
  retryPolicy?: Partial<RetryPolicy>;
};
```

- **Behavior:**
  - `run(input, ctx)`: builds prompt; converts `outputSchema` to JSON
    Schema via `zod-to-json-schema`; sends structured-output request
    to provider; parses response with `outputSchema.safeParse` (coerce
    mode — `.catch()` per field where defined by user).
  - On schema-parse failure, retry **once** with feedback-in-prompt
    ("your last response failed schema validation: <error>; please
    output JSON matching this schema: <jsonschema>"), up to
    `maxRetriesOnSchemaFailure`. Per pursuit's Cat-VI Pydantic AI
    pattern.
  - Provider SDK loaded via dynamic `import()` gated on
    `config.provider`; missing peerDep → `error.code:
    'provider_not_installed'` (per Section 4 critical clarification).
  - **OTel emission** per ADR8: span name `pipeline.process.extract`;
    attributes `gen_ai.system` (= provider), `gen_ai.request.model` (=
    model), `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
    `gen_ai.response.finish_reasons`. Cost-tracking auto-ingests via
    Langfuse / Honeycomb.
  - Errors: rate-limit from provider → `rate_limited`; auth → `auth`;
    schema parse exhausted retries → `validation` with last parse
    error in metadata.

- **Tests** (`packages/process-extract/tests/`):
  - `extract-openai.test.ts` — 4 cases with mocked OpenAI client:
    structured output success; schema retry on first-pass failure +
    success on second; schema retry exhausted → `validation`; rate
    limit → `rate_limited`.
  - `extract-anthropic.test.ts` — 3 cases with mocked Anthropic.
  - `extract-gemini.test.ts` — 3 cases with mocked Gemini.
  - `provider-not-installed.test.ts` — 1 case: dynamic import fails →
    construction OK but first run errors with `provider_not_installed`.
  - `otel-attributes.test.ts` — 1 case: span emitted with all 5
    `gen_ai.*` attributes set.

- **ADR anchors:** ADR4 (Result), ADR6 (Zod boundary), ADR8 (OTel
  Gen AI conventions), ADR13 (retry).

### 9 — `@pipeline-kit/process-classify` (rules or LLM)

- **Path:** `packages/process-classify/`
- **Public exports:** `createClassifyProcess`, `ClassifyProcessConfig`,
  `ClassifyRule`.
- **Config schema:**

```typescript
ClassifyRule = {
  field: string;                        // dot-path on input
  match: 'equals' | 'contains' | 'regex' | 'gt' | 'lt';
  value: unknown;
  category: string;
  priority?: number;                    // higher wins; default 0
};

ClassifyProcessConfig<I> = {
  id?: string;
  mode: 'rules' | 'llm';
  categories: ReadonlyArray<string>;
  rules?: ClassifyRule[];               // required if mode='rules'
  defaultCategory?: string;             // when no rule matches
  llm?: {                               // required if mode='llm'
    extract: ReturnType<typeof createExtractProcess>;  // pre-built extract process
  };
  retryPolicy?: Partial<RetryPolicy>;
};
```

- **Behavior:**
  - `run(input, ctx)`: in `rules` mode, evaluates each rule against
    `input` (dot-path resolution); first match (by priority desc)
    wins; falls back to `defaultCategory` or `error.code:
    'classify_no_match'`.
  - In `llm` mode, calls `config.llm.extract.run(input, ctx)` with
    `outputSchema = z.object({ category: z.enum(categories) })` —
    underlying `extract-process` handles LLM call + schema parse.
  - Output: `{ category: string; matchedRule?: ClassifyRule }`.

- **Tests** (`packages/process-classify/tests/`):
  - `rules-mode.test.ts` — 5 cases: equals match; contains match; regex
    match; priority resolution; no match → defaultCategory.
  - `llm-mode.test.ts` — 2 cases: LLM mode delegates to extract; bad
    enum value re-prompts via extract retry.
  - `unsupported-mode.test.ts` — 1 case: mode='llm' without
    config.llm.extract → construction error.

- **ADR anchors:** ADR4 (Result), ADR12 (composition with extract).

### 10 — `@pipeline-kit/process-validate` (Zod boundary coercion)

- **Path:** `packages/process-validate/`
- **Public exports:** `createValidateProcess`, `ValidateProcessConfig`.
- **Config schema:**

```typescript
ValidateProcessConfig<I> = {
  id?: string;
  schema: ZodSchema<I>;
  mode?: 'coerce' | 'strict';           // default 'coerce'
  onCoerce?: (path: string, original: unknown, fallback: unknown) => void;
  retryPolicy?: Partial<RetryPolicy>;
};
```

- **Behavior:**
  - `run(input, ctx)`: `schema.safeParse(input)`. In `coerce` mode,
    schema is expected to use `.catch(default)` per field; failures at
    fields without `.catch` raise OTel warning span (`onCoerce` callback
    fires) and the field gets `null`. Output type matches `I` after
    coerce.
  - In `strict` mode, first failure → `error: { type: 'validation',
    code: 'schema_parse_failed', metadata: { issues } }`.
  - Per pursuit `feedback_pydantic_boundary_coercion.md`: coerce mode
    is the default at LLM/external boundary; strict is for internal
    invariant guards.

- **Tests** (`packages/process-validate/tests/`):
  - `validate.test.ts` — 6 cases: strict success; strict failure;
    coerce with fallback; coerce + onCoerce callback fires; nested
    schema; transformed schema.
  - `coerce.property.test.ts` — fast-check: for arbitrary input +
    schema-with-catch, coerce always succeeds.

- **ADR anchors:** ADR4 (Result), ADR6 (Zod).

### 11 — `@pipeline-kit/process-route` (single-priority routing)

- **Path:** `packages/process-route/`
- **Public exports:** `createRouteProcess`, `RouteProcessConfig`.
- **Config schema:**

```typescript
RouteProcessConfig<I, O> = {
  id?: string;
  predicate: (input: I, ctx: PipelineContext) => string | Promise<string>;
  branches: Record<string, Process<I, O>>;
  defaultBranch?: string;               // for no-match
  retryPolicy?: Partial<RetryPolicy>;
};
```

- **Behavior:**
  - `run(input, ctx)`: awaits `predicate(input, ctx)`; selects branch
    by name; delegates `run`. If branch not found, uses
    `defaultBranch` if set, else `error.code: 'route_no_branch'`.
  - v0 single-priority only — predicate returns one branch name. v1
    adds stakes/confidence/priority unification per ADR-C (deferred).

- **Tests** (`packages/process-route/tests/`):
  - `route.test.ts` — 4 cases: branch hit; default branch; no branch +
    no default → error; predicate throws → wrapped to error.
  - `composition.test.ts` — 1 case: branches themselves can be Process
    composites.

- **ADR anchors:** ADR4 (Result), ADR12 (Process composition); v1
  ADR-C deferred.

---

## Serve (4 adapters)

### 12 — `@pipeline-kit/serve-email` (SMTP / Postal / Resend)

- **Path:** `packages/serve-email/`
- **Public exports:** `createEmailServe`, `EmailServeConfig`,
  `EmailMessage`.
- **Config schema:**

```typescript
EmailServeConfig =
  | { provider: 'smtp'; smtp: SmtpConfig; from: string; idempotencyHeader?: string }
  | { provider: 'postal'; postal: PostalConfig; from: string; idempotencyHeader?: string }
  | { provider: 'resend'; resend: ResendConfig; from: string; idempotencyHeader?: string };

EmailMessage = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string(),
  html: z.string().optional(),
  text: z.string().optional(),
  cc: z.array(z.string().email()).optional(),
  attachments: z.array(z.object({ filename: z.string(), content: z.string() })).optional(),
});
```

- **Behavior:**
  - `idempotencySupport: 'required'`.
  - `emit(input, ctx)`: validates `input` against `EmailMessage`; calls
    provider-specific send. Provider SDK loaded dynamically; missing
    peerDep → `provider_not_installed`.
  - SMTP: nodemailer transport; per-message-id derived from
    `ctx.idempotencyKey` (`Message-ID: <{key}@<from-domain>>`); SMTP
    server-side dedup if supported.
  - Postal: HTTP POST to Postal API; idempotency-key header.
  - Resend: SDK call; Resend supports idempotency-key header natively.
  - Errors: provider auth → `auth`; rate-limit → `rate_limited`;
    transient → `transient`.

- **Tests** (`packages/serve-email/tests/`):
  - `smtp-mode.test.ts` — 4 cases with mocked nodemailer transport:
    successful send; auth failure; rate-limit; idempotency-key in
    Message-ID.
  - `postal-mode.test.ts` — 3 cases with `fetch` mock: success;
    422-validation; idempotency header.
  - `resend-mode.test.ts` — 3 cases with mocked Resend client: success;
    idempotency; rate-limit.
  - `provider-not-installed.test.ts` — 1 case per missing provider SDK.

- **ADR anchors:** ADR4 (Result), ADR6 (Zod), ADR9 (idempotency
  required).

### 13 — `@pipeline-kit/serve-slack` (chat.postMessage + idempotency cache)

- **Path:** `packages/serve-slack/`
- **Public exports:** `createSlackServe`, `SlackServeConfig`,
  `SlackMessage`.
- **Config schema:**

```typescript
SlackServeConfig = {
  id?: string;
  token: string;                        // or SLACK_BOT_TOKEN env
  channel: string;
  idempotencyCache?: Store<{ ts: string; channel: string }>;  // user-supplied; if absent, dedup is best-effort by client_msg_id
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucketConfig;
};

SlackMessage = z.object({
  text: z.string(),
  blocks: z.array(z.unknown()).optional(),
  thread_ts: z.string().optional(),
  unfurl_links: z.boolean().default(false),
  unfurl_media: z.boolean().default(false),
});
```

- **Behavior:**
  - `idempotencySupport: 'optional'` (Slack has no native idempotency
    header — kit-side cache is required for `'required'` semantics;
    declare `optional` and let users wire `idempotencyCache` for
    full guarantees).
  - `emit(input, ctx)`: derives Slack `client_msg_id` from
    `ctx.idempotencyKey` (UUIDv4 shape, decoded from idempotencyKey
    via SHA-256 truncate-to-128bit). On `idempotencyCache` hit, return
    cached `{ ts, channel }` without re-posting. Else
    `chat.postMessage`; on success, cache `(ctx.idempotencyKey, { ts,
    channel })`.
  - Errors: `invalid_auth` → `auth`; `rate_limited` → `rate_limited`;
    transient → `transient`.

- **Tests** (`packages/serve-slack/tests/`):
  - `slack-serve.test.ts` — 6 cases with mocked `@slack/web-api`:
    postMessage success; idempotency cache hit short-circuits;
    idempotency cache miss writes; rate-limit; auth failure; thread
    posting.
  - `idempotency-cache.test.ts` — 2 cases with sqlite-store as cache:
    real cache works; cache TTL respected.

- **ADR anchors:** ADR4 (Result), ADR6 (Zod), ADR9 (idempotency
  optional with Store-backed cache for required semantics), ADR10
  (rate-limit; Slack is rate-strict).

### 14 — `@pipeline-kit/serve-webhook` (outbound HMAC webhook)

- **Path:** `packages/serve-webhook/`
- **Public exports:** `createWebhookServe`, `WebhookServeConfig`,
  `WebhookPayload`.
- **Config schema:**

```typescript
WebhookServeConfig<I> = {
  id?: string;
  url: string;
  secret?: string;                      // required if auth='hmac'
  auth?: 'hmac' | 'basic' | 'bearer' | 'apiKey' | 'none';   // default 'hmac'
  authValue?: string;
  headerName?: string;                  // default 'X-Pipeline-Kit-Signature'
  idempotencyHeader?: string;           // default 'X-Webhook-Id'
  schema: ZodSchema<I>;
  ssrf?: { enabled: boolean };          // default true if url is template/dynamic
  retryPolicy?: Partial<RetryPolicy>;
  rateLimit?: TokenBucketConfig;
};
```

- **Behavior:**
  - `idempotencySupport: 'required'`.
  - `emit(input, ctx)`: validates `input` via `schema`; serializes to
    JSON; calls `pk.webhooks.sign(body, secret, opts)` (when
    `auth='hmac'`); POSTs with auth + idempotency headers.
  - SSRF: if `ssrf.enabled`, validates `url`'s host is not private/
    loopback before POST.
  - Errors: 4xx → `validation` (except 401/403 → `auth`, 429 →
    `rate_limited`); 5xx → `transient`; network → `network`.

- **Tests** (`packages/serve-webhook/tests/`):
  - `webhook-serve.test.ts` — 6 cases with `fetch` mock: HMAC sign +
    POST success; bearer auth; basic auth; 5xx → `transient`; 401 →
    `auth`; 429 → `rate_limited`.
  - `ssrf.test.ts` — 3 cases: private IP rejected; loopback rejected;
    public IP accepted.
  - `roundtrip.property.test.ts` — fast-check: signed body verifies
    via `pk.webhooks.verify` round-trip.

- **ADR anchors:** ADR4 (Result), ADR9 (idempotency), ADR17 (HMAC),
  ADR21 (single-header).

### 15 — `@pipeline-kit/serve-mcp` (expose pipeline as MCP tool)

- **Path:** `packages/serve-mcp/`
- **Public exports:** `createMcpToolServe`, `McpToolServeConfig`.
- **Config schema:**

```typescript
McpToolServeConfig<I, O> = {
  id?: string;
  toolName: string;
  description: string;
  inputSchema: ZodSchema<I>;
  outputSchema: ZodSchema<O>;           // typically RunResult<O>
  pipeline: TerminalPipeline<O>;
  retryPolicy?: Partial<RetryPolicy>;
};
```

- **Behavior:**
  - `idempotencySupport: 'unsupported'` (MCP tool calls don't carry
    idempotency keys — and pipeline-kit-as-MCP-server is library-only
    per ADR22; durable runtime is user's concern).
  - `emit(input, ctx)`: invokes `config.pipeline.run(input, ...)` and
    returns `RunResult<O>` to MCP server-side handler.
  - Adapter exposes a `mcp.tool` registration object via
    `serve.toolRegistration` getter — users wire it into their MCP
    server (`server.setRequestHandler('tools/list', ...)`).
  - JSON Schema auto-generated from `inputSchema` + `outputSchema`
    via `zod-to-json-schema` (per ADR20 + spec-adapters #16).

- **Tests** (`packages/serve-mcp/tests/`):
  - `mcp-serve.test.ts` — 5 cases with mocked MCP server: tool
    registration shape; tool invocation success; tool invocation with
    pipeline error; schema validation rejects bad input; auto-derived
    JSON schema.
  - `pipeline-integration.test.ts` — 1 case: end-to-end with a 1-stage
    Pipeline.

- **ADR anchors:** ADR6 (Zod), ADR20 (MCP), ADR22 (library not
  runtime — adapter exposes registration; doesn't host server).

---

*End of M0.5 per-adapter signature spec. See
[m0_5_reference_adapters.md](m0_5_reference_adapters.md) for the entry
brief — Sections 0-4 + 6-11.*
