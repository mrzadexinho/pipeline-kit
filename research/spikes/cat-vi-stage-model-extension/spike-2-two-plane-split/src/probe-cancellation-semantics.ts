/**
 * Cat VI Spike #2 — Probe: cancellation semantics across runtimes.
 *
 * Current: ctx.signal is AbortSignal. Stages check signal.aborted.
 * Problem 1: Inngest steps don't have direct AbortSignal access (Cat I O-4).
 * Problem 2: Python subprocess needs pipe-close as cancellation (Cat IX spike #3).
 *
 * This probe assesses three ownership models:
 *   (a) Composer responsibility — signal on context, today's shape
 *   (b) Control-plane protocol — formalised events between Composer + stages
 *   (c) Runtime responsibility — Inngest owns cancel; kit just sets the flag
 *
 * Runs structurally — no external deps, no real IO.
 */

import {
  ok,
  err,
  type Result,
  type PipelineContextOptionB as PipelineContext,
  type TraceContext,
  type StageError,
} from "./types.js";
import { stageErr } from "./probe-error-taxonomy.js";

// ---------------------------------------------------------------------------
// Model (a): Composer owns signal — current v0 shape
//
// + Simple: one AbortController per run.
// + Stage authors write: if (ctx.signal.aborted) { yield err(...); return; }
// - Inngest: signal must be synthesised (ADR-v1-I-4 gap).
//   Inngest has no native AbortSignal; adapter must create one per-function.
// - Python: AbortSignal is not serialisable; cancellation via pipe-close + SIGTERM.
//   Python stage cannot receive signal directly.
// - Granularity: signal fires for the whole run. If one branch should cancel
//   while another continues, a single signal is insufficient.
// ---------------------------------------------------------------------------

/** Model (a): stage handler checks signal directly. */
async function* modelAStage<O>(
  ctx: PipelineContext,
  fn: () => AsyncGenerator<Result<O, StageError>>,
): AsyncGenerator<Result<O, StageError>> {
  if (ctx.signal.aborted) {
    yield err(stageErr("runtime_cancelled", "AbortSignal fired before stage entry"));
    return;
  }
  for await (const result of fn()) {
    if (ctx.signal.aborted) {
      yield err(stageErr("runtime_cancelled", "AbortSignal fired during stage execution"));
      return;
    }
    yield result;
  }
}

// ---------------------------------------------------------------------------
// Model (b): Control-plane protocol — CancellationToken + event bridge
//
// The signal is not passed directly; instead a CancellationToken is passed
// that can be serialised across the wire (as a boolean "cancelled" flag)
// and bridged to the Inngest function cancellation event.
//
// + More serialisable: cancelled:boolean can cross the wire.
// + Inngest bridge: listen for function.cancelled event → set cancelled=true.
// + Python bridge: pipe-close → set cancelled=true server-side.
// - Complexity: new type, new lifecycle, new bridge in each adapter.
// - AbortSignal already handles the TS-local case; this is additive.
// ---------------------------------------------------------------------------

interface CancellationToken {
  /** True if cancellation has been requested. */
  readonly cancelled: boolean;
  /** Subscribe to cancellation (fires once). */
  onCancel(callback: () => void): void;
}

/** Bridge AbortSignal → CancellationToken for Inngest adapter use. */
function bridgeSignalToToken(signal: AbortSignal): CancellationToken {
  let cancelled = signal.aborted;
  const callbacks: Array<() => void> = [];

  signal.addEventListener("abort", () => {
    cancelled = true;
    for (const cb of callbacks) cb();
  });

  return {
    get cancelled() {
      return cancelled;
    },
    onCancel(callback) {
      if (cancelled) {
        callback();
      } else {
        callbacks.push(callback);
      }
    },
  };
}

/** Serialise for wire crossing (Python subprocess). */
function serialiseCancellationState(token: CancellationToken): { cancelled: boolean } {
  // Only the boolean state crosses — not the callback mechanism.
  return { cancelled: token.cancelled };
}

// ---------------------------------------------------------------------------
// Model (c): Runtime owns cancellation — kit just reads the flag
//
// Inngest: function-level cancellation event fires; Inngest sets step context.
// Kit adapter: after each step.run(), check if function cancelled; if so,
// yield err({ code: "runtime_cancelled" }) and return.
// Python: pipe-close is the signal; Python stage checks stdin.read() EOF.
//
// + No new kit primitives: AbortSignal on ctx stays; adapter translates.
// + Inngest-idiomatic: function cancellation event is Inngest's mechanism.
// - Kit must document the translation layer per runtime (adapter concern).
// - AbortSignal on ctx still needed for local (non-Inngest) cancellation.
// ---------------------------------------------------------------------------

/** Model (c): adapter-synthesised signal check after each step. */
async function modelCCheckCancellation(
  step: { isRunCancelled: () => boolean },
  runId: string,
): Promise<Result<null, StageError>> {
  if (step.isRunCancelled()) {
    return err(stageErr("runtime_cancelled", `Run ${runId} cancelled by runtime`));
  }
  return ok(null);
}

// ---------------------------------------------------------------------------
// Cancellation propagation trace
//
// Trace the full propagation path for each model:
// User calls abort → signal fires → Composer → stage → Result.err
// ---------------------------------------------------------------------------

interface CancellationTrace {
  model: "a" | "b" | "c";
  steps: string[];
  innguestNativeSupport: boolean;
  pythonCrossWire: boolean;
  newPrimitives: boolean;
  verdict: string;
}

const CANCELLATION_TRACES: CancellationTrace[] = [
  {
    model: "a",
    steps: [
      "1. User calls abortController.abort()",
      "2. signal.aborted → true",
      "3. Composer checks signal.aborted between steps",
      "4. Active stage checks signal.aborted in its iterator loop",
      "5. Stage yields err({ code: 'runtime_cancelled' })",
      "6. kitStep() shim: retryable=false → NonRetryableError (Cat I ADR-v1-I-3)",
      "7. Inngest dead-letters the function run",
    ],
    innguestNativeSupport: false, // signal must be synthesised by adapter
    pythonCrossWire: false,       // AbortSignal is not serialisable
    newPrimitives: false,
    verdict:
      "SUFFICIENT for TS-local + Inngest (with adapter synthesis). " +
      "Gap: Python subprocess must be cancelled via pipe-close/SIGTERM separately. " +
      "The gap is an adapter concern, not a kit-core concern.",
  },
  {
    model: "b",
    steps: [
      "1. User calls abortController.abort()",
      "2. signal fires → bridgeSignalToToken() sets cancelled=true",
      "3. CancellationToken propagates to all active stages",
      "4. Stage checks token.cancelled between atoms",
      "5. Stage yields err({ code: 'runtime_cancelled' })",
      "6. Wire crossing: serialiseCancellationState → { cancelled: true }",
      "7. Python subprocess reads cancelled:true in next wire frame",
      "8. Python stage returns runtime_cancelled",
    ],
    innguestNativeSupport: true, // CancellationToken can bridge to Inngest function.cancelled event
    pythonCrossWire: true,       // cancelled:boolean is serialisable
    newPrimitives: true,         // CancellationToken is a new kit type
    verdict:
      "Better wire compatibility + Inngest bridge. Cost: new CancellationToken type + bridge boilerplate. " +
      "The boolean crossing is valuable for multi-runtime pipelines. " +
      "HOWEVER: the boolean is a snapshot — Python may already be mid-stage when it receives it. " +
      "Latency between TS abort and Python receipt can be 100ms+ (pipe round-trip). " +
      "The model improves best-effort cancellation but cannot guarantee atomic cancel.",
  },
  {
    model: "c",
    steps: [
      "1. Inngest receives function.cancelled event",
      "2. Adapter checks after each step.run(): isRunCancelled()",
      "3. If cancelled: yield err({ code: 'runtime_cancelled' })",
      "4. kitStep() shim: NonRetryableError → Inngest dead-letters",
      "5. Python: stdin reaches EOF (pipe closed by Composer on cancel)",
      "6. Python stage detects EOF → sys.exit(0) or emit runtime_cancelled frame",
    ],
    innguestNativeSupport: true, // runtime handles it natively
    pythonCrossWire: false,      // cancellation via pipe-close, not wire protocol
    newPrimitives: false,        // no new kit types; adapter-idiomatic
    verdict:
      "Inngest-idiomatic: runtime handles cancellation; kit reads the result. " +
      "Non-Inngest runtimes (local, Temporal) still need AbortSignal on ctx. " +
      "Verdict: model (c) is the correct answer for Inngest; model (a) is the correct " +
      "answer for non-Inngest. Both can coexist: AbortSignal on ctx is the universal " +
      "mechanism; Inngest adapter ALSO checks isRunCancelled() after each step.",
  },
];

// ---------------------------------------------------------------------------
// Industry comparison
//
// Kafka: record.headers() carries cancellation-adjacent correlation info.
//   No "cancel" primitive — consumers abandon processing via consumer group rebalance.
// gRPC: Context.isCancelled() / ctx.Done() channel. Propagated as metadata.
//   Model (b) CancellationToken is structurally analogous to gRPC context.
// HTTP: Connection close (TCP FIN) cancels in-flight requests.
//   Analogous to pipe-close for Python subprocess (Cat IX spike #3).
// Temporal: CancellationScope — explicit subtree cancel. Activities get a
//   heartbeat cancellation signal. Most similar to model (b) for nested pipelines.
// Kubernetes: Pod deletion sends SIGTERM → pods gracefully shut down.
//   Analogous to SIGTERM propagation in Cat IX spike #3.
//
// Pattern: every system has cancellation. None formalise it as a "ControlPlane"
// type — they have specific mechanisms (gRPC context, K8s signals, Temporal scope).
// Kit's AbortSignal is idiomatic to the Web Platform API; model (c) adapts to each runtime.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Cancellation Semantics Probe ===\n");

  // 1. Model (a) demonstration: signal check in stage iterator
  const ac = new AbortController();
  const trace: TraceContext = {
    traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
  };
  const ctx: PipelineContext = {
    runId: "pk_run_CANCEL_TEST",
    signal: ac.signal,
    attempt: 0,
    trace,
    deps: {},
    metadata: {},
  };

  // Simulate: signal fires mid-iteration
  let yieldCount = 0;
  async function* fakeStage(): AsyncGenerator<Result<{ n: number }, StageError>> {
    for (let i = 0; i < 5; i++) {
      await Promise.resolve(); // simulate async work
      yield ok({ n: i });
      yieldCount++;
      if (yieldCount === 2) ac.abort(); // simulate user abort after 2 atoms
    }
  }

  console.log("Model (a) — signal-on-context:");
  let results: string[] = [];
  for await (const r of modelAStage(ctx, fakeStage)) {
    if (!r.ok) {
      results.push(`  ERR ${r.error.code}: ${r.error.message}`);
    } else {
      results.push(`  OK  n=${r.value.n}`);
    }
  }
  for (const r of results) console.log(r);
  console.log(`  total atoms before cancel: ${yieldCount}`);
  console.log();

  // 2. Model (b) demonstration: CancellationToken
  const ac2 = new AbortController();
  const token = bridgeSignalToToken(ac2.signal);
  console.log("Model (b) — CancellationToken (pre-abort):", token.cancelled);
  ac2.abort();
  console.log("Model (b) — CancellationToken (post-abort):", token.cancelled);
  const wireState = serialiseCancellationState(token);
  console.log("Model (b) — wire state:", JSON.stringify(wireState));
  console.log();

  // 3. Model (c) demonstration: adapter-side check
  const mockStep = { isRunCancelled: () => true };
  const cancelResult = await modelCCheckCancellation(mockStep, ctx.runId);
  if (!cancelResult.ok) {
    console.log("Model (c) — adapter check:", `ERR ${cancelResult.error.code}`);
  }
  console.log();

  // 4. Print trace comparison
  console.log("=== Propagation Trace Comparison ===\n");
  for (const trace of CANCELLATION_TRACES) {
    console.log(`Model (${trace.model}):`);
    for (const step of trace.steps) console.log(`  ${step}`);
    console.log(`  Inngest native: ${trace.innguestNativeSupport}`);
    console.log(`  Python wire:    ${trace.pythonCrossWire}`);
    console.log(`  New primitives: ${trace.newPrimitives}`);
    console.log(`  Verdict: ${trace.verdict}`);
    console.log();
  }

  // 5. Final verdict
  console.log("=== Verdict ===");
  console.log("AbortSignal on PipelineContext (model a) is sufficient for TS-local + adapter synthesis.");
  console.log("Inngest adapter also checks runtime isRunCancelled() after each step (model c, additive).");
  console.log("Python cancellation via pipe-close/SIGTERM is Cat IX adapter concern, not kit-core.");
  console.log("CancellationToken (model b) adds wire-crossing cancellation propagation.");
  console.log("  - Value: Python can receive cancelled:true in wire context.");
  console.log("  - Cost: new kit type + bridge boilerplate in every adapter.");
  console.log("  - Verdict: carry to Cat VI synthesis as optional enhancement, not ADR-level for v1.");
  console.log();
  console.log("Formalising cancellation as 'ControlPlane' type does NOT simplify any of the three models.");
  console.log("Each model's complexity is in the adapter bridge, not in the context type structure.");
}

await main();
