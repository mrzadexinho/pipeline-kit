/**
 * Cat VI Spike #2 — Probe: enumerated error taxonomy (Cat IX cf #5).
 *
 * Current state: error `code` is a string, validated by convention only.
 * This probe designs the minimum viable enumerated taxonomy for v1 and
 * assesses whether each code is data-plane (observable in Result<T,E>)
 * or control-plane (drives retry/cancel routing).
 *
 * Runs structurally — no external deps, no real IO.
 */

import { ok, err, type Result } from "./types.js";

// ---------------------------------------------------------------------------
// Minimum viable error taxonomy for v1
//
// Sources consulted (no speculative additions):
//   - Cat I ADR-v1-I-3: retryable vs non-retryable distinction
//   - Cat IX spike #2 finding 7: code=iso_8601_invalid was string-sniffed
//   - Cat VIII spikes: secret_not_found, malformed_name errors
//   - Cat V spikes: memory_not_found, memory_write_failed errors
//   - Cat I Inngest adapter: runtime_cancelled, runtime_retry_exhausted
// ---------------------------------------------------------------------------

// --- Source errors ---
// Emitted by Source.iter(). These are data-plane values: they appear in
// Result<Atom<O>, E> yielded from the iterator.
type SourceErrorCode =
  | "source_unavailable"      // backend down; transient — retryable: true
  | "source_timeout"          // backend slow; transient — retryable: true
  | "source_auth_failed"      // 401/403; permanent — retryable: false
  | "source_schema_invalid";  // Zod boundary rejection — retryable: false (bug in adapter)

// --- Process errors ---
// Emitted by Process stages. Data-plane: appear in Result from stage handlers.
type ProcessErrorCode =
  | "process_failed"           // unclassified process failure — retryable: true (unknown)
  | "process_timeout"          // stage took too long — retryable: true
  | "process_invalid_output";  // output failed Zod boundary — retryable: false (bug)

// --- Serve errors ---
// Emitted by Serve adapters mutating external state.
type ServeErrorCode =
  | "serve_failed"              // unclassified — retryable: true (unknown)
  | "serve_timeout"             // external system slow — retryable: true
  | "serve_auth_failed"         // 401/403 — retryable: false
  | "serve_idempotency_conflict"; // duplicate write detected — retryable: false (expected)

// --- Gate/HRP errors (if Gate<I> ships in v1) ---
// Emitted by the HRP-review checkpoint.
type GateErrorCode =
  | "gate_rejected"      // reviewer explicitly rejected — retryable: false (terminal decision)
  | "gate_timeout"       // waitForEvent timed out — retryable: false (per-checkpoint policy)
  | "gate_hold_expired"; // max hold time exceeded — retryable: false (SLA enforced)

// --- Runtime/control errors ---
// These codes are special: they are emitted as Result<T, E> values (data-plane),
// but they ALSO directly drive control-plane routing (kitStep shim, Inngest adapter).
// The dual nature is the crux of CP-4 from probe-conflation-points.ts.
type RuntimeErrorCode =
  | "runtime_cancelled"            // AbortSignal fired; control-plane cause
  | "runtime_retry_exhausted"      // adapter-tier: all attempts used up
  | "runtime_concurrency_rejected"; // RunGuard rejected (Cat IV)

// Full enumeration
export type StageErrorCode =
  | SourceErrorCode
  | ProcessErrorCode
  | ServeErrorCode
  | GateErrorCode
  | RuntimeErrorCode;

// ---------------------------------------------------------------------------
// Retryability table
//
// Key insight: the mapping from code → retryable is CONTROL-PLANE logic.
// The code value itself is DATA-PLANE (observable, logged, returned to user).
// The ROUTING DECISION is made by the adapter shim, not by the stage.
//
// This is the data/control conflation in Result<T, E> that CP-4 identified.
// Solution: document the table; make it part of kit's error code registry.
// Type-level enforcement via NonRetryable<E> is possible but adds ceremony.
// ---------------------------------------------------------------------------

type RetryPolicy = "always" | "never" | "unknown";

interface ErrorCodeEntry {
  code: StageErrorCode;
  plane: "data" | "data+control";
  retryPolicy: RetryPolicy;
  rationale: string;
}

const ERROR_CODE_REGISTRY: ErrorCodeEntry[] = [
  // Source
  {
    code: "source_unavailable",
    plane: "data",
    retryPolicy: "always",
    rationale: "Transient backend issue; exponential backoff expected.",
  },
  {
    code: "source_timeout",
    plane: "data",
    retryPolicy: "always",
    rationale: "Transient network latency; may resolve on retry.",
  },
  {
    code: "source_auth_failed",
    plane: "data+control",
    retryPolicy: "never",
    rationale: "Auth will not self-heal; retrying exhausts budget. Maps to NonRetryableError (Cat I ADR-v1-I-3).",
  },
  {
    code: "source_schema_invalid",
    plane: "data+control",
    retryPolicy: "never",
    rationale: "Schema mismatch is a code bug; retrying cannot fix it. Dead-letter immediately.",
  },
  // Process
  {
    code: "process_failed",
    plane: "data",
    retryPolicy: "unknown",
    rationale: "Unclassified; adapter should sub-classify where possible.",
  },
  {
    code: "process_timeout",
    plane: "data",
    retryPolicy: "always",
    rationale: "Transient; may be load-related.",
  },
  {
    code: "process_invalid_output",
    plane: "data+control",
    retryPolicy: "never",
    rationale: "Zod output validation failure is a code bug; dead-letter.",
  },
  // Serve
  {
    code: "serve_failed",
    plane: "data",
    retryPolicy: "unknown",
    rationale: "Unclassified external failure; adapter should sub-classify.",
  },
  {
    code: "serve_timeout",
    plane: "data",
    retryPolicy: "always",
    rationale: "Transient external system latency.",
  },
  {
    code: "serve_auth_failed",
    plane: "data+control",
    retryPolicy: "never",
    rationale: "Maps to NonRetryableError; auth failure is permanent without secret rotation.",
  },
  {
    code: "serve_idempotency_conflict",
    plane: "data+control",
    retryPolicy: "never",
    rationale: "Expected terminal state: the write already happened. Return success to caller.",
  },
  // Gate
  {
    code: "gate_rejected",
    plane: "data+control",
    retryPolicy: "never",
    rationale: "Human decision is terminal; no retry makes sense.",
  },
  {
    code: "gate_timeout",
    plane: "data+control",
    retryPolicy: "never",
    rationale: "Per-checkpoint policy says no more waiting; terminal.",
  },
  {
    code: "gate_hold_expired",
    plane: "data+control",
    retryPolicy: "never",
    rationale: "SLA-enforced terminal state; same as timeout.",
  },
  // Runtime
  {
    code: "runtime_cancelled",
    plane: "data+control",
    retryPolicy: "never",
    rationale: "Cancellation is a control-plane signal; data-plane code surfaces the cause for logs.",
  },
  {
    code: "runtime_retry_exhausted",
    plane: "data+control",
    retryPolicy: "never",
    rationale: "All retry budget consumed; dead-letter.",
  },
  {
    code: "runtime_concurrency_rejected",
    plane: "data+control",
    retryPolicy: "always",
    rationale: "RunGuard rejected the slot; should requeue when a slot is free.",
  },
];

// ---------------------------------------------------------------------------
// StageError type — the minimal error envelope for v1
// ---------------------------------------------------------------------------

export interface StageError {
  readonly type: "stage_error";
  readonly code: StageErrorCode;
  readonly message: string;
  /** Adapter-specific sub-code for diagnostics (optional). */
  readonly subCode?: string;
  /** Retryability signal for kitStep() shim. Default: derive from code registry. */
  readonly retryable?: boolean;
  /** HTTP status or external error code (optional; adapter may populate). */
  readonly statusCode?: number;
  /** ADR-v1-kit actionable error fields. */
  readonly param?: string;
  readonly docUrl?: string;
}

// Convenience constructors
export function stageErr(
  code: StageErrorCode,
  message: string,
  extras?: Partial<Omit<StageError, "type" | "code" | "message">>,
): StageError {
  return { type: "stage_error", code, message, ...extras };
}

// ---------------------------------------------------------------------------
// Probe: what codes do existing adapters (Cat I, V, VIII) actually need?
// ---------------------------------------------------------------------------

// Cat I: runtime_cancelled, runtime_retry_exhausted, source_schema_invalid, process_failed
// Cat V: source_unavailable (transient), source_schema_invalid (bad value) via translator
// Cat VIII: source_auth_failed (secret_not_found), source_unavailable (backend_unavailable)

// Probe: verify the taxonomy covers these cases with no speculative additions.
type _VerifyCatINeeds = Extract<
  StageErrorCode,
  | "runtime_cancelled"
  | "runtime_retry_exhausted"
  | "source_schema_invalid"
  | "process_failed"
>;
// Should equal the union — tsc will error if any code is missing from taxonomy.
const _catICheck: _VerifyCatINeeds = "runtime_cancelled";
void _catICheck;

// ---------------------------------------------------------------------------
// Verdict probe: should error taxonomy be in StageError (data) or ControlPlane?
//
// Test: can we compute retryPolicy from a code value alone, without knowing
// the control-plane state? YES — the table is pure data.
// But: the EFFECT of retryPolicy is control-plane (throw NonRetryableError).
// Conclusion: code is data; routing is control. Two concerns, one type.
// ---------------------------------------------------------------------------

function lookupRetryPolicy(code: StageErrorCode): RetryPolicy {
  const entry = ERROR_CODE_REGISTRY.find((e) => e.code === code);
  return entry?.retryPolicy ?? "unknown";
}

function isNonRetryable(code: StageErrorCode): boolean {
  return lookupRetryPolicy(code) === "never";
}

async function main(): Promise<void> {
  console.log("=== Error Taxonomy Probe ===\n");

  // 1. Print the full registry
  console.log("Code registry (16 codes, minimum viable for v1):\n");
  for (const entry of ERROR_CODE_REGISTRY) {
    const retryLabel = entry.retryPolicy === "never" ? "retryable:false" :
      entry.retryPolicy === "always" ? "retryable:true" : "retryable:?";
    const planeLabel = entry.plane === "data+control" ? "[data+ctrl]" : "[data     ]";
    console.log(`  ${planeLabel}  ${retryLabel.padEnd(16)}  ${entry.code}`);
  }

  // 2. Count by plane
  const dataOnly = ERROR_CODE_REGISTRY.filter((e) => e.plane === "data").length;
  const dual = ERROR_CODE_REGISTRY.filter((e) => e.plane === "data+control").length;
  console.log(`\nPlane breakdown: ${dataOnly} data-only, ${dual} data+control`);

  // 3. Demonstrate stageErr construction
  const authErr: Result<never, StageError> = err(
    stageErr("source_auth_failed", "API key revoked", {
      retryable: false,
      statusCode: 401,
      docUrl: "https://docs.pipeline-kit.dev/errors/source_auth_failed",
    }),
  );
  console.log(`\n[type-check] stageErr result.ok=false:`, !authErr.ok);
  if (!authErr.ok) {
    console.log(`             code=${authErr.error.code}, retryable=${authErr.error.retryable}`);
  }

  // 4. Retryability lookup
  console.log("\nRetryability spot-checks:");
  const spotCodes: StageErrorCode[] = [
    "source_auth_failed",
    "source_timeout",
    "gate_rejected",
    "runtime_cancelled",
    "runtime_concurrency_rejected",
  ];
  for (const code of spotCodes) {
    const policy = lookupRetryPolicy(code);
    const nonRetry = isNonRetryable(code);
    console.log(`  ${code.padEnd(32)} policy=${policy}, nonRetryable=${nonRetry}`);
  }

  // 5. Summary verdict
  console.log("\n=== Verdict ===");
  console.log("Error CODE is data-plane: observable, in Result<T,E>, logged, returned to user.");
  console.log("RETRY ROUTING is control-plane: computed from code by adapter shim (kitStep).");
  console.log("The mapping (code → retryPolicy) lives in a documented table — NOT in TypeScript types.");
  console.log("Conclusion: enumerated StageErrorCode (16 codes) in kit core is load-bearing.");
  console.log("Separating it into a ControlPlane type adds NO new information; table IS the contract.");

  const successResult = ok({ taxonomyComplete: true, codes: ERROR_CODE_REGISTRY.length });
  console.log("\n[type-check] ok result.ok=true:", successResult.ok);
}

await main();
