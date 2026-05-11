/**
 * Cat IV Spike #3 — Probe: kit boundary
 *
 * Where kit's responsibility for concurrent-run / idempotency concerns ends.
 *
 * Boundary map:
 *   kit-core owns:    IdempotencyKey type + generation helpers + Serve-side checking (v0, done)
 *   kit-core defines: RunGuard config shape (singleton / bounded / unbounded) as Composer option
 *   runtime owns:     enforcement (Inngest concurrency, Temporal WorkflowIdReusePolicy)
 *   trigger owns:     input-side dedup key computation (at TriggerEvent boundary)
 *
 * This probe shows the minimal API kit needs to add (if any) to express run guards,
 * and confirms what is already done (v0 Serve idempotency).
 */

import { createHash, createHmac } from "node:crypto";
import type { RunGuard, TriggerEvent, IdempotencyKey } from "./types.js";
import { makeIdempotencyKey, ok, err } from "./types.js";
import type { Result } from "./types.js";

// ---------------------------------------------------------------------------
// §1. What kit-core already owns (v0 — done, no changes needed)
// ---------------------------------------------------------------------------

/**
 * v0 Serve idempotency — ALREADY IMPLEMENTED (ADR pattern from v0).
 * This is the OUTPUT-SIDE of kit's idempotency story.
 *
 * Mechanism: HMAC-SHA256 + timestamp tolerance
 *   1. Client signs request: HMAC-SHA256(secret, body + timestamp)
 *   2. Serve adapter verifies HMAC + checks timestamp within tolerance
 *   3. Idempotency key (from header or body hash) is stored in a cache
 *   4. Duplicate requests within the cache TTL return cached response
 *
 * This probe shows the existing pattern (structural — no actual storage).
 */

interface ServeIdempotencyContext {
  readonly idempotencyKey: IdempotencyKey;
  readonly timestamp: number;
  readonly hmacSignature: string;
}

/**
 * Kit v0 pattern: extract and verify Serve idempotency context from HTTP request.
 * [STRUCTURAL — mirrors what @idriszade/serve-* adapters implement]
 */
function extractServeIdempotencyContext(
  requestBody: string,
  headers: Record<string, string>,
  secret: string,
  timestampToleranceMs = 5 * 60 * 1000 // 5 minutes
): Result<ServeIdempotencyContext, { code: string; message: string }> {
  const rawTimestamp = headers["x-pipeline-timestamp"];
  const rawSignature = headers["x-pipeline-signature"];
  const rawIdempotencyKey = headers["idempotency-key"];

  if (!rawTimestamp || !rawSignature) {
    return err({ code: "missing_signature_headers", message: "x-pipeline-timestamp and x-pipeline-signature required" });
  }

  const timestamp = parseInt(rawTimestamp, 10);
  if (isNaN(timestamp)) {
    return err({ code: "invalid_timestamp", message: "x-pipeline-timestamp must be a Unix epoch milliseconds value" });
  }

  const now = Date.now();
  if (Math.abs(now - timestamp) > timestampToleranceMs) {
    return err({ code: "timestamp_out_of_tolerance", message: `Request timestamp outside ${timestampToleranceMs}ms tolerance window` });
  }

  // Recompute HMAC — HMAC-SHA256(secret, body + timestamp)
  const expectedHmac = createHmac("sha256", secret)
    .update(requestBody + rawTimestamp)
    .digest("hex");

  if (rawSignature !== expectedHmac) {
    return err({ code: "invalid_signature", message: "HMAC signature verification failed" });
  }

  const idempotencyKey: IdempotencyKey = rawIdempotencyKey
    ? makeIdempotencyKey(`serve:client:${rawIdempotencyKey}`)
    : makeIdempotencyKey(`serve:body-hash:${createHash("sha256").update(requestBody).digest("hex").slice(0, 16)}`);

  return ok({ idempotencyKey, timestamp, hmacSignature: rawSignature });
}

// ---------------------------------------------------------------------------
// §2. What kit-core needs to ADD (minimal new surface for RunGuard)
// ---------------------------------------------------------------------------

/**
 * The minimal new API kit needs to expose for run-guard semantics.
 *
 * [STRUCTURAL-PREDICTION]: only these additions are needed:
 *   1. RunGuard type (already defined in types.ts)
 *   2. IdempotencyKey type + makeIdempotencyKey (already in types.ts)
 *   3. TriggerEvent<T> with dedupKey field (already in types.ts)
 *   4. ComposerOptions.runGuard — the Composer accepts a RunGuard config
 *
 * NO new enforcement code in kit-core. Only type declarations.
 */

// Minimal addition to ComposerOptions (what kit-core would add):
interface ComposerOptions<I, O> {
  readonly pipelineId: string;
  readonly source: unknown;   // Source<I>
  readonly process: unknown;  // Process<I, O>
  readonly serve?: unknown;   // Serve<O>
  // NEW — the minimal addition for run-guard semantics:
  readonly runGuard?: RunGuard;
}

/**
 * What the adapter-inngest layer does with ComposerOptions.runGuard:
 * Translates RunGuard into Inngest function config.
 */
function translateRunGuardToInngest(runGuard: RunGuard): Record<string, unknown> {
  const inngestConfig: Record<string, unknown> = {};

  if (runGuard.concurrency) {
    inngestConfig["concurrency"] = [
      {
        limit: runGuard.concurrency.limit ?? 1,
        ...(runGuard.concurrency.key ? { key: runGuard.concurrency.key } : {}),
      },
    ];
  }

  if (runGuard.dedup) {
    // Inngest's idempotency field: an expression evaluated on the incoming event
    // The expression references the TriggerEvent.dedupKey field
    inngestConfig["idempotency"] = "event.data.dedupKey";
  }

  if (runGuard.singleton?.type === "reject") {
    // Override concurrency overflow to reject (not queue)
    if (Array.isArray(inngestConfig["concurrency"])) {
      // Inngest doesn't have a direct "overflow:reject" config — this is a simplification
      // The real mechanism: combine concurrency=1 with a dedup key on pipelineId
      inngestConfig["__kit_singleton_reject"] = true;
    }
  }

  return inngestConfig;
}

// ---------------------------------------------------------------------------
// §3. Trigger layer owns input-side dedup key computation
// ---------------------------------------------------------------------------

/**
 * The trigger adapter computes the dedupKey and puts it on TriggerEvent.
 * Kit-core does NOT compute it — it only defines the TriggerEvent shape.
 *
 * This is the clean boundary: trigger adapter fills dedupKey; kit-core
 * types it; runtime enforces it.
 */

function buildTriggerEventFromWebhook<T>(
  pipelineId: string,
  rawPayload: T,
  stableKeyFields: string // caller identifies which fields are stable
): TriggerEvent<T> {
  const dedupKey = makeIdempotencyKey(
    "webhook:" + createHash("sha256").update(stableKeyFields).digest("hex").slice(0, 16)
  );
  return {
    id: `pk_src_${Math.random().toString(36).slice(2, 10)}`,
    object: "trigger_event",
    created_at: Date.now(),
    pipelineId,
    data: rawPayload,
    dedupKey, // Trigger adapter fills this — kit-core types it
    metadata: {},
  };
}

function buildTriggerEventFromCron<T>(
  pipelineId: string,
  data: T,
  scheduledAt: Date
): TriggerEvent<T> {
  const dedupKey = makeIdempotencyKey(
    `cron:${pipelineId}:${scheduledAt.getTime()}`
  );
  return {
    id: `pk_src_${Math.random().toString(36).slice(2, 10)}`,
    object: "trigger_event",
    created_at: Date.now(),
    pipelineId,
    data,
    dedupKey,
    scheduledAt: scheduledAt.getTime(),
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// §4. Demonstrate the complete boundary
// ---------------------------------------------------------------------------

function demonstrateBoundary(): void {
  console.log("=== Kit Boundary Map ===\n");

  // v0 Serve idempotency — already done
  const serveResult = extractServeIdempotencyContext(
    '{"action":"charge","amount":1000}',
    {
      "x-pipeline-timestamp": String(Date.now()),
      // In a real request: valid HMAC would be computed here
      // For probe purposes: skip HMAC validation by using a test value
      "x-pipeline-signature": "probe-mode-skip",
      "idempotency-key": "idem-pay-abc123",
    },
    "test-secret"
  );
  // Note: will fail HMAC check in probe — that's expected; showing the shape
  console.log("v0 Serve idempotency (output-side) — already done:");
  console.log("  Shape:", serveResult.ok ? "ok" : `err(${serveResult.error.code})`);
  console.log("  [This is the existing v0 pattern — no changes needed]\n");

  // New: trigger adapter fills dedupKey
  const webhookEvent = buildTriggerEventFromWebhook(
    "pk_pipe_payment",
    { event: "payment.succeeded", resourceId: "pay_12345" },
    "payment.succeeded:pay_12345"
  );
  console.log("Trigger adapter builds TriggerEvent with dedupKey:");
  console.log("  pipelineId:", webhookEvent.pipelineId);
  console.log("  dedupKey:", webhookEvent.dedupKey);
  console.log("  [Trigger adapter fills this; kit-core only types it]\n");

  // New: RunGuard declared on Composer options
  const composerOptions: ComposerOptions<unknown, unknown> = {
    pipelineId: "pk_pipe_payment",
    source: null,
    process: null,
    runGuard: {
      concurrency: { limit: 1, key: "event.data.pipelineId", overflow: "queue" },
      dedup: { period: "24h" },
    },
  };

  const inngestConfig = translateRunGuardToInngest(composerOptions.runGuard!);
  console.log("RunGuard → Inngest config translation (adapter-inngest):");
  console.log("  Kit RunGuard:", JSON.stringify(composerOptions.runGuard, null, 4));
  console.log("  Inngest config:", JSON.stringify(inngestConfig, null, 4));
  console.log("  [adapter-inngest owns this translation; kit-core only declares the shape]\n");

  // Cron trigger
  const cronEvent = buildTriggerEventFromCron(
    "pk_pipe_nightly",
    { reportDate: "2026-05-10" },
    new Date("2026-05-10T00:00:00Z")
  );
  console.log("Cron TriggerEvent:");
  console.log("  scheduledAt:", cronEvent.scheduledAt);
  console.log("  dedupKey:", cronEvent.dedupKey);
}

// ---------------------------------------------------------------------------
// §5. Final boundary statement
// ---------------------------------------------------------------------------

function printBoundarySummary(): void {
  console.log(`
=== BOUNDARY SUMMARY ===

kit-core OWNS (existing — v0 done):
  - IdempotencyKey type + makeIdempotencyKey()
  - Serve-side idempotency context extraction (HMAC-SHA256 + timestamp tolerance)
  - Result<T,E> contract flowing through Serve adapters

kit-core ADDS (minimal new surface):
  - RunGuard type (ConcurrencyConfig + SingletonPolicy + DedupWindow)
  - TriggerEvent<T> with optional dedupKey field
  - ComposerOptions.runGuard (declaration only; no enforcement in kit-core)

trigger adapter OWNS:
  - dedupKey computation from raw event data (webhook hash, cron pipelineId:time, cloudevent.id)
  - Building TriggerEvent with dedupKey populated

adapter-inngest OWNS:
  - RunGuard → Inngest function config translation
  - ConcurrencyConfig → inngest concurrency[] array
  - DedupWindow → inngest idempotency expression string

runtime (Inngest) OWNS:
  - Concurrency enforcement (queue / reject overflow)
  - Event-level dedup (24h window, keyed on dedupKey expression)
  - Singleton enforcement (concurrency=1 per key)

WHAT KIT-CORE DOES NOT OWN:
  - Any enforcement of concurrency limits
  - Any dedup storage or key lookup
  - Any lock acquisition for singleton runs
  - Run registry or run state tracking

[STRUCTURAL-PREDICTION]: the RunGuard addition is a pure type-system change.
No runtime code added to kit-core. The Composer passes RunGuard through to the
adapter layer, which translates it into runtime-specific config.
  `);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function main(): void {
  demonstrateBoundary();
  printBoundarySummary();
}

main();
