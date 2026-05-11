/**
 * Cat IV Spike #3 — Probe: Temporal WorkflowIdReusePolicy mapped to kit
 *
 * Temporal has a rich policy vocabulary for how workflow ID collisions are handled.
 * This probe maps each Temporal policy to kit's equivalent and asks:
 *   - Which policies does kit need to EXPRESS (in its type system)?
 *   - Which does it DELEGATE to the runtime?
 *
 * [STRUCTURAL-PREDICTION]: kit expresses the policy shape (SingletonPolicy);
 * the runtime (Inngest/Temporal) enforces it. Kit does NOT implement the policies.
 */

import type { SingletonPolicy, RunGuard, ConcurrencyConfig } from "./types.js";

// ---------------------------------------------------------------------------
// §1. Temporal WorkflowIdReusePolicy → kit mapping
// ---------------------------------------------------------------------------

/**
 * Temporal's WorkflowIdReusePolicy governs what happens when a new workflow
 * is started with the same workflow ID as an existing/historical one.
 *
 * Source: Temporal docs §WorkflowIdReusePolicy
 */
type TemporalWorkflowIdReusePolicy =
  | "ALLOW_DUPLICATE"             // Always start new, even if same ID exists (completed)
  | "REJECT_DUPLICATE"            // Error if this workflow ID was EVER used
  | "TERMINATE_IF_RUNNING"        // Kill the running instance; start new
  | "ALLOW_DUPLICATE_FAILED_ONLY"; // Only re-run if the previous run FAILED

/**
 * Kit SingletonPolicy equivalents.
 *
 * Key observation: not all Temporal policies map cleanly to Inngest's primitive set.
 * Some require adapter-level implementation, some are native.
 */
type KitEquivalent = {
  readonly policy: SingletonPolicy | null;
  readonly inngestNative: boolean;
  readonly inngestMechanism: string;
  readonly kitCoreRole: "declare-only" | "none" | "adapter-impl-needed";
  readonly notes: string;
};

const policyMapping: Record<TemporalWorkflowIdReusePolicy, KitEquivalent> = {
  ALLOW_DUPLICATE: {
    // No dedup, no singleton — every trigger fires a new run regardless
    policy: null,
    inngestNative: true,
    inngestMechanism: "No concurrency config, no idempotency key",
    kitCoreRole: "none",
    notes:
      "Default behavior. Kit-core does nothing; runtime runs all triggers. " +
      "No RunGuard needed.",
  },

  REJECT_DUPLICATE: {
    // Infinite-window dedup: if this workflow ID EVER existed, reject
    // Kit equivalent: idempotency key with permanent=true DedupWindow
    policy: { type: "reject" },
    inngestNative: false,
    inngestMechanism:
      "Inngest's idempotency has a 24h window — NOT infinite. " +
      "Permanent dedup requires an external store (Store adapter / DB lookup). " +
      "Inngest native = NO for infinite window.",
    kitCoreRole: "adapter-impl-needed",
    notes:
      "Kit can express SingletonPolicy:{type:'reject'} but enforcement of " +
      "infinite-window dedup requires a Store adapter (e.g., orchestr8 MemoryAdapter " +
      "or DB). Inngest's 24h window is sufficient for most webhook dedup cases.",
  },

  TERMINATE_IF_RUNNING: {
    // Cancel the current run; start a new one
    // No native Inngest equivalent — requires a cancel signal mechanism
    policy: { type: "terminate" },
    inngestNative: false,
    inngestMechanism:
      "Inngest has no TERMINATE_IF_RUNNING primitive. " +
      "Closest: cancel a running function via Inngest cancel endpoint, " +
      "then start new. Requires orchestration outside the function.",
    kitCoreRole: "adapter-impl-needed",
    notes:
      "The most complex policy. Kit can express it but adapter-inngest would need " +
      "to call Inngest's management API to cancel the running function. " +
      "Not a common case for kit's target workloads (cron/webhook automation). " +
      "DEFER to v1.x — not needed for v1 reference adapters.",
  },

  ALLOW_DUPLICATE_FAILED_ONLY: {
    // Re-run only if the previous run failed — conditional dedup
    // Kit equivalent: conditional re-run with check-last-result logic
    policy: { type: "conditional", condition: "previous-failed" },
    inngestNative: false,
    inngestMechanism:
      "Inngest has no native conditional re-run based on previous result. " +
      "Requires: store previous run result → check on new trigger → conditionally enqueue. " +
      "Implementable via Store adapter (MemoryAdapter / DB) + trigger-level guard.",
    kitCoreRole: "adapter-impl-needed",
    notes:
      "Useful for retry-on-failure patterns. Kit can express it; enforcement " +
      "requires a Store adapter check at the trigger boundary. " +
      "Candidate for v1 if a reference project needs it — not baseline v1.",
  },
};

// ---------------------------------------------------------------------------
// §2. Which policies does kit NEED to express vs delegate?
// ---------------------------------------------------------------------------

/**
 * Analysis: minimum viable RunGuard for kit v1.
 *
 * Use cases by frequency (for cron/webhook automation):
 *   1. Bounded parallelism (concurrency=N) — VERY COMMON
 *   2. Sequential singleton (concurrency=1, queue) — COMMON for cron jobs
 *   3. True singleton (concurrency=1, reject overlap) — COMMON for exclusive pipelines
 *   4. Webhook dedup (idempotency key, 24h window) — COMMON for webhook triggers
 *   5. Permanent dedup (REJECT_DUPLICATE) — RARE for kit's target use cases
 *   6. Terminate-and-replace — RARE
 *   7. Conditional re-run — RARE
 *
 * Verdict: kit v1 needs to express policies 1-4.
 * Policies 5-7 are deferred to adapter-level implementation or v1.x.
 */

function demonstratePolicyMapping(): void {
  console.log("=== §1. Temporal Policy → Kit Mapping ===\n");

  for (const [temporalPolicy, equiv] of Object.entries(policyMapping)) {
    console.log(`Temporal: ${temporalPolicy}`);
    console.log(`  Kit policy:       ${JSON.stringify(equiv.policy)}`);
    console.log(`  Inngest native:   ${equiv.inngestNative}`);
    console.log(`  Kit-core role:    ${equiv.kitCoreRole}`);
    console.log(`  Inngest mechanism: ${equiv.inngestMechanism}`);
    console.log(`  Notes: ${equiv.notes}`);
    console.log();
  }
}

// ---------------------------------------------------------------------------
// §3. Minimum viable RunGuard for kit v1
// ---------------------------------------------------------------------------

function demonstrateMinimumViableRunGuard(): void {
  console.log("=== §2. Minimum Viable RunGuard for Kit v1 ===\n");

  // Covers the 4 common cases:
  const examples: Array<{ name: string; runGuard: RunGuard; temporalEquivalent: string }> = [
    {
      name: "Unbounded parallelism (default)",
      runGuard: {},
      temporalEquivalent: "ALLOW_DUPLICATE (no policy set)",
    },
    {
      name: "Bounded parallelism (N=5 per pipeline)",
      runGuard: {
        concurrency: { limit: 5, key: "event.data.pipelineId", overflow: "queue" },
      },
      temporalEquivalent: "ALLOW_DUPLICATE with worker slot limits",
    },
    {
      name: "Sequential singleton (queue new run)",
      runGuard: {
        concurrency: { limit: 1, key: "event.data.pipelineId", overflow: "queue" },
        singleton: { type: "queue" },
      },
      temporalEquivalent: "No exact Temporal equivalent — closest: single-thread worker",
    },
    {
      name: "True singleton (reject overlapping run)",
      runGuard: {
        concurrency: { limit: 1, key: "event.data.pipelineId", overflow: "reject" },
        singleton: { type: "reject" },
      },
      temporalEquivalent: "TERMINATE_IF_RUNNING with reject-not-terminate semantics",
    },
    {
      name: "Webhook dedup (24h window via Inngest)",
      runGuard: {
        dedup: { period: "24h" },
      },
      temporalEquivalent: "Temporal WorkflowId dedup (no exact window equivalent)",
    },
  ];

  for (const ex of examples) {
    console.log(`  ${ex.name}:`);
    console.log(`    RunGuard:           ${JSON.stringify(ex.runGuard)}`);
    console.log(`    Temporal equivalent: ${ex.temporalEquivalent}`);
    console.log();
  }

  console.log(`
Summary:
  Kit v1 needs to EXPRESS 5 shapes in RunGuard.
  All 5 are runtime-enforced (Inngest native or adapter-level translation).
  Kit-core does NOT implement enforcement — it is a declaration, not a lock.

  What kit-core owns:
    - RunGuard type definition
    - IdempotencyKey type + generation helpers
    - TriggerEvent.dedupKey field

  What adapter-inngest owns:
    - RunGuard → Inngest function config translation
    - ConcurrencyConfig → Inngest concurrency array
    - DedupWindow → Inngest idempotency expression

  What adapter-temporal would own (future):
    - RunGuard → Temporal WorkflowOptions translation
    - SingletonPolicy → WorkflowIdReusePolicy mapping

  Policies 5-7 (permanent dedup, terminate, conditional):
    - Not in v1 baseline
    - Expressible in kit type system but enforcement deferred
    - Mark as "adapter-impl-needed" in ADR
  `);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function main(): void {
  demonstratePolicyMapping();
  demonstrateMinimumViableRunGuard();
}

main();
