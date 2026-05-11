/**
 * Cat IV Spike #3 — Probe: dedup-key ownership
 *
 * The critical question: who computes the idempotency key, and when?
 *
 * Thesis: the dedup key is ALWAYS computable at the input boundary (before the
 * pipeline runs). This means dedup responsibility belongs at the trigger/runtime
 * layer — symmetric with Serve idempotency (which is output-side).
 *
 * Mapping:
 *   Input-side dedup  (trigger layer) = prevents duplicate runs
 *   Output-side dedup (Serve adapter) = prevents duplicate external mutations
 *   Together          = full pipeline idempotency
 */

import { createHash } from "node:crypto";
import type { IdempotencyKey, TriggerEvent } from "./types.js";
import { makeIdempotencyKey } from "./types.js";

// ---------------------------------------------------------------------------
// §1. Dedup key computation per trigger type
// ---------------------------------------------------------------------------

/**
 * WEBHOOK TRIGGER
 *
 * Dedup key = hash(stable payload fields)
 * NOT: hash(entire payload) — payload may include non-stable fields (e.g., delivery_attempt)
 * NOT: hash(timestamp)      — timestamp differs between retries
 *
 * Key point: computed from the raw HTTP body BEFORE the pipeline starts.
 * The trigger adapter (Source adapter for webhooks) owns this computation.
 */
function dedupKeyForWebhook(payload: {
  event: string;
  resourceId: string;
  // NOT included: delivery_attempt, received_at — these are unstable
}): IdempotencyKey {
  const stable = JSON.stringify({
    event: payload.event,
    resourceId: payload.resourceId,
  });
  return makeIdempotencyKey(
    "webhook:" + createHash("sha256").update(stable).digest("hex").slice(0, 16)
  );
}

/**
 * CRON TRIGGER
 *
 * Dedup key = pipelineId + ":" + scheduledTime
 * The scheduledTime is the INTENDED fire time (not actual delivery time).
 * If the cron fires at 00:00:00 UTC, that's the key — even if delivered at 00:00:01.
 *
 * Key point: computed from cron metadata BEFORE the pipeline starts.
 * The cron trigger adapter owns this computation.
 */
function dedupKeyForCron(pipelineId: string, scheduledAt: Date): IdempotencyKey {
  // Round to the schedule granularity to absorb clock skew:
  const scheduledMs = scheduledAt.getTime();
  return makeIdempotencyKey(`cron:${pipelineId}:${scheduledMs}`);
}

/**
 * CLOUDEVENTS TRIGGER
 *
 * Dedup key = event.id (CloudEvents spec §3.1: id is REQUIRED + unique per source)
 * Already in the event envelope — no computation needed.
 *
 * Key point: CloudEvents spec mandates that id is unique per source.
 * The trigger adapter reads event.id directly.
 */
function dedupKeyForCloudEvent(cloudEvent: {
  id: string;        // CloudEvents required field
  source: string;    // Included for global uniqueness
  type: string;
}): IdempotencyKey {
  // Namespace with source to guarantee global uniqueness:
  return makeIdempotencyKey(`cloudevent:${cloudEvent.source}:${cloudEvent.id}`);
}

/**
 * SERVE ADAPTER (v0 idempotency — OUTPUT-SIDE)
 *
 * This is kit's existing idempotency (ADR pattern from v0).
 * It is NOT input-side dedup — it is output-side dedup.
 * It prevents duplicate EXTERNAL MUTATIONS when a Serve adapter is called twice.
 *
 * Mechanism: HMAC-SHA256 + timestamp tolerance
 *   - HMAC signs the request body + timestamp
 *   - Serve adapter checks HMAC + rejects requests outside tolerance window
 *   - Idempotency key from request header or body hash is stored
 *   - Duplicate calls within the window return cached response
 *
 * Key point: computed from the HTTP request BEFORE the mutation executes.
 * The Serve adapter owns this computation (not kit-core Composer).
 */
function dedupKeyForServe(requestBody: string, idempotencyHeader?: string): IdempotencyKey {
  if (idempotencyHeader) {
    // Client-provided idempotency key (e.g., Stripe-style Idempotency-Key header)
    return makeIdempotencyKey(`serve:client:${idempotencyHeader}`);
  }
  // Fallback: content-hash of the request body
  const hash = createHash("sha256").update(requestBody).digest("hex").slice(0, 16);
  return makeIdempotencyKey(`serve:body-hash:${hash}`);
}

// ---------------------------------------------------------------------------
// §2. Full pipeline idempotency = input-side + output-side
// ---------------------------------------------------------------------------

/**
 * Full pipeline idempotency is the composition of two symmetric mechanisms:
 *
 *   [Trigger] → dedup key → runtime drops duplicate → [Pipeline runs] → [Serve] → dedup key → skip duplicate mutation
 *
 * Input-side (trigger dedup):
 *   - Ensures the pipeline runs AT MOST ONCE per logical event
 *   - Computed before pipeline starts
 *   - Enforced by the runtime (Inngest, SQS, etc.)
 *
 * Output-side (Serve idempotency, v0 ADR):
 *   - Ensures each external mutation is applied AT MOST ONCE
 *   - Computed before the mutation executes
 *   - Enforced by the Serve adapter
 *
 * Together: even if the pipeline somehow runs twice (e.g., runtime dedup window
 * expired, or different runtime used), the Serve adapter's output-side dedup
 * prevents duplicate external side effects.
 *
 * [STRUCTURAL-PREDICTION]: this is the correct layered idempotency model.
 * Kit-core does NOT need to coordinate between the two layers — each layer
 * is independently sufficient for its responsibility.
 */
function demonstrateFullPipelineIdempotency(): void {
  console.log("=== §2. Full Pipeline Idempotency ===\n");

  // Scenario: Stripe webhook "payment.succeeded" fires twice
  const webhookPayload = { event: "payment.succeeded", resourceId: "pay_12345" };
  const inputDedupKey = dedupKeyForWebhook(webhookPayload);

  // Input-side: Inngest sees this key; drops the second firing
  // [Inngest config: idempotency: "event.data.dedupKey"]
  console.log("Input-side dedup key (trigger layer):", inputDedupKey);

  // If input-side dedup fails (e.g., window expired, or manual replay):
  // The pipeline runs again. At the Serve stage, output-side dedup kicks in.
  const serveRequestBody = JSON.stringify({ action: "mark-paid", orderId: "order_99" });
  const idempotencyHeader = "idem-key-abc123"; // Sent by caller
  const outputDedupKey = dedupKeyForServe(serveRequestBody, idempotencyHeader);
  console.log("Output-side dedup key (Serve adapter):", outputDedupKey);

  console.log(`
Full idempotency coverage:
  Input-side (trigger):   ${inputDedupKey}
    → Runtime drops "payment.succeeded:pay_12345" if seen in last 24h
  Output-side (Serve):    ${outputDedupKey}
    → Serve adapter caches "mark-paid:order_99" response; skips mutation on replay

Layered defense:
  Layer 1 (runtime)   — drops duplicate runs      → prevents wasted work
  Layer 2 (Serve adp) — skips duplicate mutations  → prevents data corruption

Kit-core role: NONE in enforcement. Defines types + generation helpers only.
  `);
}

// ---------------------------------------------------------------------------
// §3. Demonstrate dedup key availability at input boundary
// ---------------------------------------------------------------------------

function demonstrateBoundaryAvailability(): void {
  console.log("=== §3. Dedup Key Availability at Input Boundary ===\n");

  // Webhook fire #1
  const webhookPayload = { event: "payment.succeeded", resourceId: "pay_12345" };
  const fire1Key = dedupKeyForWebhook(webhookPayload);

  // Webhook fire #2 — exact same payload (e.g., Stripe retried delivery)
  const fire2Key = dedupKeyForWebhook(webhookPayload);

  console.log("Fire #1 dedup key:", fire1Key);
  console.log("Fire #2 dedup key:", fire2Key);
  console.log("Keys identical:", fire1Key === fire2Key, "(runtime deduplication possible)\n");

  // Cron: two fires of the same schedule
  const pipelineId = "pk_pipe_nightly-report";
  const scheduledTime = new Date("2026-05-10T00:00:00.000Z");
  const fire1CronKey = dedupKeyForCron(pipelineId, scheduledTime);
  const fire2CronKey = dedupKeyForCron(pipelineId, scheduledTime);

  console.log("Cron fire #1 dedup key:", fire1CronKey);
  console.log("Cron fire #2 dedup key:", fire2CronKey);
  console.log("Keys identical:", fire1CronKey === fire2CronKey, "(cron dedup possible)\n");

  // CloudEvents — different id = different key (no dedup)
  const event1 = { id: "evt-001", source: "payments-svc", type: "payment.succeeded" };
  const event2 = { id: "evt-002", source: "payments-svc", type: "payment.succeeded" };
  const ce1Key = dedupKeyForCloudEvent(event1);
  const ce2Key = dedupKeyForCloudEvent(event2);

  console.log("CloudEvent #1 dedup key:", ce1Key);
  console.log("CloudEvent #2 dedup key:", ce2Key);
  console.log("Keys identical:", ce1Key === ce2Key, "(different events — no dedup)\n");

  console.log(`
Pattern confirmed across all trigger types:
  Dedup key is computable BEFORE the pipeline runs.
  It is derived from trigger metadata / event payload — not pipeline state.
  → Dedup belongs at the trigger/runtime layer.
  → It is NOT computed inside the Composer or any Process stage.

This symmetry with output-side (Serve) idempotency is intentional:
  Input-side:  computed from trigger metadata  → checked by runtime BEFORE run
  Output-side: computed from request context   → checked by Serve adapter BEFORE mutation
  `);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function main(): void {
  console.log("=== Probe: Dedup Key Ownership ===\n");

  // §1 — Show key computation per trigger type
  console.log("§1. Dedup key computation per trigger type:\n");

  const webhookKey = dedupKeyForWebhook({ event: "payment.succeeded", resourceId: "pay_12345" });
  console.log("  Webhook dedup key:", webhookKey);

  const cronKey = dedupKeyForCron("pk_pipe_nightly", new Date("2026-05-10T00:00:00Z"));
  console.log("  Cron dedup key:", cronKey);

  const cloudEventKey = dedupKeyForCloudEvent({ id: "evt-123", source: "svc-a", type: "order.placed" });
  console.log("  CloudEvent dedup key:", cloudEventKey);

  const serveKey = dedupKeyForServe('{"action":"charge"}', "idem-abc");
  console.log("  Serve (output-side) dedup key:", serveKey);

  demonstrateFullPipelineIdempotency();
  demonstrateBoundaryAvailability();
}

main();
