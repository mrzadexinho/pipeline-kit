# pipeline-kit v1 Spec — Cross-Cutting: Secrets, Memory, Cross-Runtime & Cost

> Drilldown for `spec-v1.md`. Covers Cat VIII (6 ADRs), Cat V (6 ADRs), Cat IX (5 ADRs), Cat X (5 ADRs) = 22 ADRs total.

---

## §VIII — Identity / Secrets (6 ADRs)

### VIII-1: SecretsResolver B-placement

**Status:** RATIFIED

**Decision:** `SecretsResolver` is passed as an adapter dependency at the construction site — `deps: { secrets: SecretsResolver }`. NOT on `PipelineContext`.

```ts
interface SecretsResolver {
  resolve(name: string): Promise<Result<string, SecretsError>>;
  invalidate(name: string): void;
  stats(name: string): { reads: number; current_version: string };
}

const apifySource = createApifySource({
  args: { actorId: 'apify/web-scraper' },
  deps: { secrets },          // omission = compile error; greppable contract
});
```

**Key constraint:** `PipelineContext` stays minimal (`run_id / signal / trace / idempotencyKey`) — `secrets` is never ambient.

**Consequence:** Construction site documents the secret dependency as a compile error on omission. Adapter factories requiring secrets at construction time become async (`Promise<Result<Source<O>, E>>`). V0 `PipelineContext` shape unchanged.

---

### VIII-2: Rotation semantics — `invalidate(name)` + version-aware resolver default

**Status:** RATIFIED

**Decision:** Kit ships `createVersionAwareResolver(real: SecretsResolver): SecretsResolver`. On each `resolve(name)` call: probe `real.stats(name).current_version`; cache hit on `{value, version}` match; else fetch and stamp. Adapters call `resolve(name)` freely — the wrapper owns caching.

**Key constraint:** `resolver.invalidate(name)` is load-bearing; without it kit has no rotation vocabulary. Post-`invalidate()` + at-least-one-stats-probe = next-resolve sees fresh value for re-readable secrets.

**Consequence:** Adapters do NOT manage caching. Re-readable string secrets are rotation-safe by default. Non-re-readable resources (long-lived HTTP/2 streams, pre-signed URLs) remain an open carry-forward.

---

### VIII-3: TTL composition wrapper for short-lived-token backends

**Status:** RATIFIED

**Decision:** Kit ships `createTtlResolver(inner: SecretsResolver, ttlMs: number): SecretsResolver`. On `resolve(name)`: if `now - lastFetch >= ttlMs`, call `inner.invalidate(name)` to trigger version bump, then resolve fresh. Composition order: `createTtlResolver(createVersionAwareResolver(real), 60_000)` — TTL outer, version-aware inner.

**Key constraint:** TTL wrapper targets OIDC/STS short-lived tokens (5-60 min `exp`) that invalidate by time, not upstream signal. Per-name TTL granularity.

**Consequence:** Workload-identity backends (AWS IRSA / GCP WIF / GitHub OIDC) are first-class at v1. Adapter authors do NOT couple to TTL; wrapper is invisible at adapter call site.

---

### VIII-4: Naming + scoping + deps shape — flat default, `scope()` optional façade

**Status:** RATIFIED

**Decision:** Three layered defaults:
1. **Naming** — flat hyphenated names (`apify-token`, `supabase-service-role`). Matches kit `NAME_RE` `^[a-z0-9][a-z0-9-]*$`.
2. **Deps** — `{ secrets: SecretsResolver }` (single resolver, multi-resolve at call sites).
3. **Scoped façade** — OPTIONAL. `secrets.scope(prefix)` returns `ScopedSecretsResolver`; `resolve(name)` forwards to parent as `${prefix}-${name}`. Sub-view shares parent cache (no per-scope forking). Adapters with N≥3 secrets in one namespace MAY accept `{ <ns>Secrets: ScopedSecretsResolver }`.

**Key constraint:** Cells (e) flat and (f) scope produce byte-identical runtime observables (spike #5 + #6). Cell (2) (dep-per-secret pre-resolved at boot) is structurally disqualified — cannot participate in version-aware wrapper's stats-probe machinery.

**Consequence:** Default call sites use `secrets.resolve('apify-token')` — one line, greppable. Dotted-name `NAME_RE` extension deferred to v1.x.

---

### VIII-5: Reference-adapter trio + non-goals — env / sops / oidc; kit is NOT a vault

**Status:** RATIFIED

**Decision:** Kit ships at M2 under `@idriszade/secrets`:
- `@idriszade/secrets-env` — env-var resolver; default for laptop + VPS.
- `@idriszade/secrets-sops` — SOPS + age / KMS encrypted-in-git.
- `@idriszade/secrets-oidc` — OIDC token exchange (AWS IRSA / GCP WIF / GitHub Actions).

**Non-goals (explicit rejections):** Kit is NOT a secret store. No encryption primitives in kit-core. HMAC envelope auth remains at v0 ADR17 webhook scope — NOT coupled to `SecretsResolver`. Secret scanning is devshield's territory. Multi-tenant RBAC is downstream-app territory.

**Key constraint:** Three references prove the contract spans long-lived API keys → encrypted-in-git → short-lived workload-identity.

**Consequence:** M2 LOC budget ~600-900 LOC for trio vs ~250 for env-only. V0 `pk.webhooks.verify(rawBody, sigHeader, secret)` API surface unchanged.

---

### VIII-6: PII / secret redaction in observability — default-on at Zod boundary

**Status:** RATIFIED (direction-only; M2 micro-spike flagged)

**Decision:** Kit ships default-on schema-annotation-driven redaction at the Zod boundary:

```ts
const Atom = z.object({
  user_email: z.string().email().describe('@redact'),
  api_key:    z.string().describe('@secret'),
});
// @redact → <redacted:N-chars>  in OTel span attrs + observe outputs
// @secret → <secret:hash-prefix> (first 8 chars SHA-256 hex)
```

Explicit opt-out via `pipeline.observe({ redaction: 'off' })` — discouraged, emits loud warning. Hooks at Source ingest + Serve emit. NOT coupled to `SecretsResolver`.

**Key constraint:** Redaction must be default-on; leak-by-default is a non-starter for personal automations carrying real user data.

**Consequence:** Atom schemas annotate sensitive fields. `@idriszade/observe` (launch-tier pack) consumes annotations before OTel export. Brand-vs-describe choice and secret-hash algorithm deferred to M2 micro-spike.

---

## §V — Memory / Feedback (6 ADRs)

### V-1: Two-verb core (read + write) for `MemoryAdapter`

**Status:** RATIFIED

**Decision:** `MemoryAdapter` core contract exposes exactly two verbs:

```ts
interface MemoryAdapter {
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
}
```

No `batch`, `list`, `delete`, `search`, or CAS at core. Opt-in markers extend without amending core (see V-2, V-3). JSON-serialisation by caller convention; `MemoryAdapter<T>` generics deferred to v1.x.

**Key constraint:** `string | null` for absent key (matches Map.get ergonomics + orchestr8 `retrieve(): MemoryEntry | undefined`). Mirrors Cat VIII's 1-verb pattern lifted to 2 verbs.

**Consequence:** Trivially implementable by any get/set backend (Redis, SQLite, Map, pgvector). `MemoryError` envelope: `{ type, code, message, param?, doc_url? }`; minimum codes: `memory_unavailable`, `key_invalid`, `unknown`.

---

### V-2: `Disposable` opt-in marker for adapter lifecycle

**Status:** RATIFIED

**Decision:** Adapters needing lifecycle cleanup implement `Disposable`:

```ts
interface Disposable { close(): Promise<void>; }

function isDisposable(dep: unknown): dep is Disposable {
  return typeof dep === 'object' && dep !== null && 'close' in dep;
}
```

Composer calls `disposeAll(deps)` inside the pipeline-level `finally` block (~10 LOC fixed cost). Lifecycle-free adapters (in-memory Map, static fixtures) are NOT modified.

**Key constraint:** `close()` in core (3-verb) rejected — forces stub `close()` on every lifecycle-free sibling; 75 stub LOC at N=15 adapters. `DisposableRegistry` (cell γ) deferred to Cat VI synthesis for pipeline-resource-lifetime ADR.

**Consequence:** `implements Disposable` grep produces a clean inventory of real-lifecycle backends (zero false positives). TC39 `Symbol.asyncDispose` alignment noted for v1.x (Node 22+).

---

### V-3: `Listable` opt-in marker for key enumeration

**Status:** RATIFIED

**Decision:** Adapters that can enumerate keys implement `Listable`:

```ts
interface Listable {
  list(namespace: string): Promise<Result<string[], MemoryError>>;
}
```

Composer-side narrowing via `isListable(dep)` runtime guard — parallel to `isDisposable`. Intersection-type adapter shape: `MemoryAdapter & Disposable & Listable`.

**Key constraint:** Cursor-file-workaround (sentinel key containing atom-id index) rejected — forces non-standard naming convention and index synchronisation on every write site.

**Consequence:** Pattern-lift β.5 CONFIRMED — `Disposable` and `Listable` both follow core-2-verb + opt-in marker shape. Future markers (`Searchable`, `Forgettable`, `Updatable`) follow the same pattern with zero core amendment. Pagination richer signature deferred to v1.x.

---

### V-4: LWW semantic specification + reference-adapter wrap discipline

**Status:** RATIFIED

**Decision:** Kit specifies last-write-wins (LWW) at the contract level. `MemoryAdapter.write()` MUST: given a key that already exists, `read(key)` after a successful `write(key, newValue)` MUST return `newValue`. Reference adapters with divergent native semantics MUST wrap to enforce LWW.

orchestr8 `store()` is silent-first-write-wins (confirmed spike #3 α.2 headline). Wrap options: (A) DELETE-then-INSERT; (B) query → if found, update; else store. Both behaviorally equivalent.

**Key constraint:** LWW is a SEMANTIC specification, not a verb. No `delete` verb added to core. Adapter compliance test: write K→V1; write K→V2; read K → MUST return V2.

**Consequence:** Concurrent writes (two processes, same key) are explicitly out of scope at v1.0 — LWW is single-writer semantic; concurrent behaviour is adapter-implementation-defined.

---

### V-5: Namespace as construction-time adapter argument

**Status:** RATIFIED

**Decision:** Namespace is adapter identity, supplied at factory `opts.namespace` — NOT per-call. Call-site composed-key convention: `${namespace}::${atomId}` (double-colon separator). `read/write` accept only the composed key; no namespace argument on the methods themselves.

**Key constraint:** `PipelineContext` stays minimal (`run_id / signal`); namespace is adapter-construction concern, not pipeline-run concern. `scope()` façade is OPTIONAL (same pattern as VIII-4).

**Consequence:** Multi-namespace apps construct multiple adapters (`workingMemory`, `episodicMemory`) — clean separation at DI boundary. Composer-level auto-propagation of namespace from `pipelineId` / `stageId` deferred to v1.x.

---

### V-6: Reference-adapter trio + non-goals — map / orchestr8 / sqlite

**Status:** RATIFIED

**Decision:** Kit ships at M2 under `@idriszade/memory`:
- `@idriszade/memory-map` — in-memory `Map`. Zero deps. Canonical test fixture. Trivially LWW. No `Disposable`. No `Listable`.
- `@idriszade/memory-orchestr8` — orchestr8-mcp sql.js SQLiteBackend. LWW-enforced (per V-4). Implements `MemoryAdapter & Disposable & Listable`. Best-suited for <10k KV entries.
- `@idriszade/memory-sqlite` — node:sqlite (Node 22+) or better-sqlite3. LWW via `INSERT OR REPLACE`. Implements `MemoryAdapter & Disposable & Listable`. WAL mode for >10k entries.

**Non-goals:** Kit is NOT a memory store. No Redis at v1.0. No pgvector in this trio (semantic memory is DISTINCT from structured KV; deferred to `@idriszade/memory-pgvector` pack). Memory is NOT secrets (ADR VIII-1 orthogonality).

**Key constraint:** M2 LOC budget ~400-600 LOC for trio vs ~150 for Map-only.

**Consequence:** All three expose the same `MemoryAdapter` shape; user composes via `deps: { memory }` uniformly. orchestr8 adapter documents LWW-wrap approach + subpath-import concern (missing `exports` map).

---

## §IX — Cross-Runtime (5 ADRs)

### IX-1: Cross-runtime wire format — NDJSON default + LSP opt-in

**Status:** RATIFIED

**Decision:** Two co-existing wire modes:

1. **NDJSON-over-stdio (default).** One JSON envelope per `\n`-terminated line. Canonical JSON per RFC 8785 (compact, sorted keys, no whitespace). Timestamps RFC 3339 + millisecond precision (`YYYY-MM-DDTHH:mm:ss.sssZ`); sub-millisecond precision SHALL be rejected at the boundary. `print()` redirected to stderr by adapter convention.

2. **LSP `Content-Length` framing (opt-in).** Per-envelope `Content-Length: N\r\n\r\n<N body bytes>`. Strict header parser: reject any non-`Content-Length` line on the FIRST line of the header block (closes spike-3 silent-pass class). 8 KiB header bound. Body length validated against header; partial-frame-on-EOF emits `wire/truncated_body` and exits non-zero.

**Key constraint:** `print(flush=True)` silent-pass in LSP mode is closed by strict-header-parser. RFC-3339-millisecond-only closes Python `fromisoformat` silent-truncate. RFC 8785 closes JSON-spacing asymmetry. Kit byte-counters MUST count UTF-8 bytes, not chars.

**Consequence:** Adapter authors choose framing per-adapter; kit ships both parsers + helpers. Integers > `Number.MAX_SAFE_INTEGER` in cross-runtime fields MUST use string encoding.

---

### IX-2: Schema bridge — Zod → JSON Schema → Pydantic, build-time codegen

**Status:** RATIFIED

**Decision:** Zod is source-of-truth (TS-primary per v0). At adapter package build time:
1. `zod-to-json-schema` emits JSON Schema Draft 2020-12 (`schemas/<adapter>.schema.json`).
2. `datamodel-code-generator` consumes the schema and emits Pydantic v2 (`<adapter>_py/models.py`).
3. CI verifies regen-stability (output byte-identical to committed copy). Divergence = CI failure.

**Key constraint:** Hand-walk gap was 7 divergences at 2 schemas + 1 ruleset (spike #2). 15+ reference adapters in v1 makes hand-walk irresponsible. Zod refinements / transforms / `.brand()` without JSON Schema equivalents MUST be flagged at codegen time.

**Consequence:** Pydantic v2 is a kit-pinned major version for Python adapter consumers. Business-rule layer remains hand-walked or moves to a kit-defined post-validation hook (out of scope IX).

---

### IX-3: Result<T,E> cross-runtime — keep `{data, error}`, ship `decode_result()` helper, per-frame envelope

**Status:** RATIFIED

**Decision:**
1. Discriminator stays `{data, error}` shape (no v0 ADR4 amendment).
2. Kit ships a sanctioned `decode_result()` helper per runtime (TS + Python at v1). It is the ONLY sanctioned entry point for cross-runtime adapters to inspect the discriminant; returns `{kind:'ok',value} | {kind:'err',error}` (TS) or `Ok(value) | Err(error)` namedtuple (Python).
3. Per-frame `Result<Atom, E>` is the canonical streaming wire shape (ERR-on-frame-N does NOT poison frame-N+1).
4. Batch `Result<Atom[], E>` retained for closed-batch endpoints.

**Key constraint:** Cross-runtime sources MUST emit `null` for absent optional fields — never omit the key (`JSON.stringify` omits `undefined`; Pydantic silently accepts absence).

**Consequence:** Convention-not-tag friction is funnelled to one helper per runtime — typo damage bounded. Adapter authors MUST use `decode_result()` and not hand-roll the discriminator check; lint rule + code review enforce.

---

### IX-4: Cross-runtime OTel — W3C Trace Context, out-of-band

**Status:** RATIFIED

**Decision:** W3C Trace Context (`traceparent` + optional `tracestate`) propagated out-of-band:
- **LSP mode:** `traceparent` as second header line alongside `Content-Length`. Strict parser accepts `Content-Length` (line 1) + `traceparent` (line 2 if present); rejects unknown headers thereafter.
- **NDJSON mode:** `metadata.traceparent` on each Atom envelope (`metadata` is `Record<string, unknown>`, NOT Atom `data`).

**Key constraint:** Atom shape is locked (v0 ADR); cannot mutate `data`. Python-side OTel SDK setup is the adapter author's responsibility — kit ships no Python OTel shim.

**Consequence:** Atom v0 compat preserved. No cross-runtime span linkage spec beyond W3C Trace Context — kit punts to the OTel ecosystem. If Cat VI synthesis adds a sidecar control channel, trace context MAY relocate there; re-evaluate at Cat VI.

---

### IX-5: Kit owns wire-format spec; MCP / A2A delegated to adapter-tier

**Status:** RATIFIED

**Decision:** Kit OWNS the cross-runtime wire-format spec for Source ↔ Process ↔ Serve hops (= IX-1 framing + RFC 8785 + RFC 3339 + IX-3 envelope + IX-2 schema bridge + IX-4 trace context). MCP and A2A are adapter-tier:
- `source-mcp` / `serve-mcp` (v0) — kit speaks MCP as Source/Serve.
- Future `agent-a2a` — kit speaks A2A as agent-handoff Serve.

Adapter packages MUST declare which mode they use (`NDJSON | LSP | MCP-via-source-mcp | A2A-via-serve-a2a`) in `package.json` `pipeline_kit.wire` field.

**Key constraint:** MCP JSON-RPC 2.0 is request/response — wrong shape for streaming Source/Process/Serve pipelines. A2A is agent-handoff, not data-pipeline primitive.

**Consequence:** Kit cross-runtime primitive stays small and pipeline-shaped. Auto-MCP exposure (`pk gen-mcp` codegen) remains an open question — not blocked by this ADR.

---

## §X — Cost / Usage (5 ADRs)

### X-1: UsageAccumulator on PipelineContext; generic `Map<string,number>`; OTel GenAI key namespace

**Status:** RATIFIED

**Decision:** `ctx.usage: UsageAccumulator` lives on `PipelineContext` alongside `signal` and `trace`.

```ts
interface UsageAccumulator {
  record(key: string, delta: number): void;  // additive
  get(key: string): number;
  getAll(): ReadonlyMap<string, number>;      // immutable snapshot
}
```

OTel GenAI Semantic Conventions (`gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.request.model`) are the RECOMMENDED key namespace; kit-core enforces no key taxonomy. ~12 LOC implementation.

**Key constraint:** `deps.meter` (service-shaped Option B) rejected — Composer cannot read total spend without coupling to a dep key name. Same cross-cutting placement logic as `ctx.signal`.

**Consequence:** Composer aggregates child usage without dep-key coupling. Local AI (`compute.duration_ms`) and cloud AI (`gen_ai.usage.input_tokens`) use identical API. Kit-core is metric-agnostic.

---

### X-2: `runtime_budget_exceeded` added to StageErrorCode taxonomy (18→19)

**Status:** RATIFIED

**Decision:** `runtime_budget_exceeded` is the 19th `StageErrorCode`. Category: Runtime. `retryable: false` — spending more tokens cannot resolve a budget overrun. Extends Cat VI ADR-VI-3 (18-code taxonomy).

**Key constraint:** Reusing `process_failed` with a sub-code rejected — loses explicit budget semantics in dashboards and filtering. Stripe cap-at-100% semantics: terminate, do not retry.

**Consequence:** Callers branch on this code without string-matching `message`. Budget overruns are unambiguously non-retriable at the type level. M1 carry-forward: attach `ctx.usage` snapshot to `runtime_budget_exceeded` `StageError` payload for diagnostics.

---

### X-3: CostBudget declaration; action gradient (abort / review / warn); `pipeline.run()` options

**Status:** RATIFIED

**Decision:**

```ts
interface CostBudget {
  metric: string;                        // e.g. 'gen_ai.usage.input_tokens' or 'cost.usd'
  limit: number;
  action: 'abort' | 'review' | 'warn';
}

pipeline.run(input, { costBudget: CostBudget[] });
```

Composer checks all budgets between every stage transition. `action: 'review'` composes with `Reviewable<I>` (no new primitive). `action: 'warn'` emits structured log + OTel event. `action: 'abort'` emits `runtime_budget_exceeded` StageError. Follows RunGuard declaration-only pattern (Cat IV ADR-IV-5).

**Key constraint:** Budget as pipeline-level config (not per-run flexible) rejected — misses per-run override use cases. Checks are pure numeric comparisons; zero stateful Composer logic.

**Consequence:** Budgets are per-run, composable. Multi-meter budgets (token cap + compute cap simultaneously) supported via `CostBudget[]`. HRP review for budget decisions reuses existing `Reviewable<I>`.

---

### X-4: Cost derivation is adapter-tier (`@idriszade/cost` pack); kit-core accumulates raw metrics only

**Status:** RATIFIED

**Decision:** Kit-core accumulates raw `Map<string, number>` only. Tokens → USD conversion (model pricing tables) is the responsibility of the `@idriszade/cost` pack. `CostBudget` operates on raw token counts OR on USD values if `@idriszade/cost` writes a `cost.usd` key back to `ctx.usage`.

`@idriszade/cost` pack shape (cf-X-1, due Phase 2): `(model, inputTok, outputTok) => USD`.

**Key constraint:** Kit-core shipping a pricing table rejected — couples to external pricing APIs; breaks local-AI use case; requires constant maintenance. OTel GenAI Semantic Conventions have token counts only (no cost attributes).

**Consequence:** Kit-core has zero external API dependency for cost. Pricing tables are versioned and replaceable at the pack layer without touching kit-core. Langfuse built-in model pricing tables confirm the adapter-tier delegation pattern.

---

### X-5: Rate limiting is adapter-tier only; no kit-core rate limiter

**Status:** RATIFIED

**Decision:** Rate limiting (req/s, concurrency) is categorically distinct from budget tracking (total spend). Kit delegates rate limiting via RunGuard declaration (Cat IV ADR-IV-5); adapters implement enforcement (e.g., Inngest `rateLimit` on step functions). No kit-core rate-limiter primitive.

**Key constraint:** Kit-core token-bucket rate limiter rejected — adds stateful complexity; duplicates Inngest/Temporal scheduler capability; inconsistent with declaration-only discipline.

**Consequence:** Rate-limiting policy is adapter-configurable per runtime. Kit-core stays stateless. Inngest-adapter and future adapters each enforce rate limits in their own runtime context.

---

*Drilldown author: Brain — 2026-05-15. Sources: research-notes-v1-cat-VIII.md / cat-V.md / cat-IX.md / cat-X.md.*
