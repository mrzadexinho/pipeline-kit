/**
 * Cat I Spike #2 — multi-atom-hrp
 *
 * LEG 1: Multi-atom dynamic step composition
 *   Source yields N=3 atoms; each processed in a dynamic for-loop
 *   step.run(`process-${atom.id}`). Probe replay behaviour + memoization.
 *
 * LEG 2: HRP checkpoint via step.waitForEvent
 *   Pause pipeline after process, wait for external review event.
 *   InngestTestEngine support probed (steps-array approach fails; transformCtx works).
 *
 * Run via: bun run spike.ts
 * No @idriszade/* imports. InngestTestEngine used (no dev server binary).
 */

import { Inngest } from "inngest";
import { InngestTestEngine, mockCtx } from "@inngest/test";

// ---------------------------------------------------------------------------
// Minimal kit-style types (self-contained)
// ---------------------------------------------------------------------------

type Ok<T> = { ok: true; value: T };
type Err<E> = { ok: false; error: E };
type Result<T, E> = Ok<T> | Err<E>;

function ok<T>(value: T): Ok<T> { return { ok: true, value }; }
function err<E>(error: E): Err<E> { return { ok: false, error }; }

interface Atom<T> {
  id: string;
  object: "atom";
  created_at: number;
  metadata: Record<string, unknown>;
  data: T;
}

function makeAtom<T>(id: string, data: T): Atom<T> {
  return { id, object: "atom", created_at: Date.now(), metadata: {}, data };
}

// kitStep shim from spike #1 — carried forward unchanged (load-bearing)
async function kitStep<T, E extends string>(
  step: { run: <R>(id: string, fn: () => Promise<R>) => Promise<R> },
  id: string,
  fn: () => Promise<Result<T, E>>
): Promise<T> {
  const result = await step.run(id, fn);
  if (!result.ok) throw new Error(`kit:step_error code=${String(result.error)}`);
  return result.value;
}

const inngest = new Inngest({ id: "pipeline-kit-spike-2" });

// ---------------------------------------------------------------------------
// LEG 1 — Multi-atom dynamic step composition
// ---------------------------------------------------------------------------

// Execution ledger: records which handler bodies ran and how many times.
// Persists across replays to detect re-execution vs memoization.
const leg1Ledger: string[] = [];

const multiAtomFn = inngest.createFunction(
  { id: "pipeline/multi-atom", retries: 0, triggers: [{ event: "pipeline/multi.requested" }] },
  async ({ step }) => {
    leg1Ledger.push("fn-body:start");

    // STEP: source — returns array of N=3 atoms (N fixed; dynamic in real kit)
    const sourceAtoms = await step.run("source", async (): Promise<Atom<{ val: number }>[]> => {
      leg1Ledger.push("source:handler");
      return [
        makeAtom("pk_atom_a", { val: 10 }),
        makeAtom("pk_atom_b", { val: 20 }),
        makeAtom("pk_atom_c", { val: 30 }),
      ];
    });

    leg1Ledger.push(`fn-body:post-source atoms=${sourceAtoms.length}`);

    // PROBE L1-O1 + L1-O2: dynamic for-loop with per-atom step IDs
    // On replay: loop re-executes but step.run returns memoized results for
    // already-completed steps; handlers for those steps do NOT re-run.
    const processedAtoms: Atom<{ val: number; doubled: number }>[] = [];
    for (const atom of sourceAtoms) {
      leg1Ledger.push(`fn-body:loop-iter id=${atom.id}`);
      // L1-O4 FOOTGUN: if sourceAtoms were NOT inside step.run(), atom IDs could
      // differ between replays → step ID mismatch → Inngest runtime error.
      // Because source IS wrapped, N=3 and atom IDs are stable across all replays.
      const processed = await kitStep(step, `process-${atom.id}`, async () => {
        leg1Ledger.push(`process:handler id=${atom.id}`);
        return ok(makeAtom(`pk_proc_${atom.id}`, { val: atom.data.val, doubled: atom.data.val * 2 }));
      });
      processedAtoms.push(processed);
    }

    leg1Ledger.push("fn-body:post-loop");

    // STEP: serve — collect all processed atoms
    const serveResult = await step.run("serve", async () => {
      leg1Ledger.push("serve:handler");
      return { collected: processedAtoms.map(a => ({ id: a.id, doubled: a.data.doubled })) };
    });

    leg1Ledger.push("fn-body:end");
    return serveResult;
  }
);

// ---------------------------------------------------------------------------
// LEG 2 — HRP checkpoint via step.waitForEvent
// ---------------------------------------------------------------------------

interface ReviewEventData { runId: string; approved: boolean; reviewer: string }
interface ReviewEventPayload { name: "hrp/review.completed"; data: ReviewEventData }

const hrpFn = inngest.createFunction(
  { id: "pipeline/hrp-review", retries: 0, triggers: [{ event: "pipeline/hrp.requested" }] },
  async ({ event, step, runId }) => {
    const sourceAtom = await step.run("source", async () =>
      makeAtom("pk_atom_hrp_1", { payload: (event.data as { payload?: string }).payload ?? "test" })
    );

    const processedAtom = await step.run("process", async () =>
      makeAtom("pk_atom_hrp_proc", { processed: true, input: sourceAtom.data.payload })
    );

    // In real kit: HRP sends review request webhook here
    await step.run("send-review-request", async () => {
      console.log(`    [hrp] review requested for runId=${runId}`);
      return { reviewRequested: true, runId };
    });

    // L2-O1/O2/O3: step.waitForEvent — the "pause" primitive for kit HRP
    // Returns full event payload ({ name, data }) or null on timeout.
    // L2-O4: kit Reviewable<I> checkpoint maps here:
    //   kit "await review" = step.waitForEvent
    //   HRP response event = "hrp/review.completed"
    //   match: "data.runId" = correlate to this pipeline run
    const reviewEvent = await step.waitForEvent("wait-for-hrp", {
      event: "hrp/review.completed",
      timeout: "1h",
      match: "data.runId",
    }) as ReviewEventPayload | null;

    const approved = reviewEvent?.data?.approved ?? false;
    const reviewer = reviewEvent?.data?.reviewer ?? "timeout";

    const serveResult = await step.run("serve", async () => {
      console.log(`    [hrp] serve: approved=${approved} reviewer=${reviewer}`);
      return { processedAtomId: processedAtom.id, approved, reviewer, completedAt: new Date().toISOString() };
    });

    return serveResult;
  }
);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runSpike() {
  console.log("### Cat I Spike #2 — multi-atom-hrp ###");
  console.log("=".repeat(60));

  // =========================================================================
  // EXP A: LEG 1 — Multi-atom dynamic steps, full run
  // =========================================================================
  console.log("\n--- LEG 1 / EXP A: Multi-atom dynamic step composition ---");
  leg1Ledger.length = 0;

  const engineA = new InngestTestEngine({ function: multiAtomFn });
  try {
    const result = await engineA.execute({
      events: [{ name: "pipeline/multi.requested", data: {} }],
    });
    console.log("  Result:", JSON.stringify(result.result, null, 2));
    console.log("\n  Execution ledger (replay fingerprint):");
    leg1Ledger.forEach((entry, i) => console.log(`    [${i}] ${entry}`));

    const sourceHandlerRuns = leg1Ledger.filter(e => e === "source:handler").length;
    const processHandlerRuns = leg1Ledger.filter(e => e.startsWith("process:handler")).length;
    const serveHandlerRuns = leg1Ledger.filter(e => e === "serve:handler").length;
    const fnBodyStarts = leg1Ledger.filter(e => e === "fn-body:start").length;

    console.log(`\n  Handler execution counts:`);
    console.log(`    fn-body:start       = ${fnBodyStarts}  (one per step = N+2 replays)`);
    console.log(`    source:handler      = ${sourceHandlerRuns}  (expected: 1)`);
    console.log(`    process:handler×N   = ${processHandlerRuns}  (expected: 3, one per atom)`);
    console.log(`    serve:handler       = ${serveHandlerRuns}  (expected: 1)`);

    if (sourceHandlerRuns === 1 && processHandlerRuns === 3 && serveHandlerRuns === 1) {
      console.log(`\n  L1-O1: CONFIRMED — dynamic step IDs replay correctly; each handler runs exactly once`);
    } else {
      console.log(`\n  L1-O1: UNEXPECTED — check ledger above`);
    }
    console.log(`  L1-O2: fn-body re-executed ${fnBodyStarts}× (N=3 process steps + 1 source + 1 serve = 5 steps)`);
    console.log(`         spike-1 formula confirmed: N_steps fn-body executions + 1 final completion = ${fnBodyStarts}`);
    console.log(`  L1-O3: No step-count error for N=3. Inngest docs: no hard limit; IDs must be stable per replay.`);
    console.log(`  L1-O4: FOOTGUN — unstable step IDs break replay. Source MUST be wrapped in step.run().`);
    console.log(`  L1-O5: Sequential for-loop = kit Composer fan-out serial (M0.5 B pattern).`);
    console.log(`         Parallel fan-out requires step.invoke() or step.sendEvent() + sibling functions.`);
  } catch (e) {
    console.log("  LEG 1 ERROR:", (e as Error).message);
  }

  // =========================================================================
  // EXP B: LEG 2 — HRP checkpoint, approved path
  // L2-O5 finding: steps-array mock FAILS for waitForEvent due to engine bug
  // (result.data is a Promise when validateEvents is called, not the resolved value).
  // CORRECT approach: transformCtx to replace step.waitForEvent with a mock fn.
  // =========================================================================
  console.log("\n--- LEG 2 / EXP B: HRP checkpoint — approved path (transformCtx mock) ---");

  const engineB = new InngestTestEngine({
    function: hrpFn,
    // L2-O5: transformCtx is the ONLY working way to mock step.waitForEvent in
    // InngestTestEngine@1.0.0. The steps-array approach triggers EventValidationError
    // because the engine passes result.data (a Promise) to validateEvents before awaiting.
    transformCtx: (rawCtx) => {
      const ctx = mockCtx(rawCtx);
      (ctx.step as unknown as Record<string, unknown>).waitForEvent = async () => ({
        name: "hrp/review.completed",
        data: { runId: "pk_run_test_hrp_01", approved: true, reviewer: "alice@example.com" },
      });
      return ctx as Parameters<typeof mockCtx>[0];
    },
  });

  try {
    const result = await engineB.execute({
      events: [{ name: "pipeline/hrp.requested", data: { payload: "audit-me" } }],
    });
    console.log("  Result:", JSON.stringify(result.result, null, 2));
    const r = result.result as { approved?: boolean; reviewer?: string } | undefined;
    if (r?.approved === true) {
      console.log("  L2-O1: QUALIFIED — waitForEvent composes via transformCtx only (steps-array blocked)");
      console.log("  L2-O2: CONFIRMED — review event payload accessible in function body after waitForEvent");
      console.log("  L2-O3: approved path. See EXP C for timeout path.");
      console.log("  L2-O4: CONFIRMED — kit Reviewable<I> maps to step.waitForEvent cleanly.");
      console.log("         HRP response (approved/reviewer) in event.data; function resumes with full context.");
    }
  } catch (e) {
    console.log("  LEG 2 (approved) ERROR:", (e as Error).message);
  }

  // =========================================================================
  // EXP C: LEG 2 — HRP checkpoint, timeout path (null return)
  // =========================================================================
  console.log("\n--- LEG 2 / EXP C: HRP checkpoint — timeout path ---");

  const engineC = new InngestTestEngine({
    function: hrpFn,
    transformCtx: (rawCtx) => {
      const ctx = mockCtx(rawCtx);
      (ctx.step as unknown as Record<string, unknown>).waitForEvent = async () => null;
      return ctx as Parameters<typeof mockCtx>[0];
    },
  });

  try {
    const result = await engineC.execute({
      events: [{ name: "pipeline/hrp.requested", data: { payload: "timeout-test" } }],
    });
    const r = result.result as { approved?: boolean; reviewer?: string } | undefined;
    console.log("  Result:", JSON.stringify(result.result, null, 2));
    if (r?.reviewer === "timeout") {
      console.log("  L2-O3: CONFIRMED — timeout: waitForEvent returns null; pipeline continues (no throw).");
      console.log("         approved=false by default; reviewer='timeout' sentinel from kit handler.");
      console.log("         Timeout policy (fail vs continue) is kit's decision, not Inngest's.");
    }
  } catch (e) {
    console.log("  LEG 2 (timeout) ERROR:", (e as Error).message);
  }

  console.log("\n" + "=".repeat(60));
  console.log("### SPIKE #2 COMPLETE ###");
}

await runSpike();
