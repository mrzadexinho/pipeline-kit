> Phase 1 research notes — Category V (Reliability patterns). Back to [research-notes.md](research-notes.md) (synthesis) · [research-notes-full.md](research-notes-full.md) (master).

## Category V — Reliability patterns

Why FIFTH: foundational patterns informing ADR3 (durable execution), ADR9 (idempotency), ADR10 (backpressure), ADR13 (retry), ADR18 (audit). Cross-references heavily with Categories I (durable executors) and VII (webhook signing).

### 28. Outbox Pattern — https://microservices.io/patterns/data/transactional-outbox.html
- **Purpose:** Solves dual-write problem — atomically update database state AND publish messages to a broker without distributed transactions (2PC).
- **Core mechanic:** Service writes business entity update + outgoing message to outbox table in same DB transaction. Separate message-relay process polls outbox, publishes messages, marks published. **Guarantee:** "Messages are guaranteed to be sent if and only if the database transaction commits."
- **Core abstractions:** Outbox table schema `(id, message_payload, published_flag, created_at, published_at)`. **Two relay implementations:** Polling Publisher (simpler, higher latency) vs Transaction Log Tailing (CDC-style, more infra). Consumer-side dedup by message ID is mandatory.
- **What to lift:**
  - **Outbox pattern for `Serve<I>` adapters that mutate external state** → reliable-emit in v1 durable adapter. Maps to **ADR9 + ADR3 + ADR18**.
  - **Polling Publisher first** (simpler infra) → v1; Transaction Log Tailing as v2 option.
  - **Composes with Saga** for multi-system writes (Outbox = single-DB→multi-broker; Saga = multi-DB orchestration).
- **What to avoid:**
  - Don't try this at v0 — Composer is sync in-process; Outbox makes sense only when crossing process boundaries.
  - Don't lift "Eventuate Tram" framework (Java) — pattern is portable; impl is per-language.
  - Outbox doesn't dedup downstream — consumers MUST be idempotent (cross-reference Stripe pattern source 30).
- **Stated non-goals:** Doesn't handle consumer-side dedup; doesn't replace Saga.
- **License + community:** Pattern catalog (Chris Richardson, microservices.io). Foundational reference; widely cited.

### 29. Saga Pattern — https://microservices.io/patterns/data/saga.html
- **Purpose:** Distributed transaction across microservices without 2PC. Maintains data consistency when business operation spans multiple service-owned databases.
- **Core mechanic — two coordination styles:**
  - **Choreography:** each local transaction publishes domain events that trigger next local transaction in another service.
  - **Orchestration:** central orchestrator tells participants which local transactions to execute.
- **Compensating transactions:** on local-transaction failure (business rule violation), saga executes compensating transactions in reverse order. **Manual design** — no automatic rollback.
- **Resulting context:**
  - Solved: data consistency across services without 2PC.
  - **Not solved:** lack of automatic rollback (compensating logic is manual); lack of isolation (concurrent sagas risk anomalies; need countermeasures like semantic locks).
- **What to lift:**
  - **Orchestration pattern** for kit v2 multi-system Serve composition (`PipelineServe.saga(...)`). Outline §11 v2 lists "Saga-pattern multi-system writes."
  - **ACD vs ACID** pragmatism — accept Atomicity + Consistency + Durability without Isolation; document tradeoff in spec.
  - **Compensating transaction as first-class** in `Serve<I>` v2 — adapter declares `emit()` AND `compensate()`.
- **What to avoid:**
  - Don't ship Saga in v0 or v1 — outline §11 explicitly v2. Premature complexity.
  - Don't choose Choreography by default for kit users; Orchestration aligns better with Composer's central-coordinator role.
- **Stated non-goals:** Saga doesn't provide ACID isolation; doesn't replace Outbox (they compose).
- **License + community:** Pattern catalog (Chris Richardson). Foundational reference.

### 30. Stripe idempotency-key engineering — https://stripe.com/blog/idempotency
- **Purpose:** Canonical 2017 blog establishing idempotency keys as industry-standard for safely-retryable mutating API calls. Pattern adopted by Stripe SDK, Knock, Resend, Gatewerk; pipeline-kit inherits.
- **Core mechanic:**
  - Client passes unique ID via `Idempotency-Key` HTTP header on POST endpoints.
  - Server caches result of first request with that key.
  - Subsequent requests with same key return cached result; no re-execution.
- **Edge cases handled:** Connection failure pre-server (key new on retry); mid-operation failure (server recovers state, ACID rollback → safe to retry wholesale); response loss (server replies with cached success on retry).
- **What to lift:**
  - **Whole pattern → ADR9.** Already adopted via Gatewerk's `ideas-to-steal.md` §1. Direct inheritance.
  - **Auto-generate idempotency keys at SDK layer** (Knock pattern, also in Gatewerk catalog) — kit's SDK auto-generates UUIDs for mutating calls so users don't have to.
  - **Pair with exponential backoff + jitter on retry** (Stripe SDK does this) → cross-references with AWS reliability source 31.
- **What to avoid:**
  - **No explicit TTL specified** in Stripe's article — pipeline-kit MUST define explicit cache window (recommend 24h default; configurable).
  - **Key collision risk** if users reuse keys (e.g., generate from non-unique input). Kit warns when key derives from request body hash; kit accepts opaque keys verbatim.
  - **Stale-data replay** — if cached response was 200 but downstream state has changed, replay returns stale. Document explicitly.
- **Stated non-goals:** Doesn't provide write-through dedup at downstream system level; request-level only.
- **License + community:** Industry-canonical. Stripe Node SDK MIT.

### 31. AWS Builder's Library — Timeouts, Retries, Backoff with Jitter
- **Purpose:** Authoritative AWS guide on coordinating timeouts, retries, and exponential backoff with jitter to prevent cascading failures + resource exhaustion under load.
- **Three core patterns:**
  - **Timeouts** — set max wait based on downstream's latency percentile (e.g., p99.9, accept 0.1% false-timeout rate). Prevents resource starvation.
  - **Retries** — recover from transient failures, but "retries are selfish": they increase backend load during overload, potentially worsening recovery. Safe ONLY for idempotent operations.
  - **Exponential backoff + jitter** — `min(cap, base * 2^attempt) + random(0, backoff)`. Desynchronizes retries; avoids thundering herd.
- **Retry budget / token-bucket:** AWS SDK (2016) uses token-bucket — allows retries while tokens available, throttles to fixed rate when exhausted. Bounds retry load without modal circuit-breaker complexity.
- **Idempotency requirement:** "APIs with side effects aren't safe to retry unless they provide idempotency." Cross-reference source 30.
- **Canonical recommendations (table-form for ADR13):**
  | Param | Recommendation |
  |---|---|
  | Base delay | 100ms |
  | Max delay | 10-32s (capped exponential) |
  | Max attempts | 3-5 retries |
  | Formula | `min(cap, base * 2^attempt)` |
  | Jitter | `random(0, backoff)` |
  | RetryAfter header | Always respect |
  | Idempotency token | Mandatory for mutations |
- **What to lift:**
  - **All recommendations → ADR13 retry policy default.** Direct adoption.
  - **Token-bucket retry budget** → kit-level circuit breaker analog. Outline §11 v0 lists "circuit breaker" in Composer; AWS pattern is the canonical implementation.
  - **Deterministic jitter per-host for scheduled work** — interesting addendum for v2 `Schedule` Source adapters.
- **What to avoid:**
  - Don't lift modal circuit-breaker pattern — token-bucket is simpler. (Hatchet's RateLimit primitive is also token-bucket.)
  - Don't retry non-idempotent operations — kit MUST refuse retries on `Serve<I>` adapters that don't accept idempotency keys.
- **Stated non-goals:** Doesn't replace per-call timeout tuning; doesn't substitute for upstream load-shedding.
- **License + community:** AWS Builder's Library publicly accessible architectural guidance.

### 32. "Fail at Scale" — Ben Maurer (Facebook Engineering, ACM Queue 2015)
- **Purpose:** Foundational paper on the three primary causes of large-scale failures and the mitigation patterns. **Note: queue.acm.org/detail.cfm?id=2839461 returned HTTP 403; note synthesized from paper's well-known content (Maurer was Facebook's reliability lead; paper is industry-canonical).**
- **Three main causes of scale failures:**
  - **Rapid deployment of changes** — bad deploys hit large fleets quickly. Mitigation: controlled rollout (canary, percentage-based), automatic rollback on health-check failure.
  - **Hardware failures** — at scale, hardware fails constantly; software must tolerate. Mitigation: redundancy, fast failure detection, graceful degradation.
  - **Latency creep / load shifts** — small latency increases cascade into queue buildup. Mitigation: dynamic capacity (load shedding), strict timeouts, retry budgets.
- **Key concepts:**
  - **Thundering herd:** synchronized retries hammer a recovering server. Solution: jitter (cross-reference source 31).
  - **Metastable failure:** system enters degraded state from which it cannot recover without intervention (e.g., retry storm pinning CPU at 100%). Solution: load shedding, circuit breakers, retry budgets.
- **Mitigation pattern stack:** controlled deployment + automatic rollback / dynamic capacity (load shedding) / strict timeouts / retry budgets / structured observability.
- **Observability requirements:** error rate per service / latency percentiles (p50/p95/p99/p99.9) / queue depth / retry rate / load shedding rate. Without these, incident response is blind.
- **What to lift:**
  - **Retry budget concept** → reinforces source 31's token-bucket. **ADR13 + ADR10** convergence.
  - **Metastable failure framing** → kit users should understand retries-without-budget can pin a system. Document explicitly in spec.
  - **Observability requirements** → **ADR8** OpenTelemetry native: traces with parent/child + structured logs + percentile metrics. Outline §12 test plan already mandates OTel spans.
  - **Graceful degradation** → kit's Serve<I> adapters should support a `fallback` mode (route to dead-letter, log + skip) for persistent failures. Outline §11 v0 includes this.
- **What to avoid:**
  - Don't ship reliability features without observability to verify them — flying blind.
  - Don't conflate "retry forever" with "reliable" — bounded retries + circuit breaker > infinite retries.
- **Stated non-goals:** Paper is descriptive + prescriptive; not a runtime spec.
- **License + community:** ACM Queue paper (paywalled abstract); industry-canonical reading.

---

### Category V — Synthesis

**Top 3 patterns to lift across reliability category:**

1. **Idempotency-key + exponential-backoff-with-jitter + retry-budget (token-bucket).** Stripe + AWS + Fail at Scale + Inngest + Hatchet all converge. Maps to **ADR9 + ADR10 + ADR13**. Direct adoption. **Confidence HIGH.**

2. **Outbox pattern for reliable Serve emit in v1 durable adapter.** Solves dual-write at the kit's `Store<T>`-to-`Serve<I>` boundary when state crosses process boundaries. Maps to **ADR3** (durable v1) + **ADR18** (audit log). **Confidence HIGH for v1.**

3. **Observability as a reliability primitive, not an add-on.** Fail at Scale + AWS Builder's Library + all 5 architecture references converge: traces + percentile metrics + structured logs are not optional. Maps to **ADR8** OpenTelemetry native. **Confidence HIGH.**

**Top 2 pitfalls to avoid:**

1. **Retries without budget = thundering herd / metastable failure.** Token-bucket caps retry load. Kit MUST ship retry budget by default; users opt-out only with explicit acknowledgment.

2. **Idempotency without TTL or scope contract = stale-replay risk.** Stripe doesn't specify TTL; kit MUST. Recommend 24h default + configurable; document scope (key matches request body fingerprint or only header).

**Implications for ADRs:**

- **ADR9 (idempotency convention):** Strongly confirmed. Kit auto-generates keys for `Serve<I>` adapters; auto-pairs with exp-backoff-with-jitter on retry. **Confidence HIGH.**
- **ADR10 (backpressure / token-bucket):** Strongly confirmed at Source AND Serve boundary. Token-bucket = retry budget = rate-limit; same primitive. **Confidence HIGH.**
- **ADR13 (retry policy):** AWS canonical defaults adopted. Per-stage policy + global default + override. Base 100ms / max 10-32s / max 3-5 attempts / RetryAfter respected / idempotency required for retry. **Confidence HIGH.**
- **ADR3 (sync v0, durable v1):** Outbox + Saga frame the v1 durable adapter design. v1 ships Outbox-style reliable emit; v2 ships Saga orchestration. **Confidence HIGH for sequencing.**
- **ADR18 (audit log via `Audited<I,O>`):** Outbox table schema `(id, payload, published_flag, ...)` is the audit log shape. Direct reference. **Confidence HIGH.**

**Open questions for brain adjudication:**

1. **Retry budget shape** — global per-Pipeline (composer-level) or per-Stage (adapter-level) or both? *Brain recommend: both. Stage default is bounded; composer enforces aggregate limit.*
2. **Idempotency TTL default** — 24h reasonable? Stripe doesn't specify. *Brain recommend: 24h default; document explicitly. Regulated verticals (healthcare, finance) may want longer.*
3. **Saga v2 vs Outbox v1 sequencing** — does v1 ship Outbox-only, then v2 add Saga? Or both at v1? *Brain recommend: v1 Outbox only; v2 Saga (per outline §11). Saga complexity earns its own milestone.*
4. **Circuit breaker primitive** — outline §11 v0 lists "circuit breaker" alongside token-bucket. AWS pattern says token-bucket subsumes circuit breaker for most cases. *Brain recommend: token-bucket primary; explicit circuit breaker as opt-in for users who want hard-trip semantics.*
5. **Dead-letter queue for `Serve<I>` failures** — outline §11 lists "Fallback / dead-letter on persistent failure" in §3.5. Where does it live? *Brain recommend: per-Serve adapter config (`onPersistentFailure: 'log' | 'route-to' | 'halt'`); kit ships default 'log' with structured error.*

---

