> Phase 1 research notes — Category VII (HTTP / webhook / event). Back to [research-notes.md](research-notes.md) (synthesis) · [research-notes-full.md](research-notes-full.md) (master).

## Category VII — HTTP / webhook / event

Why FOURTH: `webhook-source` (incoming with HMAC verify) + `webhook-serve` (outbound with HMAC sign) are v0 reference adapters. Patterns inform ADR17 (webhook signing), ADR16 (naming), and Composer's HTTP layer.

### 38. Hono — https://hono.dev
- **Purpose:** Small, ultrafast TypeScript HTTP framework on Web Standards. Cross-runtime: Cloudflare Workers, Deno, Bun, Node, AWS Lambda, Lambda@Edge, Vercel, Netlify, Azure Functions, Supabase Functions, etc.
- **Core abstractions (verbatim):**
  - `Hono` — app instance.
  - `Context` (`c`) — request/response handler context: `c.req`, `c.json()`, `c.text()`, `c.html()`, `c.html()`, etc.
  - `Handler` — `(c: Context) => Response | Promise<Response>`.
  - `Middleware` / `MiddlewareHandler` — pipeline interceptors.
  - `Router` — `RegExpRouter` (default), `TrieRouter` (alternative).
  - `Validator` — middleware for request validation; integrates natively with Zod via `@hono/zod-validator`.
  - **RPC mode** — type-safe client generation from server route definitions (similar to tRPC).
  - JSX support — server-side rendering.
- **API surface (representative TS):**
  ```typescript
  import { Hono } from 'hono';
  import { zValidator } from '@hono/zod-validator';
  import { z } from 'zod';

  const app = new Hono();

  app.use('*', async (c, next) => { /* logging middleware */ await next(); });

  app.post(
    '/webhooks/source/:source',
    zValidator('json', z.object({ event: z.string(), data: z.unknown() })),
    async (c) => {
      const { source } = c.req.param();
      const body = c.req.valid('json');
      // Verify HMAC, dispatch to Source<O>
      return c.json({ ok: true });
    }
  );

  export default app;
  ```
- **Built-in security middleware:** CORS, CSRF, Secure Headers, Bearer Auth, Basic Auth, JWT, JWK, IP Restriction, Request ID, ETag, compression, timeout.
- **What to lift:**
  - **Hono as the HTTP layer for `webhook-source` v0 adapter** — already in outline §11 v0 (`webhook-source — Hono-backed`). Confirmed.
  - **Zod validator middleware** → ADR6 boundary validation at the HTTP edge. Standard pattern.
  - **Cross-runtime Web Standards target** → kit's webhook-source can run anywhere kit's runtime targets reach (Node 20+, Bun-tested per CLAUDE.md).
  - **RPC mode** (typed client gen) → reference pattern; kit doesn't ship its own RPC mode but Composer-as-MCP pattern is conceptually similar.
- **What to avoid:**
  - Don't lift JSX rendering — pipeline-kit is library, not framework. UI rendering is downstream.
  - Don't lift Hono's full middleware stack as default — kit's webhook-source uses a minimal set (HMAC verify, body parse, dispatch).
  - Don't expose Hono as a public dependency in the kit's API surface — wrap it. Allows future swap if Hono evolves.
- **Stated non-goals:** Not stated explicitly in landing fetch. Hono's narrow scope (HTTP routing + middleware) is intentional.
- **License + community:** MIT. ~21k+ stars (well-known). Active maintenance; v4.x stable. Dominant edge-runtime TS framework.

### 39. CloudEvents v1.0.2 spec — `cloudevents/spec`
- **Purpose:** "CNCF specification for describing event data in common formats to provide interoperability across services, platforms and systems." Graduated CNCF project (Jan 2024). Primary deliverable: a vendor-neutral envelope for any event payload.
- **Core abstractions (verbatim, v1.0.2):**
  - **4 required attributes:** `id` (unique per source), `source` (URI-reference identifying event-producing context), `specversion` (e.g., `"1.0"`), `type` (event type, e.g., `com.github.pull_request.opened`).
  - **Optional attributes:** `datacontenttype`, `dataschema`, `subject`, `time` (RFC3339), `data` (payload).
  - **3 HTTP binding modes:** Binary (CE attrs as `Ce-*` HTTP headers + data as body), Structured (full event as JSON body), Batched (array of events).
  - **Format bindings:** JSON, Avro, Avro Compact, Protobuf, XML.
  - **Protocol bindings:** HTTP, AMQP, Kafka, MQTT, NATS, WebSockets.
  - **Webhook spec** — separate document `cloudevents/http-webhook.md` with abuse-protection + validation flow.
- **API surface (canonical JSON event):**
  ```json
  {
    "specversion": "1.0",
    "type": "com.example.pipeline.run.completed",
    "source": "https://pipeline-kit.example.com/runs",
    "id": "pk_run_abc123",
    "time": "2026-05-06T19:00:00Z",
    "datacontenttype": "application/json",
    "subject": "pipeline-trades-outbound",
    "data": { "atomCount": 42, "duration": 3.2 }
  }
  ```
- **What to lift:**
  - **4-attribute envelope** as inspiration for kit's response envelope (**ADR16**: `id`, `object`, `created_at`, `metadata`). pipeline-kit's existing envelope is Stripe-shaped (per Gatewerk's `ideas-to-steal.md`); cross-reference with CloudEvents shows mostly compatible — kit could output CloudEvents-formatted webhook payloads for `webhook-serve` adapter. **Possible Phase 2 ADR** — does pipeline-kit emit Stripe-shape, CloudEvents-shape, or dual?
  - **Structured vs Binary HTTP binding modes** → reference for `webhook-serve` adapter: structured-mode (whole event JSON in body) is simpler and aligns with Stripe-shape; binary-mode (CE-* headers) is for streaming-protocol interop.
  - **`subject`** field as scoping → kit's `Pipeline.run` ID could populate `subject` for fan-out tracing.
  - **Webhook spec validation flow** (abuse protection, OPTIONS preflight, allowed origins) → reference for `webhook-source` SSRF + intake hardening.
- **What to avoid:**
  - Don't adopt CloudEvents as the kit's mandatory output envelope — outline §7 ADR16 already locks Stripe-shape (id/object/created_at/metadata). CloudEvents is a webhook-emission option, not the core.
  - Don't lift the protocol-binding catalog (AMQP/Kafka/MQTT/NATS) — out of scope for v0.
- **Stated non-goals:** CloudEvents is a *spec*, not a runtime or SDK. Doesn't mandate event semantics, only envelope structure.
- **License + community:** Spec under CNCF (Apache 2.0). Industry-wide adoption: AWS, Azure, GCP, Knative, Argo, Tekton, etc. SDKs in 9 languages incl. JavaScript. **Critical for cross-system interop** if pipeline-kit serves into AWS EventBridge / Azure Event Grid / Knative — CloudEvents is the lingua franca.

### 40. Stripe webhook engineering — HMAC + tolerance window (REFERENCED via Gatewerk source 21)
- **Purpose:** Stripe-canonical webhook signing pattern: HMAC-SHA256 over `<timestamp>.<payload_body>`, header `Stripe-Signature: t=<unix>,v1=<hex>`, 5-minute tolerance window for replay protection.
- **Core abstractions:** `signature header` (multi-value, comma-separated) + `tolerance window` (default 300s) + `constant-time comparison`.
- **API surface (verification pattern):**
  ```typescript
  function verify(rawBody: string, header: string, secret: string, tolerance = 300): Event {
    const { t, v1 } = parseHeader(header);
    if (Math.abs(Date.now()/1000 - Number(t)) > tolerance) throw new Error('expired');
    const expected = hmacSha256(secret, `${t}.${rawBody}`);
    if (!constantTimeEqual(v1, expected)) throw new Error('invalid signature');
    return JSON.parse(rawBody);
  }
  ```
- **What to lift:** **Whole pattern → ADR17 webhook signing.** Already adopted by Gatewerk and inherited by pipeline-kit per outline §7. **Cross-reference Gatewerk's `ideas-to-steal.md` §3** for full pattern catalog incl. SDK webhook verification (`gw.webhooks.verify(rawBody, sigHeader, secret) → typed event`) + typed webhook events as discriminated unions. **Direct adoption.**
- **What to avoid:** Don't accept signatures without timestamp tolerance check (replay risk). Don't use `===` for hash comparison (timing attack).
- **Stated non-goals:** Stripe webhooks aren't event-bus-shaped; one webhook = one event. No batched delivery from Stripe's side.
- **License + community:** Stripe Node SDK MIT. Industry-canonical pattern.

### 41. Hatchet webhook patterns — multi-auth + encrypted secrets (REFERENCED via Gatewerk source 21 + source 5)
- **Purpose:** Hatchet's outbound webhook architecture: multi-auth (Basic / API Key / HMAC), encrypted secrets at rest, constant-time HMAC comparison.
- **Core abstractions:** Per-webhook auth method (selected at registration); secret stored encrypted (decrypted only at signing time); HMAC verify uses constant-time comparison.
- **What to lift:** **Multi-auth support → ADR17 extension.** pipeline-kit's `webhook-serve` adapter accepts auth method (HMAC default; Basic / Bearer / API Key as alternatives). Already in Gatewerk's `ideas-to-steal.md` §3 as a pattern. **Direct adoption.**
- **What to avoid:** Don't store secrets unencrypted. Don't allow auth method downgrade post-registration without explicit confirmation.
- **License + community:** Hatchet MIT. See source 5 for full reference.

### 42. Resend webhook verification SDK pattern (REFERENCED via Gatewerk source 21)
- **Purpose:** Resend SDK's webhook verification ergonomics: typed `gw.webhooks.verify(rawBody, sigHeader, secret) → typed event` returning a discriminated union (`'email.sent' | 'email.delivered' | 'email.bounced' | ...`).
- **Core abstractions:**
  - SDK method `webhooks.verify` — bundled into the resource-based client.
  - Typed event union — TS DX for switch-on-type.
- **API surface:**
  ```typescript
  const event = resend.webhooks.verify(rawBody, signatureHeader, webhookSecret);
  switch (event.type) {
    case 'email.sent': /* event.data is EmailSentData */ break;
    case 'email.bounced': /* ... */ break;
  }
  ```
- **What to lift:**
  - **SDK-bundled webhook verification** — pipeline-kit ships `pipelinekit.webhooks.verify(rawBody, sig, secret) → PipelineKitEvent` as part of the kit SDK. Saves users from re-implementing HMAC. **ADR17 extension.**
  - **Typed event union as SDK return** → TS DX pattern. **Confidence HIGH.**
- **What to avoid:** Don't expose raw HMAC primitives in SDK surface — bundle them.
- **License + community:** Resend SDK MIT. Industry-popular ergonomics pattern.

---

### Category VII — Synthesis

**Top 3 patterns to lift across HTTP/webhook/event category:**

1. **HMAC-SHA256 + timestamp tolerance window for webhook signing** (Stripe + Gatewerk + Hatchet converge unanimously). Maps to **ADR17**. Already adopted by Gatewerk; inherited by pipeline-kit. Multi-auth support (HMAC default; Basic/Bearer/API Key alternatives) per Hatchet's pattern. **Confidence HIGH.**

2. **SDK-bundled webhook verification with typed event union return** (Resend + Stripe SDK pattern). pipeline-kit ships `webhooks.verify(rawBody, sig, secret) → PipelineKitEvent` returning a discriminated union of event types. Maps to **ADR17 + ADR16 (SDK ergonomics)**. **Confidence HIGH.**

3. **Hono + Zod validator middleware** for `webhook-source` v0 adapter (per outline §11). Cross-runtime, type-safe, edge-friendly. Maps to **ADR6 + ADR17**. **Confidence HIGH.**

**Top 2 pitfalls to avoid:**

1. **Constant-time comparison failure** — `===` on HMAC strings is a timing-attack surface. Use `crypto.timingSafeEqual` or equivalent. Already in Gatewerk's `ideas-to-steal.md` §10.

2. **SSRF on incoming webhook URLs** — if `webhook-source` accepts user-configurable callback URLs, validate against private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x), normalize URLs (Unicode/encoding attacks), handle redirects safely. Already in Gatewerk's catalog §10.

**Implications for ADRs:**

- **ADR17 (webhook signing):** Strongly confirmed. HMAC-SHA256 + 5-min tolerance + constant-time comparison + multi-auth support + SDK-bundled verify. **Confidence HIGH.**
- **ADR6 (Zod boundary validation):** Reinforced — Hono + zod-validator middleware confirms Zod at HTTP edge. **Confidence HIGH.**
- **ADR16 (naming + envelope):** Cross-reference with CloudEvents — pipeline-kit's Stripe-shape envelope (id/object/created_at/metadata) is largely compatible with CloudEvents v1.0.2 (id/source/specversion/type/time/data). **Possible Phase 2 ADR addition: should `webhook-serve` emit CloudEvents-formatted payloads as an option?** Recommend YES for cross-system interop.

**Open questions for brain adjudication:**

1. **CloudEvents-formatted webhook payload as an option for `webhook-serve`?** Default is Stripe-shape; CloudEvents-shape as opt-in via config. Adds value for users serving into AWS EventBridge / Azure Event Grid / Knative ecosystems. *Brain recommend: YES, design as an opt-in mode for v1.*
2. **`webhook-source` runtime targets** — does it bundle Hono runtime startup or expose a request handler users plug into their own server? *Brain recommend: expose a Hono `app` instance OR a generic Web-Standards `(req: Request) => Promise<Response>` handler — both options. Userland chooses runtime.*
3. **Idempotency-key-via-webhook-header** — Stripe + Knock pattern requires `Idempotency-Key` HTTP header on POSTs. pipeline-kit's `webhook-source` adapter should accept and forward this to the dispatched stage. *Brain recommend: standard practice, no debate needed.*

---

