# pipeline-kit — Phase 2 Spec — §2 Reference Adapter List (v0)

> Drilldown for [spec.md](spec.md). 16 reference adapters per outline §11 v0.
> Each gets a 1-paragraph signature spec covering package name, config
> shape, behavior, dependencies, and ADR anchors. All adapters are
> individually publishable as scoped npm packages
> (`@pipeline-kit/source-api`, etc.) but ship in the v0 monorepo for
> testing cohesion.
>
> **Author:** Brain — 2026-05-06.

---

## Source (4 adapters)

### 1. `api-source` — REST/GraphQL with cursor pagination + auth

- **Package:** `@pipeline-kit/source-api`.
- **Config:** `{ baseUrl, auth: { type: 'bearer'|'apiKey'|'basic', value }, paginate: 'cursor'|'offset'|'page', schema: ZodSchema<O> }`.
- **Cursor support:** generic via `cursor` param; adapter declares cursor
  field (e.g., `next_cursor`, `next_page_token`).
- **Retry:** default `RetryPolicy` (ADR13); `rate_limited` errors retry with
  `Retry-After` respected.
- **Reference deps:** native `fetch`, `zod`.

### 2. `webhook-source` — incoming webhook intake with HMAC verify (Hono-backed)

- **Package:** `@pipeline-kit/source-webhook`.
- **Config:** `{ path, secret, schema: ZodSchema<O>, verify: { tolerance, acceptedAlgorithms }, idempotencyHeader: 'X-Webhook-Id' | string }`.
- **Runtime:** exposes Hono `app` instance OR generic Web-Standards
  `(req: Request) => Promise<Response>` handler. Userland chooses runtime
  (Node, Bun, Cloudflare Worker, Vercel Edge, Lambda).
- **HMAC verify** via `pk.webhooks.verify` reading single
  `X-Pipeline-Kit-Signature: t=<unix>,v1=<hex>` header (Stripe canon per
  ADR21). Algorithm version is inside header value, not header name.
- **SSRF protection** for any user-supplied callback URLs (private IP
  blocking, DNS validation, URL normalization). Per gatewerk catalog §10.
- **Reference deps:** `hono`, `@hono/zod-validator`, `zod`.

### 3. `apify-source` — wrap any Apify actor as Source<O>

- **Package:** `@pipeline-kit/source-apify`.
- **Config:** `{ actorId, input, schema: ZodSchema<O>, datasetMode: 'append'|'reset', credentials: ApifyConfig }`.
- **Behavior:** Apify run launches via Apify SDK; result Atoms emitted from
  dataset. Cursor = Apify dataset offset.
- **Composes with:** ADR20 — `pursuit-mcp` server exposes `apify_*` tools
  (no string prefix; MCP server-namespacing is implicit) that this adapter
  consumes via mcp-tool-source proxy.
- **Reference deps:** `apify-client`, `zod`.

### 4. `mcp-tool-source` — wrap any MCP tool call as Source<O>

- **Package:** `@pipeline-kit/source-mcp`.
- **Config:** `{ serverUrl, toolName, args, schema?: ZodSchema<O> }`.
- **Behavior:** connects to MCP server, calls tool, emits result as Atom<O>.
  Auto-derives Zod schema from MCP tool's input/output schema if `schema` not
  provided; user can override.
- **Bridge to any MCP server (including pursuit):** generic adapter, no
  pursuit-specific code. MCP server-namespacing is implicit (the `serverUrl`
  + `toolName` pair fully resolves the tool); no string prefix convention
  per ADR20.
- **Reference deps:** `@modelcontextprotocol/sdk`, `zod`.

---

## Store (3 adapters)

### 5. `postgres-store` — Drizzle-backed Postgres Store<T>

- **Package:** `@pipeline-kit/store-postgres`.
- **Config:** `{ connectionString, schema: PgTable, atomTable: PgTable<AtomShape>, idempotencyTtl: 86_400_000 }`.
- **Migrations:** ships `migrations/0001_init.sql` (atom table + idempotency
  cache table). `drizzle-kit migrate` in CI/prod; never `push` in prod (ADR11).
- **Auto-derived Zod via `drizzle-orm/zod`** for insert/select shapes (ADR6).
- **Idempotency:** opens transaction, checks idempotency key, returns cached
  on hit, executes + caches on miss (ADR9).
- **Reference deps:** `drizzle-orm`, `postgres`, `zod`.

### 6. `sqlite-store` — Drizzle-backed SQLite Store<T>; local + dev

- **Package:** `@pipeline-kit/store-sqlite`.
- **Config:** `{ path, schema, atomTable }`.
- **Runtime:** `drizzle-orm/better-sqlite3` for Node; `drizzle-orm/bun-sqlite`
  for Bun.
- **Use case:** local dev, ephemeral runs, edge runtimes via Cloudflare D1
  (D1 adapter via `drizzle-orm/d1` — opt-in v1).
- **Reference deps:** `drizzle-orm`, `better-sqlite3` (Node) or
  `bun:sqlite` (Bun), `zod`.

### 7. `pgvector-store` — pgvector embedding store (pursuit pattern)

- **Package:** `@pipeline-kit/store-pgvector`.
- **Config:** `{ connectionString, dimension, distance: 'cosine'|'l2'|'inner_product', indexType: 'hnsw'|'ivfflat', schema: PgTable }`.
- **Drizzle custom-type pattern**: kit ships `pgvectorColumn(dimension)`
  helper for table definition.
- **Methods:** `upsert(atom: Atom<T>, embedding: Float32Array)`,
  `search(embedding, k, filters): Atom<T>[]`. Composes with `extract-process`
  adapters that emit embeddings.
- **Pursuit bridge:** `pursuit:pgvector_*` tools wrap this layer per ADR20.
- **Reference deps:** `drizzle-orm`, `postgres`, `zod`. Postgres extension
  `pgvector` required server-side.

---

## Process (5 adapters)

### 8. `extract-process` — LLM extraction with Zod schema validation + JSON-schema auto-derivation

- **Package:** `@pipeline-kit/process-extract`.
- **Config:** `{ provider: 'openai'|'anthropic'|'gemini'|'router', model, prompt, schema: ZodSchema<O>, temperature?, maxRetriesOnSchemaFailure?: 2 }`.
- **Behavior:** sends prompt + auto-derived JSON schema (`zod-to-json-schema`)
  to LLM. Parses response with `schema.safeParse` (boundary coercion via
  `.catch()` per ADR6). Retries on validation failure with schema-in-prompt
  reflection (per Cat-VI Pydantic AI pattern).
- **OTel:** emits Generation-shaped span with `gen_ai.usage.input_tokens`,
  `gen_ai.usage.output_tokens`, `gen_ai.system`, `gen_ai.request.model`
  attributes (per ADR8; OTel Semantic Conventions for Gen AI).
- **Reference deps:** provider SDKs (`openai`, `@anthropic-ai/sdk`,
  `@google/generative-ai`), `zod`, `zod-to-json-schema`.

### 9. `classify-process` — rule-based or LLM classifier

- **Package:** `@pipeline-kit/process-classify`.
- **Config:** `{ mode: 'rules'|'llm', categories: string[], rules?: ClassifyRule[], llmConfig?: ExtractConfig }`.
- **Rule mode:** declarative match expressions (`{ field: 'description', match: 'contains', value: 'urgent' }`).
- **LLM mode:** uses `extract-process` underneath with `category: enum(...)`
  schema.
- **Reference deps:** Optional dependency on `extract-process` (LLM mode).

### 10. `validate-process` — boundary coercion (per `feedback_pydantic_boundary_coercion.md`)

- **Package:** `@pipeline-kit/process-validate`.
- **Config:** `{ schema: ZodSchema<O>, mode: 'coerce'|'strict' }`.
- **Behavior:** runs `schema.safeParse(input)`. In `coerce` mode, applies
  `.catch(default)` per field — coerces malformed-but-recoverable values
  (e.g., enum mismatches → 'unknown', date strings → null) and emits OTel
  warning. In `strict`, rejects on first parse failure.
- **Reference deps:** `zod`.

### 11. `route-process` — basic single-priority routing

- **Package:** `@pipeline-kit/process-route`.
- **Config:** `{ predicate: (input: I) => string, branches: Record<string, Process<I, unknown>> }`.
- **Behavior:** evaluates predicate, dispatches to named branch. v0 ships
  single-priority routing only (per Phase 1 brain Q5 — full route-policy
  unification deferred to ADR-C in v1 spec).
- **Note:** for routing of Reviewables (e.g., legal contracts → ops manager,
  customer escalations → CSM, technical decisions → engineer per outline §8 #8),
  use composition: wrap with `Reviewable` and route based on `ReviewResponse`.

### 12. `reviewable-wrapper` — `Reviewable<I>` HRP gate as Process<I, I>

- **Package:** `@pipeline-kit/process-reviewable`.
- **Behavior:** wraps any `Reviewable<I>` as a Process<I, I> for chaining via
  `Pipeline.through(reviewableWrapper(reviewable))`. Equivalent to
  `Pipeline.review(reviewable)` but exposes Process-level composition for
  users who want explicit imperative control.
- **Reviewable adapters shipped in v0:** `GatewerkReviewable`,
  `SlackEmojiReviewable`, `EmailLinkReviewable`, `ConsoleReviewable` (per
  ADR14).
- **Reference deps:** `gatewerk` (peerDep for GatewerkReviewable);
  `@slack/web-api` (peerDep for SlackEmojiReviewable); user's email provider
  (peerDep for EmailLinkReviewable).

---

## Serve (4 adapters)

### 13. `email-serve` — SMTP / Postal / Resend

- **Package:** `@pipeline-kit/serve-email`.
- **Config:** `{ provider: 'smtp'|'postal'|'resend', credentials, from, idempotencyHeader: 'Idempotency-Key' }`.
- **Idempotency:** `required` (per ADR9). Adapter generates message-id from
  idempotency key; provider-side dedup where supported.
- **Reference deps:** `nodemailer` (smtp), `resend` (Resend), Postal HTTP API
  via fetch.

### 14. `slack-serve` — message + reaction-emoji approval (legacy gate alongside HRP)

- **Package:** `@pipeline-kit/serve-slack`.
- **Config:** `{ token, channel, idempotencyKey: string }`.
- **Methods:** `emit(message: SlackMessage, ctx)` posts to channel.
  Idempotency via Slack's `unfurl_links: false` + per-channel + idempotency-
  key cache (Slack doesn't natively dedup; kit-side cache is required).
- **Composes with:** `SlackEmojiReviewable` adapter (ADR14) for reaction-emoji
  HRP gate.
- **Reference deps:** `@slack/web-api`.

### 15. `webhook-serve` — outbound webhook with HMAC signing

- **Package:** `@pipeline-kit/serve-webhook`.
- **Config:** `{ url, secret, auth: 'hmac'|'basic'|'bearer'|'apiKey', authValue?: string, idempotencyHeader: 'X-Webhook-Id' }`.
- **Behavior:** signs payload via `pk.webhooks.sign` (single
  `X-Pipeline-Kit-Signature: t=<unix>,v1=<hex>` header per ADR21 Stripe
  canon), POSTs to URL, retries on transient failures.
- **Multi-auth** (per ADR17): HMAC default; alternatives via `auth` config.
- **CloudEvents emission mode** deferred to ADR-D v1 (Q6 lock).
- **SSRF protection** if URL is user-supplied.
- **Reference deps:** native `fetch`, `crypto` (Node).

### 16. `mcp-tool-serve` — exposes pipeline output as MCP tool

- **Package:** `@pipeline-kit/serve-mcp`.
- **Config:** `{ toolName, description, input: ZodSchema<I>, output: ZodSchema<RunResult>, pipeline: TerminalPipeline<unknown> }`.
- **Behavior:** registers MCP tool; on tool call, executes pipeline.run() and
  returns RunResult. Auto-derived JSON schemas from Zod schemas.
- **Use case:** any pipeline can be exposed as an MCP tool for agent
  consumption. Validates "auto-MCP exposure" (Q7) by shipping the runtime
  piece in v0; auto-codegen tooling is the v1 add.
- **Reference deps:** `@modelcontextprotocol/sdk`, `zod`,
  `zod-to-json-schema`.

---

## Composer + observability (built-in to kit core)

Not separate adapters; ship as kit core (`@pipeline-kit/core`):

- **Retry wrapper** (per ADR13) — wraps every stage with `RetryPolicy`.
- **Token-bucket rate-limit** (per ADR10) — wraps every Source/Serve.
- **Circuit breaker** (token-bucket-derived per ADR10) — opt-in modal
  semantics.
- **OpenTelemetry hooks** (per ADR8) — span emission at every stage boundary.
- **Structured logs** (Pino-shaped JSON; emits to stderr by default; replaced
  via OTel logs in prod).
- **Memory adapter** — interface only in core; orchestr8-backed impl in
  `@pipeline-kit/memory-orchestr8` (peerDep on `orchestr8-mcp`).

---

*End of §2 reference adapter list. See [spec.md](spec.md) for ADRs 1-23,
[spec-api-surface.md](spec-api-surface.md) for §1 API surface,
[spec-build-plan.md](spec-build-plan.md) for §3 test plan + §4 roadmap +
§5 deferred questions.*
