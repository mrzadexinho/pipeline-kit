/**
 * Cat IV Spike #3 — Probe: three-concerns separation
 *
 * Implements each of the three conflated concerns independently to confirm
 * they are genuinely orthogonal and owned by different layers.
 *
 * Cell 1: Concurrency control (runtime-owned)
 * Cell 2: Event deduplication (trigger/runtime boundary)
 * Cell 3: Singleton semantics (concurrency=1 vs explicit lock)
 */

import type {
  ConcurrencyConfig,
  RunGuard,
  SingletonPolicy,
  TriggerEvent,
  IdempotencyKey,
} from "./types.js";
import { makeIdempotencyKey, ok, err } from "./types.js";

// ---------------------------------------------------------------------------
// Cell 1 — CONCURRENCY CONTROL (runtime-owned)
// ---------------------------------------------------------------------------

/**
 * Concurrency config shape that kit declares; Inngest enforces.
 *
 * [STRUCTURAL-PREDICTION]: kit does NOT enforce this — it has no scheduler.
 * The adapter layer translates ConcurrencyConfig → Inngest function config.
 *
 * Key insight: concurrency=1 does NOT prevent a second run. It QUEUES the
 * second run. The second run WILL execute after the first completes.
 * This is fundamentally different from deduplication (which DROPS the second).
 */
function cell1_concurrencyControl(): void {
  console.log("=== Cell 1: Concurrency Control (runtime-owned) ===\n");

  // What kit declares:
  const kitRunGuard: RunGuard = {
    concurrency: {
      limit: 1,
      key: "event.data.pipelineId",
      overflow: "queue",
    },
  };

  // What the adapter-inngest translates this to (Inngest config shape):
  const inngestConcurrencyConfig = {
    concurrency: [
      {
        limit: kitRunGuard.concurrency!.limit,
        key: kitRunGuard.concurrency!.key,
        // scope: "fn" is Inngest's default
      },
    ],
  };

  console.log("Kit RunGuard (declaration):");
  console.log(JSON.stringify(kitRunGuard, null, 2));
  console.log("\nInngest translation (adapter-inngest owns this):");
  console.log(JSON.stringify(inngestConcurrencyConfig, null, 2));

  console.log(`
Interpretation:
  limit=1, key="event.data.pipelineId"
  → At most 1 concurrent run PER pipeline ID
  → If run A is active and run B fires for the same pipelineId:
      B is QUEUED (not rejected, not dropped)
      B executes after A completes
  → This is NOT dedup. B runs eventually.
  → N=5 would allow up to 5 concurrent runs per pipelineId.

Kit contribution: NONE to enforcement.
Kit only defines the ConcurrencyConfig shape.
Runtime (Inngest) enforces it.
  `);
}

// ---------------------------------------------------------------------------
// Cell 2 — EVENT DEDUPLICATION (trigger/runtime boundary)
// ---------------------------------------------------------------------------

/**
 * Scenario: webhook fires twice with the same payload within 1 second.
 *
 * Three options for who handles dedup:
 *   Option A: Inngest's `idempotency` field on function config
 *   Option B: kit's Composer checks a dedupKey before dispatching
 *   Option C: TriggerEvent envelope carries dedupKey; runtime checks
 *
 * Analysis: who has the information needed to compute the dedup key?
 */
function cell2_eventDeduplication(): void {
  console.log("\n=== Cell 2: Event Deduplication (trigger/runtime boundary) ===\n");

  // Scenario: webhook fires twice with identical payload
  interface WebhookPayload {
    event: string;
    resourceId: string;
    timestamp: number; // NOTE: may differ between fires if retried later
  }

  // Option A — Inngest's idempotency field (runtime-owned)
  // The key expression is evaluated by Inngest on the incoming event BEFORE
  // the function runs. If the same key was seen in the last 24h, the event
  // is dropped.
  const inngestFunctionConfigOptionA = {
    id: "process-webhook",
    // This expression is evaluated by Inngest — not by kit or the pipeline:
    idempotency: "event.data.resourceId",
    // Window: Inngest's built-in 24h dedup window (not configurable per-function)
  };

  // Option B — kit Composer checks dedupKey before dispatching
  // PROBLEM: By the time the Composer sees the event, the Inngest function has
  // already started executing. The check is INSIDE the run — too late for true dedup.
  // This would prevent duplicate WORK within the pipeline but not duplicate RUNS.
  // [STRUCTURAL-PREDICTION: Option B is wrong for true dedup]
  const optionBProblem = `
  Option B problem:
    Composer.dispatch(event) → Inngest calls the function → function runs → Composer checks dedupKey
    The run is already started. Checking inside the pipeline cannot prevent a second RUN.
    Option B only prevents duplicate MUTATIONS (output-side) — this is what Serve idempotency does.
    Option B ≠ input-side dedup.
  `;

  // Option C — TriggerEvent carries dedupKey; runtime enforces
  // This is the correct model. The trigger layer computes the key from the raw
  // event payload BEFORE dispatching to the runtime. The runtime (Inngest) checks
  // the key and drops duplicates BEFORE starting a new run.
  const webhookPayload: WebhookPayload = {
    event: "payment.succeeded",
    resourceId: "pay_12345",
    timestamp: Date.now(),
  };

  // Trigger layer computes the dedup key (content-hash or canonical field):
  const dedupKey: IdempotencyKey = makeIdempotencyKey(
    // Use stable, payload-derived fields — NOT timestamp (which may differ on retry)
    `webhook:payment.succeeded:pay_12345`
  );

  const triggerEvent: TriggerEvent<WebhookPayload> = {
    id: "pk_src_" + Math.random().toString(36).slice(2),
    object: "trigger_event",
    created_at: Date.now(),
    pipelineId: "pk_pipe_payment-processor",
    data: webhookPayload,
    dedupKey, // Computed here, at the trigger boundary — before pipeline runs
    metadata: {},
  };

  console.log("Webhook trigger event with dedup key:");
  console.log(JSON.stringify(triggerEvent, null, 2));

  console.log(`
${optionBProblem}
  Option C verdict:
    dedupKey is carried ON the TriggerEvent.
    The trigger adapter computes it from stable payload fields (not timestamp).
    Inngest receives the event with this key and enforces dedup.
    Kit-core defines TriggerEvent.dedupKey; trigger adapter fills it; runtime enforces.

  Who has the information to compute the dedup key?
    → Webhook trigger: dedupKey = hash(stable_fields_of_payload)
       Computable by the trigger adapter from raw HTTP body — BEFORE pipeline starts.
    → Cron trigger: dedupKey = pipelineId + ":" + scheduled_time
       Computable from cron metadata — BEFORE pipeline starts.
    → CloudEvent trigger: dedupKey = event.id
       Already in the CloudEvent envelope — BEFORE pipeline starts.

  Pattern: dedup key is ALWAYS available at the input boundary.
  It does NOT require running the pipeline to compute.
  → Dedup belongs at trigger/runtime layer, NOT inside kit-core Composer.
  `);
}

// ---------------------------------------------------------------------------
// Cell 3 — SINGLETON SEMANTICS (concurrency=1 vs explicit lock?)
// ---------------------------------------------------------------------------

/**
 * Scenario: cron fires at 00:00 but previous run (from 23:55) is still active.
 *
 * Three options:
 *   Option A: concurrency: [{ limit: 1, key: "pipelineId" }] — Inngest queues new run
 *   Option B: kit rejects the new run at Composer level (check run registry)
 *   Option C: TriggerEvent carries singletonKey; runtime enforces
 */
function cell3_singletonSemantics(): void {
  console.log("\n=== Cell 3: Singleton Semantics ===\n");

  // Option A — concurrency=1 (Inngest queues new run)
  const optionAConcurrencyConfig: ConcurrencyConfig = {
    limit: 1,
    key: "event.data.pipelineId",
    overflow: "queue",
  };

  // What actually happens with Option A:
  // - Run A starts at 23:55, completes at 00:05.
  // - Cron fires at 00:00. Inngest sees concurrency=1 for this pipelineId.
  // - Run B is QUEUED. It starts at 00:05 when Run A completes.
  // - Result: no overlap, but both runs execute. Run B is NOT dropped.
  console.log("Option A — concurrency=1 config:");
  console.log(JSON.stringify(optionAConcurrencyConfig, null, 2));
  console.log(`
  Behavior: Run B is QUEUED (executes after Run A finishes).
  This is the "queue" SingletonPolicy.
  Use case: "never run overlapping, but always catch up" (cron backfill).
  NOT suitable for: "skip the 00:00 run if 23:55 run is still active."
  `);

  // Option B — kit Composer checks a run registry
  // PROBLEM: requires kit-core to maintain a run registry (stateful side-effect).
  // Kit-core is functional — no shared mutable state.
  // Who owns the registry? A Store adapter (MemoryAdapter / DB).
  // But checking the registry is itself a step — inside the already-started run.
  // → Too late for true singleton enforcement.
  // [STRUCTURAL-PREDICTION: Option B requires a Store adapter, is NOT kit-core]
  console.log("Option B — kit Composer checks run registry:");
  console.log(`
  Problem: Composer is functional-core. It has no access to a run registry
  without a Store adapter. Checking the registry is a step inside the run
  (the run is already started when the check happens).
  This could DETECT overlap but cannot PREVENT the run from starting.
  → Overlap detection (within run) ≠ overlap prevention (before run starts).
  → Kit Composer should NOT maintain singleton locks. That's the runtime's job.
  `);

  // Option C — TriggerEvent carries singletonKey; runtime enforces
  // Inngest's concurrency with key IS the singleton mechanism.
  // The "key" expression IS the singletonKey concept.
  // No new kit primitive needed.
  const singletonPolicy: SingletonPolicy = { type: "reject" };
  const runGuardWithSingleton: RunGuard = {
    concurrency: {
      limit: 1,
      key: "event.data.pipelineId",
      overflow: "reject", // REJECT the 00:00 run if 23:55 run is still active
    },
    singleton: singletonPolicy,
  };

  console.log("Option C — singleton via concurrency overflow:reject:");
  console.log(JSON.stringify(runGuardWithSingleton, null, 2));
  console.log(`
  Behavior: Run B is REJECTED immediately (not queued).
  This is the "reject" SingletonPolicy — true singleton.
  Inngest enforces via concurrency overflow:reject.

  Summary of three options:
    | Option | Mechanism           | Second run outcome | Kit-core role |
    |--------|---------------------|--------------------|---------------|
    | A      | concurrency=1,queue | Queued, runs later | Declare config |
    | B      | Composer registry   | Cannot prevent     | None (too late) |
    | C      | concurrency=1,rej.  | Dropped immediately| Declare config |

  Verdict: both A and C are correct for their use cases.
  Both are runtime-enforced via Inngest concurrency config.
  Kit-core declares the RunGuard; runtime enforces.
  `);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function main(): void {
  cell1_concurrencyControl();
  cell2_eventDeduplication();
  cell3_singletonSemantics();

  console.log(`
=== PROBE SUMMARY ===

Three concerns are ORTHOGONAL:
  1. Concurrency control → runtime (Inngest concurrency limit)
  2. Deduplication       → trigger (compute dedupKey) + runtime (enforce window)
  3. Singleton           → runtime (concurrency=1 + overflow policy)

Kit-core role in all three: DECLARE INTENT (RunGuard config shape).
Kit-core does NOT enforce any of them.

Critical distinction:
  concurrency=1 + overflow:queue  = "run sequentially, never skip" (Option A)
  concurrency=1 + overflow:reject = "true singleton, skip overlapping" (Option C)
  dedup key + window              = "drop identical events, never re-run" (Cell 2)

All three have different semantics. Conflating them causes bugs.
  `);
}

main();
