/**
 * Cat VI Spike #2 — Probe: conflation points in current PipelineContext.
 *
 * Traces the Composer flow and identifies where data-plane and control-plane
 * concerns conflate on the single PipelineContext object.
 *
 * For each conflation point:
 *   (a) Does it cause actual bugs today?
 *   (b) Does it cause bugs at scale (theoretical)?
 *   (c) Would a type-level split prevent the bug?
 *
 * Runs structurally — no external deps, no real IO.
 */

import {
  ok,
  err,
  type Atom,
  type PipelineContextOptionB as PipelineContext,
  type Result,
  type TraceContext,
} from "./types.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeCtx(overrides?: Partial<PipelineContext>): PipelineContext {
  const trace: TraceContext = {
    traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
  };
  return {
    runId: "pk_run_01HZTEST",
    signal: new AbortController().signal,
    attempt: 0,
    trace,
    idempotencyKey: "idem-001",
    deps: {},
    metadata: { userTag: "probe-conflation" },
    ...overrides,
  };
}

function makeAtom<T>(data: T): Atom<T> {
  return {
    id: "pk_atom_01HZTEST",
    object: "atom",
    created_at: Date.now(),
    metadata: {},
    data,
  };
}

// ---------------------------------------------------------------------------
// CP-1: ctx.signal (control) co-located with ctx.metadata (data)
//
// Question: who reads what?
//   - Stages read ctx.metadata to emit structured data into atoms.
//   - Stages read ctx.signal to decide whether to abort.
//   - OTel spans record BOTH ctx.trace (control) AND atom data (data-plane).
//   - Redaction: PII in ctx.metadata must be stripped before tracing.
//
// Actual bug today? NO — but the co-location makes redaction logic ambiguous:
// a naive "log ctx" call leaks PII from metadata alongside control fields.
//
// Bug at scale? YES — as metadata grows (user-supplied keys, PII), a span
// recording ctx.metadata risks a compliance event (GDPR/HIPAA). The control
// fields (signal, runId, trace) are safe to log unconditionally; metadata is NOT.
//
// Would a type-level split prevent it? PARTIALLY — if metadata is on a
// separate type, an overly-broad ctx-log function would be a type error.
// But developers can still destructure and log individually.
// ---------------------------------------------------------------------------

interface ConflationPoint {
  id: string;
  name: string;
  planes: Array<"data" | "control">;
  bugToday: boolean;
  bugAtScale: boolean;
  typeSplitPrevents: boolean;
  assessment: string;
}

const cp1: ConflationPoint = {
  id: "CP-1",
  name: "ctx.signal (control) + ctx.metadata (data) on same object",
  planes: ["control", "data"],
  bugToday: false,
  bugAtScale: true,
  typeSplitPrevents: false, // naive log destructures either way
  assessment:
    "PII leakage risk: logging ctx broadly leaks metadata PII alongside control fields. " +
    "Prevented by ADR-VIII-6 redaction contract (PII redaction at Zod boundary), NOT by " +
    "type-level split. Convention + redaction annotation is sufficient defence.",
};

// ---------------------------------------------------------------------------
// CP-2: OTel spans record atoms (data) AND ctx fields (control)
//
// In a typical Composer step:
//   span.setAttribute("pipeline.runId", ctx.runId);          // control
//   span.setAttribute("atom.id", atom.id);                   // data
//   span.setAttribute("user.tag", String(ctx.metadata.userTag)); // data (PII risk)
//
// Actual bug today? NO — kit doesn't have OTel instrumentation yet.
// Bug at scale? YES — once OTel lands, the span-attribute call site will
// naturally pull from both planes. Without discipline, PII flows into traces.
// Would a type-level split prevent it? PARTIALLY — if control and data have
// different types, a helper `recordControlAttrs(span, ctrl)` vs
// `recordDataAttrs(span, atom)` enforces the split at the call site.
// Caveat: the helper boundaries are advisory; a developer can bypass.
// ---------------------------------------------------------------------------

const cp2: ConflationPoint = {
  id: "CP-2",
  name: "OTel span records atom data AND ctx control fields",
  planes: ["data", "control"],
  bugToday: false,
  bugAtScale: true,
  typeSplitPrevents: true, // typed helpers at span attribution call sites
  assessment:
    "W3C Trace Context out-of-band (ADR-v1-IX-4) already handles trace propagation. " +
    "The remaining risk is PII in span attributes from ctx.metadata. " +
    "A type-level split DOES help here: typed helper functions " +
    "recordControlSpanAttrs(span, ControlPlane) vs recordDataSpanAttrs(span, Atom<T>) " +
    "make the separation auditable. This is the strongest argument FOR the split.",
};

// Demonstrate what the typed helpers would look like:
function recordControlSpanAttrs(
  span: { setAttribute(k: string, v: string | number): void },
  ctx: Pick<PipelineContext, "runId" | "attempt" | "trace">,
): void {
  span.setAttribute("pipeline.runId", ctx.runId);
  span.setAttribute("pipeline.attempt", ctx.attempt);
  span.setAttribute("pipeline.traceparent", ctx.trace.traceparent);
  // NOTE: signal and deps deliberately excluded — not span-compatible
}

function recordDataSpanAttrs<T>(
  span: { setAttribute(k: string, v: string | number): void },
  atom: Atom<T>,
): void {
  span.setAttribute("atom.id", atom.id);
  span.setAttribute("atom.created_at", atom.created_at);
  // NOTE: atom.data deliberately NOT recorded here — PII redaction is caller's responsibility
}

// Type-system test: the helpers above compile with PipelineContextOptionB.
// If we tried to pass ctx.signal to recordControlSpanAttrs, tsc errors.
void recordControlSpanAttrs;
void recordDataSpanAttrs;

// ---------------------------------------------------------------------------
// CP-3: MemoryAdapter on ctx.deps — data-plane or control-plane?
//
// The question: is memory an infrastructure concern (control) or pipeline
// content (data)?
//
// Evidence from Cat V spikes:
//   - MemoryAdapter is used by stages to READ/WRITE pipeline state across atoms.
//   - It IS the mechanism through which data persists — it IS a data-plane
//     concern at the usage site.
//   - BUT: the adapter reference itself is infrastructure (not observable,
//     not serialisable across the wire, carries lifecycle).
//
// Verdict: MemoryAdapter is a HYBRID — the reference is control-plane
// (infrastructure, non-serialisable) but its content is data-plane (the
// values read/written are pipeline content).
//
// Does this hybridness cause bugs? Not currently. The deps-shape pattern
// (Cat VIII / Cat V) already places adapters on `deps`, not as ambient ctx.
// The two-plane split would call `deps` part of the control plane, which
// feels right — you'd never serialize the MemoryAdapter reference across
// the Python wire.
// ---------------------------------------------------------------------------

const cp3: ConflationPoint = {
  id: "CP-3",
  name: "MemoryAdapter on ctx.deps — hybrid (reference=control, content=data)",
  planes: ["control", "data"],
  bugToday: false,
  bugAtScale: false,
  typeSplitPrevents: false,
  assessment:
    "Hybrid — adapter reference is control-plane (non-serialisable, lifecycle-owning), " +
    "but the VALUES read/written are data-plane content. This is structurally analogous " +
    "to HTTP: the TCP socket is infrastructure (control), the body bytes are data. " +
    "A type-level split would put deps on ControlPlane — factually correct but adds " +
    "ceremony without preventing bugs. Convention (JSDoc @data-adjacent) is sufficient.",
};

// ---------------------------------------------------------------------------
// CP-4: Result.err carries error data (data) but NonRetryableError is control
//
// In the current shape:
//   Result<T, E> is a data-plane value — it IS the atom or the failure.
//   But within E, the error CODE drives RETRY ROUTING — a control-plane concern.
//
// Example from ADR-v1-I-3: Err<E> gains optional `retryable?: boolean`.
// The `retryable` field is read by the kitStep() shim to decide whether to
// throw NonRetryableError. This is control-plane routing based on data-plane values.
//
// Does conflation cause bugs?
//   YES — subtly. An error code like "source_auth_failed" is data-plane
//   (observable, emitted by stage). Its MAPPING to "retryable: false" is
//   control-plane (drives Inngest retry). If both live on the same Err<E> type,
//   a developer might forget to set retryable: false for auth failures,
//   causing silent retry budget exhaustion. The type system doesn't enforce
//   the mapping (code → retryable must be documented, not typed).
//
// Would a type-level split prevent it? PARTIALLY — if ControlPlane owns
// retry semantics, a separate type discriminant (e.g. NonRetryable<E>) would
// force the developer to declare intent. But this mirrors the Option A
// complexity: more ceremony, same expressive power as convention + lint.
// ---------------------------------------------------------------------------

const cp4: ConflationPoint = {
  id: "CP-4",
  name: "Result.err carries data + control (code=data, retryable=control routing)",
  planes: ["data", "control"],
  bugToday: false, // retryable field not yet in kit
  bugAtScale: true, // retry budget exhaustion on permanent auth failures
  typeSplitPrevents: false, // retryable: false is opt-in metadata, not enforced by types
  assessment:
    "REAL FRICTION — not caught by type-level split. Error code is data (observable, " +
    "surfaced in Result<T,E>). Retry routing is control (drives kitStep shim). " +
    "The bug — missing retryable:false for permanent failures — is a documentation " +
    "and lint concern, not a structural type concern. An enumerated error taxonomy " +
    "(probe-error-taxonomy.ts) partially addresses this by making the mapping explicit. " +
    "Kit's error-code table should document which codes are always retryable:false.",
};

// ---------------------------------------------------------------------------
// Summary output
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const ctx = makeCtx();
  const atom = makeAtom({ value: 42 });

  // Verify the context shape compiles correctly.
  const _: Result<Atom<{ value: number }>, never> = ok(atom);
  void _;
  void ctx;

  const points: ConflationPoint[] = [cp1, cp2, cp3, cp4];

  console.log("=== CP Analysis: PipelineContext conflation points ===\n");

  let bugTodayCount = 0;
  let bugAtScaleCount = 0;
  let typeSplitHelpsCount = 0;

  for (const cp of points) {
    const planes = cp.planes.join(" + ");
    const bugLabel = cp.bugToday ? "BUG TODAY" : cp.bugAtScale ? "theoretical" : "none";
    const typeHelp = cp.typeSplitPrevents ? "YES" : "NO";
    console.log(`${cp.id}  ${cp.name}`);
    console.log(`  planes: ${planes}`);
    console.log(`  bug?   ${bugLabel}`);
    console.log(`  type-split prevents? ${typeHelp}`);
    console.log(`  note:  ${cp.assessment}`);
    console.log();

    if (cp.bugToday) bugTodayCount++;
    if (cp.bugAtScale) bugAtScaleCount++;
    if (cp.typeSplitPrevents) typeSplitHelpsCount++;
  }

  console.log("=== Summary ===");
  console.log(`Conflation points: ${points.length}`);
  console.log(`Bugs today:       ${bugTodayCount}`);
  console.log(`Bugs at scale:    ${bugAtScaleCount}`);
  console.log(`Type-split helps: ${typeSplitHelpsCount} / ${points.length}`);
  console.log();
  console.log("Finding: type-level split prevents bugs at only 1 of 4 conflation points (CP-2: OTel span PII).");
  console.log("The split adds ceremony at all 4 points.");
  console.log("Verdict direction: CONVENTION with @plane JSDoc annotations; typed helpers at OTel boundary.");

  // Confirm cp4 specific: error taxonomy probe can enumerate retryable:false codes.
  const errResult = err({ type: "secrets_error" as const, code: "secret_not_found" as const, message: "not found" });
  console.log("\n[type-check] err variant compiles:", !errResult.ok);
}

await main();
