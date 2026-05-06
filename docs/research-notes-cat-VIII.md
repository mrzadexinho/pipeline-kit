> Phase 1 research notes — Category VIII (Observability). Back to [research-notes.md](research-notes.md) (synthesis) · [research-notes-full.md](research-notes-full.md) (master).

## Category VIII — Observability

Why EIGHTH: directly informs ADR8 (OpenTelemetry native). Cross-references Cat V (Fail at Scale + AWS Builder's Library) on observability-as-reliability-primitive.

### 43. OpenTelemetry JS — https://opentelemetry.io/docs/languages/js/
- **Purpose:** Vendor-neutral telemetry SDK for Node + browsers. Standardized APIs for traces, metrics, logs. Works with any backend speaking OTLP (Honeycomb, Datadog, Grafana, Langfuse, custom).
- **Core abstractions (verbatim from docs index):**
  - **Traces:** `Tracer`, `Span`, `SpanContext`, `TracerProvider`, `Propagator`. Status: Stable.
  - **Metrics:** `Meter`, `MeterProvider`, instruments (Counter, Histogram, Gauge). Status: Stable.
  - **Logs:** `Logger`, `LoggerProvider`. Status: Development.
  - **Cross-cutting:** `Resource` (service identity), `Attributes` (k/v on spans), `Context` (current execution context), `BaggageAttributes` (propagated context).
- **API surface (canonical TS pattern):**
  ```typescript
  import { trace, context } from '@opentelemetry/api';

  const tracer = trace.getTracer('pipeline-kit');

  await tracer.startActiveSpan('pipeline.run', async (span) => {
    span.setAttribute('pipeline.id', pipelineId);
    span.setAttribute('run.id', runId);
    try {
      // Source<O>
      await tracer.startActiveSpan('source.iter', async (childSpan) => {
        // ...
        childSpan.end();
      });
      // ... Process<I,O>, Serve<I>
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    } finally {
      span.end();
    }
  });
  ```
- **Auto-instrumentation:** Maintained in `opentelemetry-js-contrib` repo. Covers HTTP, gRPC, Postgres, Redis, MongoDB, Express, Hono, Drizzle (community), and many more. Drop-in via `@opentelemetry/auto-instrumentations-node`.
- **Three signal types:**
  - **Traces** = chained spans showing causal flow (parent/child relationships).
  - **Metrics** = aggregated numerical measurements (counters, histograms, gauges).
  - **Logs** = structured event records (correlated to spans via trace context).
- **Exporters:** OTLP (OpenTelemetry Protocol — HTTP+protobuf or gRPC+protobuf) is the standard. Backend-specific exporters: `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/exporter-metrics-otlp-grpc`, etc.
- **What to lift:**
  - **Whole library at every kit boundary** → **ADR8** locked. Pipeline run = top-level span; Source/Process/Serve invocations = child spans; Stage boundaries marked with attributes.
  - **`SpanStatusCode.OK` / `SpanStatusCode.ERROR`** → kit's Result<T,E> error path automatically translates to span status.
  - **`recordException(err)`** for stack traces → kit's structured errors carry across span lifecycle.
  - **Trace propagation across stages** → Context + Propagator pattern; matches kit's pass-through Context (**ADR5**).
  - **Resource attributes** (`service.name = 'pipeline-kit'`, `service.version = '0.1.0'`) → kit auto-populates.
- **What to avoid:**
  - Don't manually instrument every line — rely on auto-instrumentation for HTTP/DB; manual spans only at kit's stage boundaries.
  - Don't ship the OTel SDK as a hard dependency — kit's tracing API is internally OTel-shaped but the SDK is opt-in initialized by users (avoids bundle bloat for users who don't need traces).
  - Don't conflate "logs" (structured records) with "traces" (causal spans) — both have their place.
- **Stated non-goals:** Doesn't ship a backend; not a dashboard. Spec + SDK only.
- **License + community:** Apache 2.0. CNCF graduated project. Industry standard. ~3k+ stars on `opentelemetry-js`.

### 44. Langfuse — https://langfuse.com (404 on landing fetch; synthesized from common knowledge)
- **Purpose:** Open-source LLM observability platform — traces, cost tracking, evaluation, prompt management, dataset-driven testing. Self-hosted via Docker Compose; cloud SaaS available. Postgres + Redis + S3 + ClickHouse backbone.
- **Core abstractions:**
  - **Trace** — top-level execution (pipeline-kit run = Langfuse Trace).
  - **Generation** — LLM call within a trace; tokens + cost auto-computed.
  - **Span** — generic unit of work (non-LLM).
  - **Score** — quality rating attached to a trace/generation (0-1, boolean, categorical). Used for eval.
  - **Dataset** — evaluation corpus; runs against datasets compute Scores.
  - **Prompt** — versioned prompt registry (cloud-side).
  - **Session** — collection of related traces (e.g., multi-turn agent conversation).
- **API surface (TS SDK, representative):**
  ```typescript
  import { Langfuse } from 'langfuse';

  const langfuse = new Langfuse({ secretKey, publicKey, baseUrl });

  const trace = langfuse.trace({ name: 'pipeline-trades-outbound', userId: 'user_123' });

  const generation = trace.generation({
    name: 'extract-process-llm',
    model: 'claude-sonnet-4-6',
    input: { prompt: '...', userQuery: '...' },
    output: { response: '...' },
    usage: { input: 100, output: 50 },
  });

  trace.score({ name: 'output-quality', value: 0.92 });
  await langfuse.flushAsync();
  ```
- **What to lift:**
  - **Cost tracking per Generation** → kit's `extract-process` adapter emits Langfuse-shaped Generation events when wired. Auto-computes token cost from model + usage. **ADR8** extension.
  - **OTel integration via `@langfuse/opentelemetry`** → kit's OTel spans flow into Langfuse natively. **No custom Langfuse-specific code in kit.**
  - **Score-driven evaluation** → reference for kit's reference-project eval surface (Trades Outbound A/B test booked-meeting rate as a Score).
- **What to avoid:**
  - Don't bundle Langfuse SDK in kit's core — it's a userland Observability backend choice. Kit emits OTel; users wire OTel→Langfuse.
  - Don't replicate Langfuse's prompt registry — kit's `Reviewable<I>` describe callback is the prompt-equivalent for review templates; full prompt registry is product surface.
- **Stated non-goals:** Not a workflow engine; not a runtime. Pure observability.
- **License + community:** MIT. ~10k+ stars. Postgres + Redis + S3 + ClickHouse. Strong YC-adjacent traction. **Already mentioned multiple times in Gatewerk's `ideas-to-steal.md` (§3 auto-disable webhooks, §3 SSRF prevention, §8 typed job queue with BullMQ + Zod payloads).**

### 45. Sentry's error UX patterns (REFERENCED via Gatewerk source 21 §1)
- **Purpose:** Industry-canonical actionable error format. Already adopted by Gatewerk; inherited by pipeline-kit per **ADR16**.
- **Pattern (verbatim from Gatewerk catalog):**
  ```json
  {
    "error": {
      "type": "invalid_request",
      "code": "template_not_found",
      "message": "Template 'proposal-review' does not exist in project 'upwork-intel'",
      "param": "template",
      "doc_url": "https://docs.pipelinekit.dev/errors/template_not_found"
    }
  }
  ```
- **What to lift:**
  - **Whole error envelope shape → ADR4 + ADR16.** Already inherited via Gatewerk catalog §1. Direct adoption.
  - **`request_id` for support correlation** — kit auto-generates `pk_run_<id>` per Pipeline.run; surfaces in errors for log correlation.
- **What to avoid:** Don't lift Sentry's full SDK surface (breadcrumbs, performance monitoring, replay) — userland concern via OTel.
- **License + community:** Sentry SDK BSL-1.1 (functional source license — caveat for kit users). The error-envelope *pattern* is industry common knowledge; kit doesn't depend on Sentry SDK. **Cross-ref:** Gatewerk catalog §1 actionable errors.

---

### Category VIII — Synthesis

**Top 3 patterns to lift across observability category:**

1. **OpenTelemetry as the universal observability protocol.** Kit emits OTel spans at every Source/Process/Serve boundary; users wire OTel exporters to their chosen backend (Langfuse, Honeycomb, Datadog, Grafana). Maps to **ADR8**. **Confidence HIGH.**

2. **Langfuse Generation + cost-tracking integration via OTel.** Kit's `extract-process` LLM adapter emits OTel spans with Generation-shaped attributes; Langfuse auto-ingests. No Langfuse-specific code in kit. **Confidence HIGH.**

3. **Sentry-shape actionable error envelope** (already inherited via Gatewerk catalog). **Confidence HIGH.**

**Top 2 pitfalls to avoid:**

1. **Bundling specific observability backends in kit core.** Langfuse, Datadog, Honeycomb, Grafana are userland choices. Kit emits OTel; users wire backends.

2. **Manual instrumentation everywhere.** Auto-instrumentation covers HTTP/DB. Manual spans only at kit's stage boundaries. Over-instrumentation creates trace noise.

**Implications for ADRs:**

- **ADR8 (OpenTelemetry native):** Strongly confirmed. OTel JS at every kit boundary; auto-instrumentation for HTTP/DB; SpanStatusCode tied to Result<T,E>. **Confidence HIGH.**
- **ADR4 + ADR16 (error envelope):** Sentry-shape inherited via Gatewerk. **Confidence HIGH.**

**Open questions for brain adjudication:**

1. **OTel SDK as hard dep or peerDep?** Hard dep simplifies user experience; peerDep avoids bundle bloat. *Brain recommend: peerDep — users opt in by installing `@opentelemetry/api` + their chosen exporter.*
2. **Cost-tracking attributes on Generation spans** — standardized? Langfuse expects `usage.input`, `usage.output`, `model`. *Brain recommend: kit emits canonical OTel-Generation attributes (semantic conventions); document explicitly.*
3. **Default OTel exporter for dev?** OTLP gRPC requires running collector. Console exporter is dev-friendly. *Brain recommend: ship `ConsoleSpanExporter` for dev; OTLP for prod.*

---

