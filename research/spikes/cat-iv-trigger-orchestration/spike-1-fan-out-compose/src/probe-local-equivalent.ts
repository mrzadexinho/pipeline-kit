/**
 * Cat IV Spike #1 — probe-local-equivalent
 *
 * Pure in-process equivalent of the fan-out pattern — no Inngest.
 * Uses Promise.allSettled() so ALL child outcomes are available
 * regardless of individual failures.
 *
 * Purpose (O7): show the local-prod seam. The same fan-out shape
 * expressed without durable execution. Delta = what Inngest adds.
 *
 * Run: bun run src/probe-local-equivalent.ts
 */

import {
  ok,
  err,
  makeAtom,
  type Result,
  type AggregatedOutput,
  type ChildProcessOutput,
  type ChildError,
  type ItemInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// Mini-pipeline (pure function — no Inngest)
// ---------------------------------------------------------------------------

async function runChildPipeline(
  item: ItemInput,
  options: { failItemIds?: string[] } = {}
): Promise<Result<ChildProcessOutput, ChildError>> {
  const { failItemIds = [] } = options;

  // Stage 1 — Extract
  const raw = item.payload.trim().toUpperCase();

  if (failItemIds.includes(item.id)) {
    return err({
      code: "child_item_rejected",
      itemId: item.id,
      message: `item ${item.id} is in the reject list`,
    });
  }

  // Stage 2 — Process
  const processed: ChildProcessOutput = {
    itemId: item.id,
    processed: `PROCESSED:${raw}`,
    processedAt: Date.now(),
  };

  // Stage 3 — Wrap (atom envelope available for observability)
  const atom = makeAtom<ChildProcessOutput>(`pk_atom_local_${item.id}`, processed);
  void atom; // returned separately in production; here we return Result

  return ok(processed);
}

// ---------------------------------------------------------------------------
// Local fan-out using Promise.allSettled
// (the local-prod seam equivalent of step.invoke())
// ---------------------------------------------------------------------------

async function runLocalFanOut(
  items: ItemInput[],
  options: { failItemIds?: string[] } = {}
): Promise<Result<AggregatedOutput, never>> {
  console.log(`[local-fan-out] fanning out ${items.length} items via Promise.allSettled()`);

  // O7 KEY DELTA — Promise.allSettled vs Inngest step.invoke():
  //   Local:   Promise.allSettled() — all outcomes, no abort on failure
  //   Inngest: Promise.all(step.invoke()) — short-circuits on function-level throw
  //            but NOT on Result.err return (child must return Result.err, not throw)
  //
  // To match allSettled semantics in Inngest:
  //   Child functions MUST return Result.err (never throw at function level).
  //   Parent uses Promise.all (which won't short-circuit on Result.err returns).
  //   This is the correct composition pattern.
  //
  // The seam is thin: local = Promise.allSettled over direct fn calls
  //                   prod  = Promise.all over step.invoke() calls
  //                   both produce the same Array<Result<T,E>>
  const settled = await Promise.allSettled(
    items.map((item) => runChildPipeline(item, options))
  );

  // Normalise PromiseSettledResult → Result<T,E>
  // (in production, step.invoke() results are already Result<T,E> — no wrapping needed)
  const results: Array<Result<ChildProcessOutput, ChildError>> = settled.map((outcome) => {
    if (outcome.status === "fulfilled") {
      return outcome.value;
    }
    // Rejected = the child function itself threw (shouldn't happen if children
    // return Result.err, but guard for robustness)
    return err({
      code: "child_process_failed",
      itemId: "unknown",
      message: String(outcome.reason),
    });
  });

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log(`[local-fan-out] settled: succeeded=${succeeded} failed=${failed}`);

  return ok({
    pipelineId: "pk_pipe_local_test",
    totalItems: items.length,
    succeeded,
    failed,
    results,
    aggregatedAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

async function runProbe() {
  console.log("### Cat IV Spike #1 — probe-local-equivalent ###");
  console.log("=".repeat(60));
  console.log("\nLocal-prod seam (O7): pure in-process fan-out — no Inngest.");

  const items: ItemInput[] = [
    { id: "item-a", payload: "  hello world  " },
    { id: "item-b", payload: "foo bar baz" },
    { id: "item-c", payload: "spike test" },
    { id: "item-d-fail", payload: "this one fails" },
  ];

  // =========================================================================
  // EXPERIMENT A — all succeed
  // =========================================================================
  console.log("\n--- EXP A: All items succeed ---");
  const resultA = await runLocalFanOut(items.slice(0, 3));
  if (resultA.ok) {
    console.log(`  succeeded=${resultA.value.succeeded} failed=${resultA.value.failed}`);
    for (const r of resultA.value.results) {
      if (r.ok) {
        console.log(`    ok  ${r.value.itemId}: ${r.value.processed}`);
      }
    }
  }

  // =========================================================================
  // EXPERIMENT B — mixed (one fails)
  //
  // O7 DELTA ILLUSTRATION:
  //   Local: allSettled collects all 4 outcomes including the failure
  //   Inngest (Promise.all + step.invoke + Result.err child): same — 4 outcomes
  //   Inngest (Promise.all + step.invoke + child throws): 3 outcomes + parent aborts
  //   → Children MUST use Result.err, NOT throw, for allSettled-equivalent semantics
  // =========================================================================
  console.log("\n--- EXP B: Mixed (item-d-fail returns Result.err) ---");
  const resultB = await runLocalFanOut(items, { failItemIds: ["item-d-fail"] });
  if (resultB.ok) {
    console.log(`  succeeded=${resultB.value.succeeded} failed=${resultB.value.failed}`);
    for (const r of resultB.value.results) {
      if (r.ok) {
        console.log(`    ok   ${r.value.itemId}: ${r.value.processed}`);
      } else {
        console.log(`    err  ${r.error.itemId}: ${r.error.message}`);
      }
    }
  }

  // =========================================================================
  // O7 SHAPE COMPARISON SUMMARY
  // =========================================================================
  console.log("\n--- O7: Local-prod shape comparison ---");
  console.log(`
  LOCAL (this file):
    const settled = await Promise.allSettled(items.map(runChildPipeline));
    // → Array<PromiseSettledResult<Result<T,E>>>

  INNGEST (parent-fan-out.ts):
    const childResults = await Promise.all(
      items.map(item => step.invoke(\`child-\${item.id}\`, { function: childFn, data: { item } }))
    );
    // → Array<Result<T,E>>   (if child returns Result.err, not throws)

  DELTA:
    1. step.invoke() adds durability: child progress is checkpointed per step
    2. step.invoke() adds replay safety: step IDs are stable across parent replays
    3. step.invoke() adds observability: each child run visible in Dev Server UI
    4. Inngest Promise.all requires child to return Result.err (not throw) for
       allSettled-equivalent semantics — this is the key ergonomic constraint

  SEAM THICKNESS: thin. Same Result<T,E> type flows through both paths.
  Kit Composer can target either path with the same output contract.
  `);

  console.log("=".repeat(60));
}

await runProbe();
