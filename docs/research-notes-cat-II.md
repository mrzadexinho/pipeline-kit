> Phase 1 research notes — Category II (TypeScript SDK ergonomics). Back to [research-notes.md](research-notes.md) (synthesis) · [research-notes-full.md](research-notes-full.md) (master).

## Category II — TypeScript SDK ergonomics

Why SIXTH: kit's SDK shape directly inherits from Gatewerk-family conventions (already-adopted in Gatewerk's `ideas-to-steal.md`). Sources 8-11 are CROSS-REFERENCE notes pointing to source 21 (Gatewerk catalog) since patterns are duplicated; sources 12-13 get full notes (tRPC novel, Gatewerk sdk-ts is the canonical local reference).

### 8. Stripe Node SDK — `stripe/stripe-node` (REFERENCED via Gatewerk source 21 §1+§2)
- **Purpose:** Industry-canonical TypeScript SDK ergonomics. Resource-based client, prefixed IDs, idempotency keys, cursor pagination, expandable objects, actionable errors.
- **What to lift (already inherited via Gatewerk):**
  - Prefixed IDs (`pk_pipe_/run_/atom_/src_/proc_/serve_`) — **ADR16**.
  - Resource-based client: `client.reviews.create()` style — **ADR16**.
  - Idempotency keys auto-generated on mutating SDK calls — **ADR9**.
  - Cursor pagination (`starting_after=pk_run_abc`) — **ADR16**.
  - Expandable objects (`?expand[]=template`) — **ADR16**.
  - Actionable error envelope: `{ type, code, message, param, doc_url }` — **ADR16**.
  - Built-in retry with exponential backoff + jitter respecting `Retry-After` — **ADR13**.
- **What to avoid:** Don't lift Stripe's full resource taxonomy (Customers, Subscriptions, Invoices) — kit's resources are different (Pipelines, Runs, Atoms).
- **License + community:** MIT. ~4k+ stars. Industry standard for TS SDK ergonomics.
- **Cross-ref:** Gatewerk's `ideas-to-steal.md` §1, §2.6 (built-in retry), §2.7 (auto-generated idempotency keys).

### 9. Resend SDK — `resend/resend-node` (REFERENCED via Gatewerk source 21)
- **Purpose:** Modern TS SDK ergonomics from email-API company. Simple resource-based client; bundled webhook verification.
- **What to lift (already inherited via Gatewerk):**
  - Discriminated union response: `{ data, error }` — **ADR4 + ADR16**.
  - SDK-bundled webhook verification: `resend.webhooks.verify(rawBody, sig, secret)` returns typed event union — **ADR17**.
  - Typed webhook events: `'email.sent' | 'email.delivered' | 'email.bounced' | ...` discriminated union — **ADR16**.
  - Framework-first docs landing ("How are you using Resend? → Next.js / TS / Python / cURL") — DX inspiration for pipeline-kit docs.
- **What to avoid:** Don't replicate Resend's email-domain primitives (Audiences, Broadcasts, Templates).
- **License + community:** MIT. Active. **Cross-ref:** Gatewerk catalog §2.4 (discriminated union), §3.2 (SDK webhook verification), §3.3 (typed events).

### 10. Supabase JS — `supabase/supabase-js` (REFERENCED via Gatewerk source 21 §2.2)
- **Purpose:** Modern TS SDK with `createClient()` factory pattern. ~76k+ stars; defines factory-function ergonomics for the ecosystem.
- **What to lift (already inherited via Gatewerk):**
  - `createClient({ apiKey, url })` factory — kit ships `createPipelineKit()` mirroring this — **ADR16**.
  - Env-var fallback (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) — kit uses `PIPELINE_KIT_API_KEY`, `PIPELINE_KIT_URL` — **ADR16**.
  - Allows internal config before returning client (cleaner than `new Class()`).
- **What to avoid:** Don't lift Supabase's domain-specific clients (db, auth, storage, realtime, functions) — kit's resources are different.
- **License + community:** MIT. **Cross-ref:** Gatewerk catalog §2.2 (factory function), §2.3 (env-var fallback).

### 11. Knock — `knocklabs/knock-node` (REFERENCED via Gatewerk source 21)
- **Purpose:** Notification-infrastructure SDK with strong TS DX. Typed exception hierarchy in Python, discriminated `{ data, error }` in TS, built-in retry, auto-generated idempotency keys.
- **What to lift (already inherited via Gatewerk):**
  - Typed exception hierarchy (Python side) — relevant if pipeline-kit ever ships Python; for TS, discriminated unions cover the role — **ADR4**.
  - Auto-generated idempotency keys at SDK layer — **ADR9**.
  - Built-in retry with exponential backoff respecting `Retry-After` — **ADR13**.
- **What to avoid:** Don't lift Knock's notification-specific resource model.
- **License + community:** Open SDK (Apache 2.0); cloud product paid. **Cross-ref:** Gatewerk catalog §2.5 (typed exceptions Python), §2.6, §2.7.

### 12. tRPC — https://trpc.io
- **Purpose:** End-to-end type-safe RPC for TypeScript. Server defines procedures; client gets fully-inferred types. No code generation, no schema files — types flow via TypeScript inference.
- **Core abstractions (verbatim):**
  - `t.router({})` — defines a router (collection of procedures).
  - `publicProcedure` / `protectedProcedure` — procedure builders; chain `.input(zodSchema).query/mutation(handler)`.
  - `createTRPCClient<AppRouter>({})` — type-safe client; `AppRouter` type is exported from server.
  - **Procedure types:** `query` (read, GET-style), `mutation` (write, POST-style), `subscription` (long-lived).
  - **Middleware:** chainable; can add context (auth, db).
  - **Context:** per-request data injected into procedures.
  - **Adapters:** Express, Fastify, Next.js, Cloudflare Workers, AWS Lambda, standalone.
- **API surface (canonical):**
  ```typescript
  // Server
  import { initTRPC } from '@trpc/server';
  import { z } from 'zod';

  const t = initTRPC.create();
  export const appRouter = t.router({
    pipelineRun: t.procedure
      .input(z.object({ pipelineId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const run = await ctx.composer.run(input.pipelineId);
        return run;
      }),
  });
  export type AppRouter = typeof appRouter;

  // Client (fully typed via inference)
  import { createTRPCClient } from '@trpc/client';
  import type { AppRouter } from './server';

  const client = createTRPCClient<AppRouter>({ url: '...' });
  const run = await client.pipelineRun.mutate({ pipelineId: 'pk_pipe_abc' });
  ```
- **What to lift:**
  - **End-to-end TS inference (server defines, client infers)** is a powerful pattern for kit's Composer-as-RPC v2 vision. If pipeline-kit ever exposes a Composer over HTTP for cross-process composition, tRPC's type-flow pattern is the canonical reference.
  - **Procedure builder chaining (`.input().mutation()`)** — kit's `createSource()/createProcess()/createServe()` factory functions can mirror this with chainable typed config: `createSource().withInput(zod).withCursor(...).iter(handler)`.
  - **Zod-as-input-validator integration** — kit's adapters validate inputs via Zod at the boundary (**ADR6**).
- **What to avoid:**
  - Don't adopt tRPC as kit's wire protocol by default — locks users into a specific RPC framework. v2 Composer-over-HTTP can offer tRPC adapter as one option among MCP/REST/CloudEvents.
  - tRPC's middleware system is strong but couples auth/ctx tightly to the procedure call site; kit's middleware is per-stage, not per-procedure.
- **Stated non-goals:** Not a workflow engine; not a queue; not a database client. Focused on the RPC contract.
- **License + community:** MIT. ~36k+ stars. Dominant TS RPC framework.

### 13. Gatewerk sdk-ts — `~/Claude-Workspace/gatewerk/packages/sdk-ts/` (LOCAL canonical reference)
- **Purpose:** Gatewerk's own TypeScript SDK. **The canonical reference for pipeline-kit's SDK shape** — ships in production, validated by real usage, embodies all Gatewerk-family conventions.
- **Core abstractions (verbatim from `src/index.ts` exports):**
  - `createClient(config: ClientConfig): GatewerkClient` — factory function (matches Supabase pattern).
  - **8 resources:** `gw.reviews`, `gw.templates`, `gw.feedback`, `gw.audit`, `gw.stats`, `gw.chains`, `gw.notes`, `gw.webhooks`.
  - `Result<T, E>` shape: `{ data: T, error: null } | { data: null, error: E }` — discriminated union (**ADR4**).
  - `GatewerkApiError` typed error class.
  - Per-resource typed input/output: `CreateReviewInput`, `DecideInput`, `ListFilters`, `ReviewDetail`, `ReviewTemplate`, `ChainDefinition`, `Note`, etc.
- **API surface (verbatim from README):**
  ```typescript
  import { createClient } from "gatewerk";

  const gw = createClient({
    apiKey: process.env.GATEWERK_API_KEY!,
    url: "http://localhost:3100",
  });

  const { data: review, error } = await gw.reviews.create({
    template: "email-review",
    payload: { to: "user@example.com", subject: "Hello", body: "..." },
    callback_url: "https://your-agent.example.com/callback",
  });
  if (error) {
    console.error(error.code, error.message);
    return;
  }

  const payload = gw.webhooks.verify(rawBody, signatureHeader, hmacSecret);
  ```
- **What to lift (whole-cloth for pipeline-kit's SDK shape):**
  - **`createClient(config)` factory** → `createPipelineKit(config)` — **ADR16**.
  - **`{ data, error }` Result shape** → `Result<T, E>` everywhere — **ADR4**.
  - **Resource-based client** with per-resource methods — **ADR16**.
  - **Per-resource typed input/output** exported from index — TS DX baseline. Kit exports `CreateRunInput`, `RunDetail`, `PipelineDefinition`, etc.
  - **`createClient` accepts both explicit config AND env-var fallback** (`GATEWERK_API_KEY` / `GATEWERK_URL` env vars) — **ADR16**.
  - **`gw.webhooks.verify(rawBody, sig, secret)` SDK-bundled** — kit ships `pipelinekit.webhooks.verify` mirroring exactly — **ADR17**.
  - **v1 + v2 webhook signature support** — Gatewerk has dual-header transition pattern: `X-Webhook-Signature` (v1, hash-only) + `X-Webhook-Signature-V2` (replay-safe, `t=...,v1=...`). pipeline-kit ships v2-style by default but should document migration pattern. **ADR17 augmentation.**
  - **Constant-time hex comparison via `timingSafeEqual`** — direct lift for kit's HMAC verify — **ADR17**.
  - **`X-Webhook-Id` for receiver-side dedup** — even with v2 verified, header ID is the idempotency key for downstream consumer. **Confirms ADR9.**
- **What to avoid:**
  - Don't lift the `Station` class (legacy/deprecated; sdk-ts has it for backward compat) — `createClient` is canonical.
  - Don't lift Gatewerk's domain-specific resources (templates, chains, notes) — kit's resources are pipelines/runs/atoms, not reviews/templates.
- **Stated non-goals:** SDK is for Gatewerk-the-product API; not a generic HITL SDK. pipeline-kit's `Reviewable<I>` is the abstraction layer above this SDK.
- **License + community:** Apache 2.0. In production. 18 tests passing. Reference impl for the family.

---

### Category II — Synthesis

**Top 3 patterns to lift across TS SDK ergonomics category:**

1. **`createClient(config)` factory + env-var fallback + `{ data, error }` discriminated union response.** Stripe + Supabase + Resend + Knock + Gatewerk-sdk-ts all converge. **Direct adoption** — pipeline-kit ships `createPipelineKit({ apiKey, url })` with `PIPELINE_KIT_API_KEY` + `PIPELINE_KIT_URL` env-var fallback. Maps to **ADR4 + ADR16**. **Confidence HIGH.**

2. **SDK-bundled webhook verification with typed event union return.** Resend + Stripe + Gatewerk all ship `client.webhooks.verify(rawBody, sig, secret) → typed event`. pipeline-kit ships the same. **Cross-reference Cat VII synthesis.** Maps to **ADR17 + ADR16**. **Confidence HIGH.**

3. **Resource-based client with per-resource typed input/output exports.** Stripe `client.charges.create()`, Supabase `client.from('table').select()`, Gatewerk `gw.reviews.create()` — all ship per-resource methods + exported types. pipeline-kit's resources: `pk.pipelines`, `pk.runs`, `pk.atoms`, `pk.adapters` (TBD). Maps to **ADR16**. **Confidence HIGH.**

**Top 2 pitfalls to avoid:**

1. **Throwing exceptions across SDK boundary** — Knock + Gatewerk both prefer `{ data, error }` Result shape. `throw new Error()` works in TS but loses discrimination + breaks compositional pipelines. **ADR4** strict: no thrown errors crossing public stage or SDK boundary.

2. **Tightly coupling SDK to a specific HTTP framework.** Stripe Node SDK, Resend, Knock all use a generic `fetch`-based HTTP client they own. Don't expose `axios` / `node-fetch` in public API surface; wrap.

**Implications for ADRs:**

- **ADR4 (Result<T,E>):** Strongly confirmed. Direct lift from Gatewerk-sdk-ts. **Confidence HIGH.**
- **ADR16 (naming + envelope):** Strongly confirmed. `createClient` factory + resource-based + env-var fallback + prefixed IDs + response envelope. **Confidence HIGH.** Direct lift.
- **ADR17 (webhook signing):** **Augmentation needed.** Gatewerk's v1 (hash-only) + v2 (replay-safe `t=...,v1=...`) dual-header pattern shows real-world transition path. pipeline-kit ships v2-style by default; documents migration pattern in spec. **Confidence HIGH for v2 default.**
- **ADR15 (test framework):** Gatewerk-sdk-ts uses Vitest + 18 tests. Confirms **ADR15** Vitest choice.

**Open questions for brain adjudication:**

1. **What are pipeline-kit's resources?** Gatewerk has 8 (reviews/templates/feedback/audit/stats/chains/notes/webhooks). pipeline-kit candidates: `pipelines`, `runs`, `atoms`, `adapters` (or `sources`/`stores`/`processes`/`serves`), `webhooks`. *Brain recommend: 5 resources — `pk.pipelines`, `pk.runs`, `pk.atoms`, `pk.adapters` (covers all stage types), `pk.webhooks`. Phase 2 ADR for resource taxonomy.*
2. **Does pipeline-kit's SDK ship a Composer instance, or is the SDK separate from the kit's runtime composer?** Two layers: (A) `createPipelineKit()` returns a Composer that runs pipelines locally; (B) `createPipelineKit()` returns an SDK client for talking to a hosted/cloud Composer. *Brain recommend: (A) for v0 — Composer IS the kit. v1+ adds (B) optionally.*
3. **tRPC adapter for v2 Composer-over-HTTP?** Optional adapter alongside MCP/REST/CloudEvents. *Brain recommend: include in v2 ADR catalog.*
4. **Webhook signature versioning** — kit ships v2 (`t=...,v1=...`) by default; backwards compat for v1 (hash-only)? *Brain recommend: v2 only (no v1) — kit is greenfield, no migration burden. Document v2 spec explicitly.*
5. **Python SDK?** Knock has typed exception hierarchy for Python. pipeline-kit is TS-primary; Python is via MCP bridge (**ADR20**). *Brain recommend: no Python SDK in v0; revisit if cross-language demand emerges.*

---

