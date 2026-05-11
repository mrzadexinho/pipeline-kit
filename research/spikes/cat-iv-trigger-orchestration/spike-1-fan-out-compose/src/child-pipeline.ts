/**
 * Cat IV Spike #1 — child-pipeline
 *
 * Child Inngest function invoked by the parent via step.invoke().
 * Simulates a 3-stage mini-pipeline: extract → process → result.
 *
 * Two variants are produced via a factory:
 *   buildChildFn()          — succeeds for any item
 *   buildFailingChildFn()   — throws on items whose id ends with "-fail"
 *
 * This lets the parent probe O2 (error isolation) by mixing success/fail
 * items in the same fan-out.
 *
 * Return type: Result<ChildProcessOutput, ChildError> — matches kit's
 * Result<T,E> contract. step.invoke() returns this value typed.
 *
 * STRUCTURAL PREDICTION (O1):
 *   step.invoke() returns the child function's return value, typed.
 *   So Promise.all(items.map(item => step.invoke(...))) returns
 *   Array<Result<ChildProcessOutput, ChildError>> — Result<T,E> composes
 *   cleanly with step.invoke() return type.
 *   [PENDING-RUN — verify that TS types flow through without `any`]
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
} from "./types.js";

// ---------------------------------------------------------------------------
// Shared mini-pipeline logic
// ---------------------------------------------------------------------------

interface ExtractOutput { raw: string; itemId: string; }
interface ProcessOutput extends ChildProcessOutput {}

function extractStep(item: ItemInput): ExtractOutput {
  // Stage 1 — Extract: normalise input
  return { raw: item.payload.trim().toUpperCase(), itemId: item.id };
}

function processStep(extracted: ExtractOutput): ProcessOutput {
  // Stage 2 — Process: transform
  return {
    itemId: extracted.itemId,
    processed: `PROCESSED:${extracted.raw}`,
    processedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Variant A — always succeeds
// ---------------------------------------------------------------------------

export const childFn = inngest.createFunction(
  {
    id: "pipeline/child-process",
    name: "Child Pipeline (Cat IV spike)",
    retries: 2,
  },
  { event: "pipeline/child-process" },
  async ({ event, step }): Promise<Result<ChildProcessOutput, ChildError>> => {
    const item = (event.data as { item: ItemInput }).item;

    // Step 1 — extract
    const extracted = await step.run(
      `extract-${item.id}`,
      async (): Promise<ExtractOutput> => {
        return extractStep(item);
      }
    );

    // Step 2 — process
    const processed = await step.run(
      `process-${item.id}`,
      async (): Promise<ProcessOutput> => {
        return processStep(extracted);
      }
    );

    // Step 3 — wrap in Result + Atom envelope
    const atom = makeAtom<ProcessOutput>(`pk_atom_child_${item.id}`, processed);
    void atom; // atom shape available for observability; return Result directly

    return ok(processed);
  }
);

// ---------------------------------------------------------------------------
// Variant B — throws on items with id ending in "-fail"
// Probes O2: does a failing child isolate its error from siblings?
//
// STRUCTURAL PREDICTION (O2):
//   Promise.all rejects on first child failure — siblings that haven't
//   completed yet are abandoned (Inngest server-side), but already-completed
//   step.invoke() calls MAY have already resolved.
//
//   Unlike Promise.allSettled, Promise.all with step.invoke() may not give us
//   a per-item settled outcome. This is the key O2 question:
//   does Inngest provide a step.invoke() equivalent that settles without
//   short-circuiting? Or must we catch per-invoke?
//   [PENDING-RUN]
// ---------------------------------------------------------------------------

export const failingChildFn = inngest.createFunction(
  {
    id: "pipeline/child-process-failing",
    name: "Child Pipeline (failing variant — Cat IV spike)",
    retries: 0, // no retries: fail fast for probe
  },
  { event: "pipeline/child-process-failing" },
  async ({ event, step }): Promise<Result<ChildProcessOutput, ChildError>> => {
    const item = (event.data as { item: ItemInput }).item;

    const extracted = await step.run(
      `extract-${item.id}`,
      async (): Promise<ExtractOutput> => {
        if (item.id.endsWith("-fail")) {
          // Throw to trigger Inngest retry protocol (per ADR-v1-I-3 kitStep shim)
          throw new Error(`kit:step_error code=child_item_rejected itemId=${item.id}`);
        }
        return extractStep(item);
      }
    );

    const processed = await step.run(
      `process-${item.id}`,
      async (): Promise<ProcessOutput> => {
        return processStep(extracted);
      }
    );

    return ok(processed);
  }
);
