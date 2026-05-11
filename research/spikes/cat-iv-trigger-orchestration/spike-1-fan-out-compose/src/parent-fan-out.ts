/**
 * Cat IV Spike #1 — parent-fan-out
 *
 * Parent Inngest function: fan-out N items to N child functions via
 * step.invoke(), then aggregate results.
 *
 * Pipeline shape:
 *   step 1 (validate-source)   — memoize items array (replay safety per ADR-v1-I-6)
 *   step 2 (fan-out via invoke) — Promise.all(items.map(step.invoke))
 *   step 3 (aggregate-results) — collect child results, build AggregatedOutput
 *
 * Probe goals:
 *   O1 — Type signature: does step.invoke() return type flow as Result<T,E>?
 *   O2 — Error isolation: one child throws → do siblings complete?
 *   O5 — Replay safety: do step IDs from step.invoke() stay stable on replay?
 *   O6 — Kit Composer fit: does this need a new primitive?
 *
 * STRUCTURAL PREDICTIONS embedded inline — see comments.
 *
 * Run (after `bun install`): bun run src/parent-fan-out.ts
 * Requires @inngest/test (InngestTestEngine) — no Dev Server needed.
 */

import { InngestTestEngine } from "@inngest/test";
import { inngest } from "./inngest-client.js";
import { childFn, failingChildFn } from "./child-pipeline.js";
import {
  ok,
  err,
  type Result,
  type AggregatedOutput,
  type FanOutError,
  type ChildProcessOutput,
  type ChildError,
  type ItemInput,
} from "./types.js";

// ---------------------------------------------------------------------------
// Parent function factory
// (accepts child function reference so tests can swap implementations)
// ---------------------------------------------------------------------------

export function buildParentFanOutFn(
  childFunction: typeof childFn | typeof failingChildFn = childFn
) {
  return inngest.createFunction(
    {
      id: "pipeline/fan-out-parent",
      name: "Parent Fan-Out (Cat IV spike)",
      retries: 2,
    },
    { event: "pipeline/fan-out-requested" },
    async ({ event, step }): Promise<Result<AggregatedOutput, FanOutError>> => {
      const pipelineId = (event.data as { pipelineId: string; items: ItemInput[] }).pipelineId;
      const rawItems = (event.data as { items: ItemInput[] }).items;

      // -----------------------------------------------------------------------
      // STEP 1 — validate-source
      //
      // Memoize the items array so dynamic step IDs are stable across replays.
      // Structural prediction (O5): same as ADR-v1-I-6 (memoize source before
      // using its content in step IDs). Without this, items from a DB query
      // could differ across replays, breaking Inngest's step ID matching.
      // -----------------------------------------------------------------------
      const items = await step.run(
        "validate-source",
        async (): Promise<ItemInput[]> => {
          // In a real pipeline: validate with Zod, emit source atoms, etc.
          if (!rawItems || rawItems.length === 0) {
            throw new Error("kit:step_error code=empty_source_items");
          }
          console.log(`[parent] validated ${rawItems.length} items for pipelineId=${pipelineId}`);
          return rawItems;
        }
      );

      // -----------------------------------------------------------------------
      // STEP 2 — fan-out via step.invoke()
      //
      // STRUCTURAL PREDICTION (O1):
      //   step.invoke() returns the child function's return value, typed.
      //   The return type here should be Array<Result<ChildProcessOutput, ChildError>>.
      //   No `any` needed if the child function's return type is correct.
      //
      // STRUCTURAL PREDICTION (O2):
      //   Promise.all rejects on first child function failure (a child that
      //   throws at the Inngest function level, not a child that returns Result.err).
      //   A child returning Result.err({ ... }) is NOT a function-level failure —
      //   it's a successful function return with an error-shaped value.
      //   So: to get allSettled-style behavior, each child MUST catch its own
      //   errors and return Result.err rather than throw. The failingChildFn
      //   variant throws inside step.run() which triggers Inngest retry, NOT
      //   a function-level throw visible to Promise.all.
      //   [PENDING-RUN — need empirical confirmation of this distinction]
      //
      // STRUCTURAL PREDICTION (O5):
      //   step.invoke(`child-${item.id}`, ...) uses item.id as part of the step ID.
      //   Since items is memoized in step 1, item.id is stable across replays.
      //   This satisfies ADR-v1-I-6's replay-safety requirement.
      // -----------------------------------------------------------------------
      const childResults = await Promise.all(
        items.map((item) =>
          step.invoke(`child-${item.id}`, {
            function: childFunction,
            data: { item },
          })
        )
      ) as Array<Result<ChildProcessOutput, ChildError>>;

      console.log(`[parent] all ${childResults.length} step.invoke() calls settled`);

      // -----------------------------------------------------------------------
      // STEP 3 — aggregate-results
      //
      // Collect child results into an AggregatedOutput.
      // Note: since Promise.all is used, if any step.invoke() raises a function-
      // level error, we never reach here. For allSettled semantics, the parent
      // would need to catch per-invoke (see probe-local-equivalent.ts for the
      // local analogy).
      // -----------------------------------------------------------------------
      const aggregated = await step.run("aggregate-results", async (): Promise<AggregatedOutput> => {
        const succeeded = childResults.filter((r) => r.ok).length;
        const failed = childResults.filter((r) => !r.ok).length;

        console.log(`[parent] aggregate: succeeded=${succeeded} failed=${failed}`);

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
}

// ---------------------------------------------------------------------------
// Test harness — run as standalone script
// ---------------------------------------------------------------------------

async function runSpike() {
  console.log("### Cat IV Spike #1 — parent-fan-out ###");
  console.log("=".repeat(60));

  const items: ItemInput[] = [
    { id: "item-a", payload: "  hello world  " },
    { id: "item-b", payload: "foo bar baz" },
    { id: "item-c", payload: "spike test" },
  ];

  // =========================================================================
  // EXPERIMENT A — successful fan-out (all children succeed)
  //
  // Strategy: use InngestTestEngine and mock all child step.invoke() calls.
  // Probes: O1 (type flows), O5 (replay safety with memoized source), O6 (kit fit).
  //
  // NOTE: InngestTestEngine support for step.invoke() mocking.
  // STRUCTURAL PREDICTION: the steps array can mock step.invoke() calls by
  // their ID (e.g., "child-item-a") the same way it mocks step.run() calls.
  // [PENDING-RUN — verify mock shape for step.invoke()]
  // =========================================================================
  console.log("\n--- EXPERIMENT A: Successful fan-out (all children succeed) ---");

  const parentFn = buildParentFanOutFn(childFn);
  const engine = new InngestTestEngine({ function: parentFn });

  try {
    const mockedResult = (output: ChildProcessOutput) => ({
      ok: true as const,
      value: output,
    });

    const resultA = await engine.execute({
      events: [
        {
          name: "pipeline/fan-out-requested",
          data: { pipelineId: "pk_pipe_test_a", items },
        },
      ],
      steps: items.map((item) => ({
        // Mock each child invoke by step ID
        id: `child-${item.id}`,
        handler: async () =>
          mockedResult({
            itemId: item.id,
            processed: `PROCESSED:${item.payload.trim().toUpperCase()}`,
            processedAt: Date.now(),
          }),
      })),
    });

    const r = resultA.result as Result<AggregatedOutput, FanOutError> | undefined;
    if (r && r.ok) {
      console.log(`\n  RESULT: ok=true pipelineId=${r.value.pipelineId}`);
      console.log(`  Succeeded: ${r.value.succeeded}/${r.value.totalItems}`);
      console.log("  O1: step.invoke() return type flows as Result<T,E> — [PENDING-RUN to confirm TS types]");
      console.log("  O5: items memoized in validate-source → step IDs stable across replays");
      console.log("  O6: Composer fit — no new primitive needed; fan-out = Promise.all + step.invoke");
    } else if (r && !r.ok) {
      console.log(`\n  RESULT: ok=false code=${r.error.code}`);
    } else {
      console.log(`\n  RESULT: ${JSON.stringify(resultA.result)} [engine may have returned raw output]`);
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.log(`\n  ERROR (expected if step.invoke mock unsupported): ${msg.slice(0, 120)}`);
    console.log("  O1/O2: [PENDING-RUN — InngestTestEngine step.invoke mock shape needs empirical check]");
  }

  // =========================================================================
  // EXPERIMENT B — mixed fan-out (one child returns Result.err)
  //
  // Strategy: mock one child to return Result.err, others to succeed.
  // Probes O2: Promise.all behaviour when one child returns Result.err vs throws.
  //
  // STRUCTURAL PREDICTION (O2, detailed):
  //   Child returns Result.err — this is a SUCCESSFUL function return (from
  //   Inngest's perspective). step.invoke() returns the Result.err value.
  //   Promise.all does NOT reject — all N invocations settle.
  //   The aggregate step receives a mix of ok and err Results.
  //   This is the CORRECT fan-out pattern: children signal failure via Result.err,
  //   parent aggregates all outcomes.
  //   [PENDING-RUN — confirm this is what happens vs function-level throw]
  // =========================================================================
  console.log("\n--- EXPERIMENT B: Mixed fan-out (one child returns Result.err) ---");

  const parentFnB = buildParentFanOutFn(childFn);
  const engineB = new InngestTestEngine({ function: parentFnB });

  try {
    const resultB = await engineB.execute({
      events: [
        {
          name: "pipeline/fan-out-requested",
          data: { pipelineId: "pk_pipe_test_b", items },
        },
      ],
      steps: [
        {
          id: "child-item-a",
          handler: async () =>
            ok({
              itemId: "item-a",
              processed: "PROCESSED:HELLO WORLD",
              processedAt: Date.now(),
            }),
        },
        {
          // item-b returns Result.err — probes O2
          id: "child-item-b",
          handler: async () =>
            err({
              code: "child_process_failed" as const,
              itemId: "item-b",
              message: "simulated child failure",
            }),
        },
        {
          id: "child-item-c",
          handler: async () =>
            ok({
              itemId: "item-c",
              processed: "PROCESSED:SPIKE TEST",
              processedAt: Date.now(),
            }),
        },
      ],
    });

    const r = resultB.result as Result<AggregatedOutput, FanOutError> | undefined;
    if (r && r.ok) {
      console.log(`\n  RESULT: ok=true succeeded=${r.value.succeeded} failed=${r.value.failed}`);
      console.log(`  O2: Promise.all settled — Result.err from child did NOT reject Promise.all`);
      console.log(`      (child Result.err = successful fn return; not a function-level throw)`);
    } else {
      console.log(`\n  RESULT: ${JSON.stringify(r ?? resultB.result)}`);
      console.log("  O2: [PENDING-RUN — check if engine rejects on child Result.err return]");
    }
  } catch (e) {
    const msg = (e as Error).message;
    console.log(`\n  ERROR: ${msg.slice(0, 120)}`);
    console.log("  O2: [PENDING-RUN — InngestTestEngine step.invoke mock shape needs empirical check]");
  }

  console.log("\n" + "=".repeat(60));
  console.log("### SPIKE SUMMARY — see FINDINGS-fan-out-compose.md ###");
}

await runSpike();
