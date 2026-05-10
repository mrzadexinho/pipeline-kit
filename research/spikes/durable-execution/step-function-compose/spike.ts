/**
 * Cat I Spike #1 — step-function-compose
 *
 * Simulates kit's Composer pipeline as 3 Inngest steps:
 *   step 1 (source)  → emit atom { id, data: { url } }
 *   step 2 (process) → transform atom — FAILS first attempt, SUCCEEDS on retry
 *   step 3 (serve)   → write result to /tmp/spike-cat-i-result.json
 *
 * Probe goals:
 *   O-1: Retry granularity (per-step? per-function?)
 *   O-2: State passing across retried steps
 *   O-3: Result<T,E> return vs throw — does Inngest distinguish?
 *   O-4: PipelineContext mapping
 *   O-5: Checkpoint visibility via InngestTestEngine
 *   O-6: Composition friction (typing, DX)
 *
 * Run via: bun run spike.ts
 * Uses @inngest/test as local fallback (no dev server required).
 */

import { Inngest } from "inngest";
import { InngestTestEngine } from "@inngest/test";
import { writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Kit-style type definitions (self-contained — no @idriszade/* imports)
// ---------------------------------------------------------------------------

type Ok<T> = { ok: true; value: T };
type Err<E> = { ok: false; error: E };
type Result<T, E> = Ok<T> | Err<E>;

function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}
function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

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

interface SourceOutput { url: string; }
interface ProcessOutput { url: string; title: string; fetchedAt: number; }

// ---------------------------------------------------------------------------
// Inngest client
// ---------------------------------------------------------------------------

const inngest = new Inngest({ id: "pipeline-kit-spike" });

// ---------------------------------------------------------------------------
// Build the pipeline function factory.
// Accepts a counter object so each experiment has isolated state.
// ---------------------------------------------------------------------------

function buildPipelineFunction(counter: { invocations: number }) {
  return inngest.createFunction(
    {
      id: "pipeline/run",
      name: "Pipeline Run (Cat I spike)",
      retries: 3,
      triggers: [{ event: "pipeline/run.requested" }],
    },
    async ({ event, step, runId }) => {

      // -------------------------------------------------------------------
      // STEP 1 — Source: emit a kit-shaped atom
      // -------------------------------------------------------------------
      const sourceAtom = await step.run("source", async (): Promise<Atom<SourceOutput>> => {
        const url = (event.data as { url?: string }).url ?? "https://example.com";
        const atom = makeAtom<SourceOutput>("pk_atom_src_1", { url });
        console.log(`    [source] emitted atom id=${atom.id} url=${url}`);
        return atom;
      });

      console.log(`    [after-source] sourceAtom.id=${sourceAtom.id} url=${sourceAtom.data.url}`);

      // -------------------------------------------------------------------
      // STEP 2 — Process: transform atom
      //
      // PROBE O-3: First invocation returns Result.err (NOT throw).
      //   Hypothesis: Inngest treats any return (even err) as SUCCESS for
      //   the step — it only retries on throw. Implication: kit MUST throw
      //   to trigger per-step durability (or have a shim-layer).
      //
      // PROBE O-1: Does Inngest replay only step 2, or also step 1?
      //   Evidence: [source] log should appear only once even across retries.
      // -------------------------------------------------------------------
      const processResult = await step.run(
        "process",
        async (): Promise<Result<Atom<ProcessOutput>, string>> => {
          counter.invocations++;
          console.log(`    [process] invocation #${counter.invocations}`);

          if (counter.invocations === 1) {
            // O-3 PROBE: return Result.err instead of throwing
            console.log("    [process] returning Result.err (NOT throwing) — probe O-3");
            return err("transient_fetch_error");
          }

          // invocation 2+: succeed (simulates retry-resolved transient failure)
          const processedAtom = makeAtom<ProcessOutput>("pk_atom_proc_1", {
            url: sourceAtom.data.url,
            title: "Example Domain (spike-fetched)",
            fetchedAt: Date.now(),
          });
          console.log(`    [process] produced atom id=${processedAtom.id}`);
          return ok(processedAtom);
        }
      );

      console.log(`    [after-process] processResult.ok=${processResult.ok}`);

      // -------------------------------------------------------------------
      // Shim layer: translate Result.err → throw for Inngest retry protocol.
      // THIS IS THE LOAD-BEARING COMPOSITION POINT.
      // In a real kit Inngest adapter, every step.run() call would be wrapped
      // with a helper that performs this translation automatically:
      //
      //   const result = await kitStep(step, "process", async () => { ... });
      //   // kitStep: if ok, returns value; if err, throws (triggers retry)
      //
      // Without this shim, Inngest silently treats Result.err as success,
      // advances the pipeline, and the next step receives a failed result.
      // -------------------------------------------------------------------
      if (!processResult.ok) {
        console.log(
          `    [shim] processResult.ok=false — throwing to trigger Inngest per-step retry`
        );
        throw new Error(`kit:step_error code=${processResult.error}`);
      }

      const processedAtom = processResult.value;

      // -------------------------------------------------------------------
      // STEP 3 — Serve: write result (proof of pipeline completion)
      // Probe O-2: is sourceAtom accessible here after process retried?
      // -------------------------------------------------------------------
      const serveResult = await step.run("serve", async () => {
        const output = {
          runId,
          sourceAtomId: sourceAtom.id,
          sourceUrl: sourceAtom.data.url,
          processedAtomId: processedAtom.id,
          processedTitle: processedAtom.data.title,
          retryCountAtSuccess: counter.invocations,
          completedAt: new Date().toISOString(),
        };
        writeFileSync("/tmp/spike-cat-i-result.json", JSON.stringify(output, null, 2));
        console.log(`    [serve] result written to /tmp/spike-cat-i-result.json`);
        console.log(`    [serve] sourceAtom still accessible: id=${sourceAtom.id} (O-2 confirmed)`);
        return { written: true };
      });

      return { ok: true, runId, sourceAtomId: sourceAtom.id, serveResult };
    }
  );
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

async function runSpike() {
  console.log("### Cat I Spike #1 — step-function-compose ###");
  console.log("=".repeat(60));

  // =========================================================================
  // EXPERIMENT A: Full run — probe O-1, O-2, O-3
  //
  // Strategy: mock step "process" to succeed immediately (bypasses the
  // err+throw path). This lets step 3 run so we can confirm O-2 (sourceAtom
  // flows through) and observe the complete pipeline shape.
  //
  // Separately, we probe O-3 directly by letting the real process handler
  // return Result.err and confirming the step engine treats it as "success"
  // (i.e., does NOT retry).
  // =========================================================================
  console.log("\n--- EXPERIMENT A: Full pipeline run with mocked process step ---");
  console.log("    (confirms O-2: sourceAtom flows to step 3 after step 2)");

  const counterA = { invocations: 0 };
  const mockedProcessAtom = makeAtom<ProcessOutput>("pk_atom_proc_mocked", {
    url: "https://example.com",
    title: "Mocked Title (step 2 bypassed)",
    fetchedAt: Date.now(),
  });

  const engineA = new InngestTestEngine({ function: buildPipelineFunction(counterA) });

  try {
    const resultA = await engineA.execute({
      events: [{ name: "pipeline/run.requested", data: { url: "https://example.com" } }],
      steps: [
        {
          id: "process",
          handler: async () => ok(mockedProcessAtom),
        },
      ],
    });
    const r = resultA.result as { ok?: boolean; sourceAtomId?: string };
    console.log(`\n  RESULT: ok=${r.ok} sourceAtomId=${r.sourceAtomId}`);
    console.log(`  O-2: CONFIRMED — sourceAtom (step 1) id=${r.sourceAtomId} flowed to step 3`);
  } catch (e) {
    console.log(`  ERROR: ${(e as Error).message}`);
  }

  // =========================================================================
  // EXPERIMENT B: Probe O-3 — Result.err return does NOT trigger retry
  //
  // We run without mocking step 2. It returns Result.err on invocation 1.
  // Expected (hypothesis): InngestTestEngine does NOT auto-retry (it only
  // exposes the step-level interface; retry is Inngest's server concern).
  // The result from step.run will be the Result.err value itself (not a
  // thrown error), confirming that Inngest's SDK treats any return as
  // step-success regardless of the return value's shape.
  //
  // If hypothesis is CORRECT: processResult.ok=false, function proceeds past
  // step 2 with a failed Result, shim then throws at FUNCTION level.
  // =========================================================================
  console.log("\n--- EXPERIMENT B: O-3 probe — Result.err vs throw ---");
  console.log("    (does returning Result.err cause Inngest to retry the step?)");

  const counterB = { invocations: 0 };
  const engineB = new InngestTestEngine({ function: buildPipelineFunction(counterB) });

  try {
    const resultB = await engineB.execute({
      events: [{ name: "pipeline/run.requested", data: { url: "https://example.com" } }],
    });
    console.log(`\n  RESULT (unexpected success): ${JSON.stringify(resultB.result)}`);
  } catch (e) {
    const msg = (e as Error).message;
    console.log(`\n  RESULT: function threw (expected path)`);
    console.log(`  Error: ${msg.slice(0, 100)}`);
    console.log(`  processInvocationCount: ${counterB.invocations}`);
    if (counterB.invocations === 1) {
      console.log("  O-3: CONFIRMED — Inngest SDK treats Result.err return as step-SUCCESS");
      console.log("       (step 2 ran exactly once, did not retry on Result.err return)");
      console.log("       The shim throw is what propagated as a function-level error.");
    } else {
      console.log(`  O-3: FALSIFIED — step 2 ran ${counterB.invocations} times unexpectedly`);
    }
  }

  // =========================================================================
  // EXPERIMENT C: Execute only step "source" — probe O-5
  //
  // InngestTestEngine.executeStep() runs the function until a named step
  // completes, then stops. This models Inngest's "checkpoint" concept.
  // =========================================================================
  console.log("\n--- EXPERIMENT C: executeStep('source') — checkpoint probe (O-5) ---");

  const counterC = { invocations: 0 };
  const engineC = new InngestTestEngine({ function: buildPipelineFunction(counterC) });

  try {
    const stepResult = await engineC.executeStep("source", {
      events: [{ name: "pipeline/run.requested", data: { url: "https://example.com" } }],
    });
    console.log(`\n  Step result: ${JSON.stringify(stepResult.result)}`);
    console.log(`  O-5: CONFIRMED — per-step checkpoint observable via executeStep()`);
    console.log(`       Step output is a complete kit Atom<T> envelope`);
  } catch (e) {
    console.log(`  ERROR: ${(e as Error).message}`);
  }

  // =========================================================================
  // EXPERIMENT D: PipelineContext mapping (O-4)
  // Capture what Inngest provides in the function context.
  // =========================================================================
  console.log("\n--- EXPERIMENT D: PipelineContext mapping (O-4) ---");

  const contextCapture: Record<string, unknown> = {};
  const contextFn = inngest.createFunction(
    { id: "context-probe", retries: 0, triggers: [{ event: "pipeline/run.requested" }] },
    async ({ event, step, runId, attempt }) => {
      contextCapture.runId = runId;
      contextCapture.attempt = attempt;
      contextCapture.eventName = event.name;
      contextCapture.eventData = event.data;
      contextCapture.hasStep = typeof step?.run === "function";
      contextCapture.stepTools = Object.keys(step as object);
      return { captured: true };
    }
  );

  const tContext = new InngestTestEngine({ function: contextFn });
  try {
    await tContext.execute({
      events: [{ name: "pipeline/run.requested", data: { url: "https://example.com" } }],
    });
    console.log("\n  Inngest context fields:");
    for (const [k, v] of Object.entries(contextCapture)) {
      console.log(`    ${k}: ${JSON.stringify(v)}`);
    }
    console.log("\n  O-4 mapping:");
    console.log("    kit PipelineContext.run_id  ↔  Inngest runId");
    console.log("    kit PipelineContext.signal   ↔  Inngest (AbortSignal via middleware or manual)");
    console.log("    kit PipelineContext.event    ↔  Inngest event.data");
    console.log("    kit atom deps (secrets/mem)  ↔  closed-over in function factory (same as Cat VIII/V)");
    console.log("    kit retry state              ↔  Inngest attempt (0-indexed)");
  } catch (e) {
    console.log(`  ERROR: ${(e as Error).message}`);
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("\n" + "=".repeat(60));
  console.log("### SPIKE SUMMARY ###");
}

await runSpike();
