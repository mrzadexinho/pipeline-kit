/**
 * Cat VI Spike #2 — Probe: PipelineContext crossing the wire (Cat IX cf #1).
 *
 * Tests whether the serialisation boundary enforced by the TS→Python wire
 * protocol (Cat IX) naturally maps onto the data/control-plane split.
 *
 * Hypothesis: serialisable fields = data plane; non-serialisable = control plane.
 * Null hypothesis: the boundary is arbitrary and doesn't map onto the split.
 *
 * Runs structurally — no external deps, no real IO.
 */

import {
  type PipelineContextOptionB as PipelineContext,
  type SerializableContext,
  type NonSerializableContext,
  type TraceContext,
} from "./types.js";

// ---------------------------------------------------------------------------
// Wire representation (from Cat IX ADR-v1-IX-1: NDJSON + W3C Trace Context)
//
// What MUST cross the wire (TS → Python subprocess):
//   - runId: correlation handle (control)
//   - trace.traceparent: W3C Trace Context for OTel (control, ADR-v1-IX-4)
//   - idempotencyKey: if the Python stage must respect idempotency (control)
//
// What MUST NOT cross the wire:
//   - signal: AbortSignal is a runtime object — not JSON-serialisable
//   - deps.memory: Python has its own memory adapter; TS reference is meaningless
//   - deps.secrets: Python resolves its own secrets; TS reference is meaningless
//   - attempt: retry count could be useful but Python stage doesn't control retries
//
// What is AMBIGUOUS:
//   - idempotencyKey: should the Python subprocess inherit the parent's key?
//     Or generate a namespaced sub-key? (e.g. `<parentKey>:py_step`)
//   - metadata: user metadata might be needed by the Python stage, or might be TS-only
// ---------------------------------------------------------------------------

interface WireFrame {
  readonly runId: string;
  readonly traceparent: string;
  readonly tracestate?: string;
  readonly idempotencyKey?: string;
  // metadata: deliberately excluded — discussed in the ambiguous section
}

/** Produce the wire context from a full PipelineContext. */
function extractWireContext(ctx: PipelineContext): WireFrame {
  return {
    runId: ctx.runId,
    traceparent: ctx.trace.traceparent,
    tracestate: ctx.trace.tracestate,
    idempotencyKey: ctx.idempotencyKey,
  };
}

/** Serialise wire context to NDJSON (Cat IX ADR-v1-IX-1 format). */
function serialiseWireContext(frame: WireFrame): string {
  // RFC 8785 canonical JSON: compact, sorted keys.
  // NOTE: Node.js JSON.stringify sorts keys alphabetically ONLY if keys are
  // added in the order they appear; for a spike this is sufficient.
  return JSON.stringify(frame);
}

/** Simulate Python subprocess receipt + round-trip parse. */
function parseWireContext(raw: string): WireFrame {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed.runId !== "string") throw new Error("missing runId");
  if (typeof parsed.traceparent !== "string") throw new Error("missing traceparent");
  return {
    runId: parsed.runId,
    traceparent: parsed.traceparent,
    tracestate: typeof parsed.tracestate === "string" ? parsed.tracestate : undefined,
    idempotencyKey: typeof parsed.idempotencyKey === "string" ? parsed.idempotencyKey : undefined,
  };
}

// ---------------------------------------------------------------------------
// Probe: does serialisable = data-plane OR control-plane?
// ---------------------------------------------------------------------------

interface FieldClassification {
  field: string;
  serialisable: boolean;
  plane: "data" | "control" | "data-adjacent" | "hybrid";
  crossesWire: boolean;
  crossWireRationale: string;
}

const FIELD_CLASSIFICATIONS: FieldClassification[] = [
  {
    field: "runId",
    serialisable: true,
    plane: "control",
    crossesWire: true,
    crossWireRationale: "Correlation handle; Python stage logs against runId for observability.",
  },
  {
    field: "signal",
    serialisable: false,
    plane: "control",
    crossesWire: false,
    crossWireRationale:
      "AbortSignal is a runtime object; not JSON-serialisable. " +
      "Python cancellation via pipe-close / SIGTERM (Cat IX spike #3 finding).",
  },
  {
    field: "attempt",
    serialisable: true,
    plane: "control",
    crossesWire: false,
    crossWireRationale:
      "Retry attempt index. Python subprocess does not own retry scheduling; " +
      "Inngest (Cat I) owns retries at the TS boundary. Ambiguous: could be useful " +
      "for Python logging but not load-bearing.",
  },
  {
    field: "trace.traceparent",
    serialisable: true,
    plane: "control",
    crossesWire: true,
    crossWireRationale:
      "W3C Trace Context out-of-band (ADR-v1-IX-4). MUST cross the wire for " +
      "distributed tracing across TS→Python hops.",
  },
  {
    field: "idempotencyKey",
    serialisable: true,
    plane: "control",
    crossesWire: true, // ambiguous — see note
    crossWireRationale:
      "AMBIGUOUS. If Python stage writes external state, it should inherit the " +
      "parent idempotency key (or a namespaced sub-key: <parentKey>:py). " +
      "Carry-forward for Cat IV (RunGuard / idempotency protocol).",
  },
  {
    field: "deps.memory",
    serialisable: false,
    plane: "data-adjacent",
    crossesWire: false,
    crossWireRationale:
      "Non-serialisable adapter reference. Python has its own memory backend. " +
      "The memory CONTENT may flow through Atom data; the adapter reference does not.",
  },
  {
    field: "deps.secrets",
    serialisable: false,
    plane: "control",
    crossesWire: false,
    crossWireRationale:
      "Non-serialisable resolver reference. Python resolves its own secrets. " +
      "Passing a TS resolver reference to Python is meaningless.",
  },
  {
    field: "metadata",
    serialisable: true, // structurally — but values may not be
    plane: "hybrid",
    crossesWire: false, // ambiguous — see note
    crossWireRationale:
      "AMBIGUOUS. User metadata may be needed by the Python stage (e.g. pipeline " +
      "tags that influence Python processing). But metadata may also contain " +
      "non-serialisable values or PII. Default: do NOT cross wire; allow opt-in " +
      "via explicit `wireMetadata` field or atom.metadata.",
  },
];

// ---------------------------------------------------------------------------
// Key test: does serialisable correlate with plane?
// ---------------------------------------------------------------------------

function testSerializableCorrelation(): void {
  const serialisable = FIELD_CLASSIFICATIONS.filter((f) => f.serialisable);
  const nonSerializable = FIELD_CLASSIFICATIONS.filter((f) => !f.serialisable);

  const serialisableControl = serialisable.filter((f) => f.plane === "control").length;
  const nonSerializableControl = nonSerializable.filter((f) => f.plane === "control").length;
  const serialisableNonControl = serialisable.filter((f) => f.plane !== "control").length;

  console.log("Serialisable fields:");
  for (const f of serialisable) {
    console.log(`  ${f.field.padEnd(24)}  plane=${f.plane}`);
  }
  console.log("\nNon-serialisable fields:");
  for (const f of nonSerializable) {
    console.log(`  ${f.field.padEnd(24)}  plane=${f.plane}`);
  }
  console.log();
  console.log(`Serialisable + control-plane: ${serialisableControl} / ${serialisable.length}`);
  console.log(`Serialisable + non-control:   ${serialisableNonControl} / ${serialisable.length}`);
  console.log(`Non-serialisable + control:   ${nonSerializableControl} / ${nonSerializable.length}`);
  console.log();

  // Key finding: signal is non-serialisable AND control-plane.
  // All other control-plane fields ARE serialisable (runId, trace, idempotencyKey).
  // So serialisable ≠ data-plane; serialisable = (control - signal - deps).
  // The two-plane split does NOT map cleanly onto the wire boundary.
  console.log("Key finding: serialisable fields are CONTROL-PLANE minus runtime objects (signal, deps).");
  console.log("The wire boundary is NOT the same as the data/control split.");
  console.log("A two-plane type split would not simplify wire-context extraction.");
  console.log("SerializableContext is the correct abstraction (subset of ControlPlane).");
}

// ---------------------------------------------------------------------------
// Idempotency key ambiguity probe
//
// If a Python stage performs external writes, should it inherit the parent
// idempotency key or generate a child key?
//
// Option (a): inherit — simple; risk: Python and TS stages that write to the
//   SAME resource both carry the same key → which write wins?
// Option (b): namespace sub-key: `${parentKey}:py_step_<N>` — cleaner for
//   multi-hop writes; forces the Python stage to accept a sub-key protocol.
// Option (c): Python generates its own key — breaks idempotency continuity
//   across TS→Python hops; two writes to the same resource may conflict.
//
// Verdict: this is a Cat IV (RunGuard) protocol question, not a Cat VI question.
// Cat VI should note the ambiguity and carry it forward.
// ---------------------------------------------------------------------------

function probeIdempotencyKeyAmbiguity(): void {
  const parentKey = "idem-run-001";
  // Option (b) namespaced sub-key:
  const pyStepKey = `${parentKey}:py_step_0`;
  console.log("\nIdempotency key ambiguity probe:");
  console.log(`  parent key: ${parentKey}`);
  console.log(`  python sub-key (option b): ${pyStepKey}`);
  console.log("  Verdict: carry-forward to Cat IV (RunGuard protocol).");
  console.log("  Cat VI notes: wire protocol should include idempotencyKey; sub-key namespacing is Cat IV.");
}

// ---------------------------------------------------------------------------
// Wire round-trip verification
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== Cross-Runtime Context Probe ===\n");

  // Build a representative context
  const trace: TraceContext = {
    traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
    tracestate: "vendorname=opaqueValue",
  };
  const ctx: PipelineContext = {
    runId: "pk_run_01HZTEST",
    signal: new AbortController().signal,
    attempt: 2,
    trace,
    idempotencyKey: "idem-probe-001",
    deps: {},
    metadata: { piiField: "user@example.com", safeTag: "probe" },
  };

  // 1. Extract the wire context
  const wireCtx = extractWireContext(ctx);
  console.log("Wire context extracted:", JSON.stringify(wireCtx, null, 2));

  // 2. Serialise (simulate TS side)
  const raw = serialiseWireContext(wireCtx);
  console.log("\nSerialised NDJSON wire frame:", raw);

  // 3. Parse (simulate Python side receiving the context as a header)
  const parsed = parseWireContext(raw);
  console.log("\nParsed by Python-side (simulated):", JSON.stringify(parsed, null, 2));

  // 4. Verify round-trip fidelity
  const roundTripOk =
    parsed.runId === wireCtx.runId &&
    parsed.traceparent === wireCtx.traceparent &&
    parsed.tracestate === wireCtx.tracestate &&
    parsed.idempotencyKey === wireCtx.idempotencyKey;
  console.log("\nRound-trip fidelity:", roundTripOk ? "PASS" : "FAIL");

  // 5. Verify signal did NOT cross
  const signalCrossed = "signal" in parsed;
  console.log("signal crossed wire:", signalCrossed ? "FAIL (leaked)" : "PASS (excluded)");

  // 6. Verify metadata did NOT cross
  const metadataCrossed = "metadata" in parsed;
  console.log("metadata crossed wire:", metadataCrossed ? "FAIL (leaked)" : "PASS (excluded)");

  // 7. Verify pii did NOT cross
  const piiCrossed = Object.values(parsed).includes("user@example.com");
  console.log("PII crossed wire:", piiCrossed ? "FAIL (leaked)" : "PASS (excluded)");

  console.log();

  // 8. Serialisability vs plane correlation test
  testSerializableCorrelation();

  // 9. Idempotency key ambiguity
  probeIdempotencyKeyAmbiguity();

  // 10. Type-level check: SerializableContext is a subset of PipelineContext
  const serCtx: SerializableContext = {
    runId: ctx.runId,
    trace: ctx.trace,
    idempotencyKey: ctx.idempotencyKey,
  };
  const _nonSer: NonSerializableContext = {
    signal: ctx.signal,
    deps: ctx.deps,
    metadata: ctx.metadata,
  };
  console.log("\n[type-check] SerializableContext compiles:", typeof serCtx.runId === "string");

  console.log("\n=== Verdict ===");
  console.log("Wire boundary does NOT map 1:1 onto data/control split.");
  console.log("Serialisable fields are all control-plane — but so is signal (non-serialisable).");
  console.log("The wire forces a SUBSET split: (runId, trace, idempotencyKey) cross; rest stays TS-side.");
  console.log("Two-plane types would not make extractWireContext() simpler or safer.");
  console.log("SerializableContext (explicit subset type) is the correct abstraction.");
  console.log("Verdict: convention + SerializableContext; no ControlPlane type needed for wire safety.");
}

await main();
