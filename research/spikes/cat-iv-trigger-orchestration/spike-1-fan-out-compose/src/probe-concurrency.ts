/**
 * Cat IV Spike #1 — probe-concurrency
 *
 * Probes Inngest's concurrency config in a fan-out scenario.
 * Parent fans out 20 items but concurrency limit is set to 3.
 *
 * Question (O3): does the limit apply to the PARENT or the CHILDREN?
 *
 * STRUCTURAL PREDICTION (O3):
 *   Concurrency config on the PARENT function limits how many INSTANCES of
 *   the parent function run concurrently (scoped by key expression).
 *   It does NOT limit the number of step.invoke() calls within a single run.
 *
 *   Concurrency on the CHILD function limits how many INSTANCES of the child
 *   function run concurrently. So to limit fan-out parallelism, the limit
 *   should be placed on the CHILD, not the parent.
 *
 *   If 20 step.invoke() calls are dispatched in Promise.all:
 *   - Parent has no step-level concurrency control over its own invocations
 *   - Child concurrency: if child has limit=3, Inngest queues 17 and runs 3
 *     at a time. No error — queuing, not rejection.
 *   [PENDING-RUN — requires Inngest Dev Server to observe queueing behavior]
 *
 * Note on concurrency key expression:
 *   `key: "event.data.pipelineId"` — all runs triggered by the same
 *   pipelineId share the concurrency slot. This prevents multiple concurrent
 *   runs of the same pipeline instance.
 */

import { InngestTestEngine } from "@inngest/test";
import { inngest } from "./inngest-client.js";
import {
  ok,
  type Result,
  type AggregatedOutput,
  type FanOutError,
  type ChildProcessOutput,
  type ChildError,
  type ItemInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// Parent function WITH concurrency config
// Concurrency applies at the parent function level (limits concurrent parents)
// ---------------------------------------------------------------------------

export const parentWithConcurrencyFn = inngest.createFunction(
  {
    id: "pipeline/fan-out-parent-concurrency",
    name: "Parent Fan-Out with Concurrency (Cat IV spike)",
    retries: 1,
    concurrency: [
      {
        // Limit: at most 1 concurrent parent run per pipelineId
        // (prevents duplicate pipeline runs for the same pipeline instance)
        limit: 1,
        key: "event.data.pipelineId",
        scope: "fn",
      },
    ],
  },
  { event: "pipeline/fan-out-requested" },
  async ({ event, step }): Promise<Result<AggregatedOutput, FanOutError>> => {
    const pipelineId = (event.data as { pipelineId: string; items: ItemInput[] }).pipelineId;
    const rawItems = (event.data as { items: ItemInput[] }).items;

    // Memoize items (replay safety)
    const items = await step.run("validate-source", async (): Promise<ItemInput[]> => {
      console.log(`[concurrency-parent] ${rawItems.length} items for pipelineId=${pipelineId}`);
      return rawItems;
    });

    // Fan-out — 20 children dispatched simultaneously via Promise.all
    // If each child has its own concurrency limit, Inngest queues the excess.
    // STRUCTURAL PREDICTION: dispatching 20 step.invoke() calls here does NOT
    // throw — they all enqueue successfully. The concurrency limit determines
    // how many EXECUTE simultaneously, not how many can be ENQUEUED.
    console.log(`[concurrency-parent] fanning out ${items.length} items via step.invoke()`);

    const childResults = await Promise.all(
      items.map((item) =>
        step.invoke(`child-${item.id}`, {
          function: childWithConcurrencyFn,
          data: { item },
        })
      )
    ) as Array<Result<ChildProcessOutput, ChildError>>;

    const aggregated = await step.run("aggregate-results", async (): Promise<AggregatedOutput> => {
      const succeeded = childResults.filter((r) => r.ok).length;
      const failed = childResults.filter((r) => !r.ok).length;
      return {
        pipelineId,
        totalItems: items.length,
        succeeded,
        failed,
        results: childResults,
        aggregatedAt: Date.now(),
      };
    });

    return ok(aggregated);
  }
);

// ---------------------------------------------------------------------------
// Child function WITH concurrency limit = 3
// This is where fan-out parallelism is controlled — on the child, not parent.
// ---------------------------------------------------------------------------

export const childWithConcurrencyFn = inngest.createFunction(
  {
    id: "pipeline/child-process-concurrency",
    name: "Child Pipeline with Concurrency Limit (Cat IV spike)",
    retries: 0,
    concurrency: [
      {
        // At most 3 children run concurrently across all pipelineIds
        // (global child-level concurrency control)
        limit: 3,
        scope: "fn",
      },
    ],
  },
  { event: "pipeline/child-process-concurrency" },
  async ({ event, step }): Promise<Result<ChildProcessOutput, ChildError>> => {
    const item = (event.data as { item: ItemInput }).item;

    const processed = await step.run(
      `process-${item.id}`,
      async (): Promise<ChildProcessOutput> => {
        console.log(`  [child-concurrency:${item.id}] processing`);
        return {
          itemId: item.id,
          processed: `PROCESSED:${item.payload.trim().toUpperCase()}`,
          processedAt: Date.now(),
        };
      }
    );

    return ok(processed);
  }
);

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

async function runProbe() {
  console.log("### Cat IV Spike #1 — probe-concurrency ###");
  console.log("=".repeat(60));
  console.log("\nConcurrency probe (O3): parent limit=1 per pipelineId; child limit=3 global");
  console.log("\nNOTE: concurrency enforcement requires Inngest Dev Server.");
  console.log("InngestTestEngine runs in-process — concurrency limits are NOT enforced.");
  console.log("This probe validates CODE SHAPE only (does the config compile/type-check?).");
  console.log("[PENDING-RUN for behavioral verification]");

  // Generate 20 items to probe whether the fan-out shape is correct at N=20
  const items: ItemInput[] = Array.from({ length: 20 }, (_, i) => ({
    id: `item-${String(i + 1).padStart(2, "0")}`,
    payload: `payload for item ${i + 1}`,
  }));

  const engine = new InngestTestEngine({ function: parentWithConcurrencyFn });

  try {
    const result = await engine.execute({
      events: [
        {
          name: "pipeline/fan-out-requested",
          data: { pipelineId: "pk_pipe_concurrency_test", items },
        },
      ],
      steps: items.map((item) => ({
        id: `child-${item.id}`,
        handler: async () =>
          ok({
            itemId: item.id,
            processed: `PROCESSED:${item.payload.toUpperCase()}`,
            processedAt: Date.now(),
          }),
      })),
    });

    const r = result.result as Result<AggregatedOutput, FanOutError> | undefined;
    if (r && r.ok) {
      console.log(`\n  RESULT: ok=true, fanned out ${r.value.totalItems} items`);
      console.log(`  CODE SHAPE: concurrency config compiles; 20-item fan-out wires correctly`);
      console.log(`\n  O3 STRUCTURAL PREDICTION (needs Dev Server to verify):`);
      console.log(`    - concurrency limit=1 on parent prevents duplicate pipeline runs`);
      console.log(`    - concurrency limit=3 on child queues excess invocations (no rejection)`);
      console.log(`    - the limit applies to CHILD execution slots, NOT to step.invoke() dispatch`);
      console.log(`    [PENDING-RUN]`);
    } else {
      console.log(`  RESULT: ${JSON.stringify(r ?? result.result)}`);
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.log(`\n  ERROR: ${msg.slice(0, 120)}`);
    console.log("  O3: [PENDING-RUN — concurrency behavior requires Dev Server]");
  }

  console.log("\n" + "=".repeat(60));
}

await runProbe();
