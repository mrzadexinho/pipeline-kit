/**
 * Cat IV Spike #1 — child-with-hrp
 *
 * Child Inngest function WITH a step.waitForEvent() HRP-review checkpoint
 * inserted mid-execution between extract and process steps.
 *
 * Probe goal (O4): can a fanned-out child pause for human review while the
 * parent waits on step.invoke()? The parent is blocked until the child
 * returns — does that compose with an indefinite waitForEvent inside the child?
 *
 * STRUCTURAL PREDICTION (O4):
 *   YES — step.invoke() from the parent waits indefinitely for the child to
 *   complete. The child can have any number of internal steps including
 *   waitForEvent. The parent's step.invoke() suspension is durable (stored
 *   in Inngest state), so it doesn't block a thread — it waits for the child
 *   function run to emit a completion event.
 *
 *   This means: fan-out + HRP = fully composable. Each child can have its own
 *   review gate. The parent aggregates only after ALL children complete
 *   (including their review gates). Very powerful for per-item HRP workflows.
 *   [PENDING-RUN — structural prediction, needs Dev Server confirmation]
 *
 * Test harness note (from Cat I spike #2 §L2-O1):
 *   @inngest/test@1.0.0 steps-array mock for step.waitForEvent is BROKEN.
 *   Use transformCtx workaround to mock step.waitForEvent.
 */

import { inngest } from "./inngest-client.js";
import {
  ok,
  err,
  makeAtom,
  type Result,
  type ChildProcessOutput,
  type ChildError,
  type ItemInput,
  type HrpReviewEvent,
} from "./types.js";

interface ExtractOutput { raw: string; itemId: string; }

// ---------------------------------------------------------------------------
// Child function with mid-execution HRP gate
// ---------------------------------------------------------------------------

export const childWithHrpFn = inngest.createFunction(
  {
    id: "pipeline/child-process-hrp",
    name: "Child Pipeline with HRP gate (Cat IV spike)",
    retries: 2,
  },
  { event: "pipeline/child-process-hrp" },
  async ({ event, step, runId }): Promise<Result<ChildProcessOutput, ChildError>> => {
    const item = (event.data as { item: ItemInput }).item;

    // Step 1 — Extract
    const extracted = await step.run(
      `extract-${item.id}`,
      async (): Promise<ExtractOutput> => {
        return { raw: item.payload.trim().toUpperCase(), itemId: item.id };
      }
    );

    // Step 2 — Send HRP review request (durable side effect)
    await step.run("send-review-request", async () => {
      // In production: POST to HRP webhook with { runId, itemId, extracted }
      // Here: log to console (probe only)
      console.log(`  [child-hrp:${item.id}] review requested for runId=${runId}`);
      return { sent: true, runId, itemId: item.id };
    });

    // Step 3 — Wait for HRP review event
    //
    // Correlation: match on event.data.runId so this child only resumes on
    // the event destined for its specific Inngest function run.
    //
    // Timeout: 24h in production; 1s here for probe ergonomics.
    // On timeout: waitForEvent returns null (per Cat I spike #2 §L2-O3).
    const reviewEvent = await step.waitForEvent("wait-for-hrp-review", {
      event: "hrp/review.completed",
      match: "data.runId",
      timeout: "1s",
    }) as HrpReviewEvent | null;

    // Step 4 — Branch on review decision
    if (reviewEvent === null) {
      // Timeout path — per ADR carry-forward #14: policy is kit's decision
      // Default here: fail with a non-retryable error shape
      return err({
        code: "child_process_failed",
        itemId: item.id,
        message: "HRP review timed out — item rejected by default",
      });
    }

    const { approved, reviewer } = reviewEvent.data;

    if (!approved) {
      return err({
        code: "child_item_rejected",
        itemId: item.id,
        message: `HRP review rejected by ${reviewer}`,
      });
    }

    // Approved — proceed to process
    // Step 5 — Process (only runs after HRP approval)
    const processed = await step.run(
      `process-${item.id}`,
      async (): Promise<ChildProcessOutput> => {
        const atom = makeAtom<ChildProcessOutput>(`pk_atom_hrp_${item.id}`, {
          itemId: extracted.itemId,
          processed: `APPROVED:${extracted.raw}`,
          processedAt: Date.now(),
        });
        console.log(`  [child-hrp:${item.id}] approved by ${reviewer}; atom id=${atom.id}`);
        return atom.data;
      }
    );

    return ok(processed);
  }
);
