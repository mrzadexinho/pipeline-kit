/**
 * Cat VI spike #1 — probe-gate.ts
 *
 * Scenario: content moderation gate.
 * - Atom payload: { text: string; author: string }
 * - Rules:
 *   - Contains known profanity  → reject (permanent drop)
 *   - Uncertainty score >= 0.5  → hold (send for human review)
 *   - Clean                     → pass (or transform: strip trailing whitespace)
 *
 * Three implementations, same scenario:
 *   Way A — Gate<I> as dedicated stage type (GateA<ContentAtom>)
 *   Way B — Process<I, I> encoding gate semantics in Result + StageError codes
 *   Way C — Composer config predicate (gate is pure config, not a type)
 *
 * Each runs 4 atoms: clean, profane, uncertain, borderline-clean.
 * Structured log output shows per-atom decision + implementation label.
 */

import {
  type Atom,
  type GateA,
  type GateB,
  type GateComposerConfig,
  type GateDecision,
  type PipelineContext,
  type Result,
  type StageError,
  err,
  makeAtom,
  ok,
} from "./types.js";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface ContentAtom {
  text: string;
  author: string;
  uncertaintyScore: number; // 0.0–1.0; synthetic stand-in for LLM confidence
}

// ---------------------------------------------------------------------------
// Shared moderation logic (extracted to avoid repeating in A/B/C)
// ---------------------------------------------------------------------------

const PROFANITY_LIST = ["badword", "offensive"];

function hasProfanity(text: string): boolean {
  return PROFANITY_LIST.some((w) => text.toLowerCase().includes(w));
}

function computeDecision(atom: Atom<ContentAtom>): GateDecision<ContentAtom> {
  if (hasProfanity(atom.data.text)) {
    return { action: "reject", reason: "profanity detected" };
  }
  if (atom.data.uncertaintyScore >= 0.5) {
    return {
      action: "hold",
      reason: "uncertainty score too high; requires human review",
      timeout: "PT24H",
    };
  }
  // Strip trailing whitespace as a normalisation transform
  const stripped = atom.data.text.trimEnd();
  if (stripped !== atom.data.text) {
    return {
      action: "transform",
      atom: makeAtom(atom.id, { ...atom.data, text: stripped }, atom.metadata),
    };
  }
  return { action: "pass", atom };
}

// ---------------------------------------------------------------------------
// Way A: Gate<I> as dedicated stage type (Option A)
//
// LOC (implementation only, excluding driver): ~20 LOC
// Type safety: GateDecision<I> discriminated union enforces all 4 actions.
//   The compiler forces the caller to handle all branches. However,
//   GateDecision<I> is NOT in the kit's existing Result<T,E> vocabulary —
//   caller code must handle two error envelopes (StageError AND GateDecision).
// Composability: can chain gates. Caller inspects { action } discriminant.
// Relationship to Reviewable<I>: GateA<I>.evaluate() maps to
//   Reviewable<I>.sendForReview() when action='hold'. They share the
//   "hold-for-human" semantic but Reviewable adds applyEdits().
// ---------------------------------------------------------------------------

function makeContentGateA(): GateA<ContentAtom> {
  return {
    type: "gate",
    id: "pk_gate_content_moderation",
    async evaluate(
      atom: Atom<ContentAtom>,
      _ctx: PipelineContext,
    ): Promise<GateDecision<ContentAtom>> {
      return computeDecision(atom);
    },
  };
}

async function runWayA(
  atoms: Atom<ContentAtom>[],
  ctx: PipelineContext,
): Promise<void> {
  console.log("\n--- Way A: Gate<I> as dedicated stage type ---");
  const gate = makeContentGateA();
  for (const atom of atoms) {
    const decision = await gate.evaluate(atom, ctx);
    console.log(
      `  [A] atom=${atom.id} action=${decision.action}${
        decision.action === "reject" || decision.action === "hold"
          ? ` reason="${decision.reason}"`
          : ""
      }`,
    );
  }
  // LOC count: makeContentGateA = 9 LOC. Driver wiring = 8 LOC.
  // NOTE: The compiler knows gate.evaluate() returns Promise<GateDecision>,
  // NOT Promise<Result<Atom<I>, StageError>>. This breaks kit's uniform
  // stage-output contract. Callers cannot treat GateA uniformly with Process.
  console.log(
    "  [A] OBSERVATION: GateDecision<I> is NOT Result<Atom<I>, StageError>.",
  );
  console.log(
    "      Callers must handle a SECOND return-type vocabulary. Kit uniformity broken.",
  );
}

// ---------------------------------------------------------------------------
// Way B: Process<I, I> — gate as a Process with StageError codes
//
// LOC: ~22 LOC implementation
// Type safety: GateB<I> = Process<I, I>. Compiler ensures I in → I out.
//   "hold" and "reject" both encode as err(StageError). The code field
//   ('gate_held' vs 'gate_rejected') carries the semantic distinction.
//   Caller inspects err.error.code to distinguish hold from reject.
//   This IS the kit's existing Result<T,E> vocabulary — no new type needed.
// Composability: chain with any other Process<I, I>. Standard Composer wiring.
// Relationship to Reviewable<I>: hold maps to HRP waitForEvent (ADR-I-5).
//   The Composer already handles waitForEvent under Inngest adapter.
// ---------------------------------------------------------------------------

function makeContentGateB(): GateB<ContentAtom> {
  return {
    id: "pk_proc_content_gate",
    async run(
      atom: Atom<ContentAtom>,
      _ctx: PipelineContext,
    ): Promise<Result<Atom<ContentAtom>, StageError>> {
      const decision = computeDecision(atom);
      switch (decision.action) {
        case "pass":
        case "transform":
          return ok(decision.atom);

        case "hold":
          return err({
            type: "stage_error",
            code: "gate_held",
            message: decision.reason,
            retryable: true, // Composer signals HRP waitForEvent on retryable
          });

        case "reject":
          return err({
            type: "stage_error",
            code: "gate_rejected",
            message: decision.reason,
            retryable: false, // Composer maps to NonRetryableError (ADR-I-3)
          });
      }
    },
  };
}

async function runWayB(
  atoms: Atom<ContentAtom>[],
  ctx: PipelineContext,
): Promise<void> {
  console.log("\n--- Way B: Process<I, I> with StageError codes ---");
  const gate = makeContentGateB();
  for (const atom of atoms) {
    const result = await gate.run(atom, ctx);
    if (result.ok) {
      const action =
        result.value.data.text === atom.data.text ? "pass" : "transform";
      console.log(`  [B] atom=${atom.id} action=${action} (ok)`);
    } else {
      console.log(
        `  [B] atom=${atom.id} action=${result.error.code} retryable=${result.error.retryable}`,
      );
    }
  }
  // LOC count: makeContentGateB = 22 LOC. Same driver wiring.
  // NOTE: Process<I, I> is already expressible. No new stage type needed.
  // The "hold" vs "reject" distinction lives in StageError.code + .retryable.
  // Composer already handles retryable=false → NonRetryableError (ADR-I-3).
  // Composer handles retryable=true on gate_held → HRP waitForEvent (ADR-I-5).
  console.log(
    "  [B] OBSERVATION: Process<I, I> fully expresses gate semantics.",
  );
  console.log(
    "      hold/reject encoded in StageError.code + retryable. Kit uniformity preserved.",
  );
}

// ---------------------------------------------------------------------------
// Way C: Composer config predicate — gate is NOT a stage type
//
// LOC: ~12 LOC for the predicate config + ~18 LOC for the simulated Composer
// Type safety: the predicate is typed GateComposerConfig<ContentAtom>.
//   Composer takes ownership of converting predicate result to hold/reject.
//   No stage interface at all — purely declarative.
// Composability: any Process<I, I> wraps around the predicate. Most declarative.
// Relationship to Reviewable<I>: holdAction maps to the Reviewable checkpoint.
// ---------------------------------------------------------------------------

function makeContentGateC(): GateComposerConfig<ContentAtom> {
  return {
    async predicate(atom: Atom<ContentAtom>): Promise<GateDecision<ContentAtom>> {
      return computeDecision(atom);
    },
    holdAction: "hrp_waitForEvent",
    timeout: "PT24H",
  };
}

/** Simulated Composer gate wrapper: applies predicate to each atom in stream. */
async function composerWithGate<I>(
  atoms: Atom<I>[],
  config: GateComposerConfig<I>,
  ctx: PipelineContext,
  label: string,
): Promise<void> {
  for (const atom of atoms) {
    const decision = await config.predicate(atom);
    switch (decision.action) {
      case "pass":
      case "transform":
        console.log(
          `  [${label}] atom=${atom.id} action=${decision.action} holdAction=${config.holdAction}`,
        );
        break;
      case "hold":
        console.log(
          `  [${label}] atom=${atom.id} action=${decision.action} holdAction=${config.holdAction} timeout=${config.timeout}`,
        );
        break;
      case "reject":
        console.log(
          `  [${label}] atom=${atom.id} action=${decision.action} (dropped)`,
        );
        break;
    }
  }
}

async function runWayC(
  atoms: Atom<ContentAtom>[],
  ctx: PipelineContext,
): Promise<void> {
  console.log("\n--- Way C: Composer config predicate (no stage type) ---");
  const config = makeContentGateC();
  await composerWithGate(atoms, config, ctx, "C");
  // LOC count: config = 12 LOC. Composer wrapper = 18 LOC.
  // NOTE: This is purely declarative — no stage interface. Predicate logic
  // is identical to A and B (shared computeDecision). The Composer owns
  // hold/reject routing.
  // Downside: predicate is NOT a kit stage — it cannot be observed in
  // OpenTelemetry traces as a first-class stage. Way B (Process<I,I>) is
  // already observable because it IS a Process.
  console.log(
    "  [C] OBSERVATION: gate-as-config is most declarative but NOT a kit stage.",
  );
  console.log(
    "      OTel trace has no 'gate' span. Way B preserves stage observability.",
  );
}

// ---------------------------------------------------------------------------
// Chain-ability probe: can two gates compose?
// ---------------------------------------------------------------------------

async function probeGateChaining(
  ctx: PipelineContext,
): Promise<void> {
  console.log("\n--- Gate chaining probe ---");
  // Two Way-B gates in sequence:
  //   gate1: length check (reject if > 100 chars)
  //   gate2: content moderation (from above)
  const gate1: GateB<ContentAtom> = {
    id: "pk_proc_length_gate",
    async run(
      atom: Atom<ContentAtom>,
      _ctx: PipelineContext,
    ): Promise<Result<Atom<ContentAtom>, StageError>> {
      if (atom.data.text.length > 100) {
        return err({
          type: "stage_error",
          code: "gate_rejected",
          message: `text too long: ${atom.data.text.length} chars`,
          retryable: false,
        });
      }
      return ok(atom);
    },
  };

  const gate2 = makeContentGateB();

  const testAtom = makeAtom("pk_atom_chain_1", {
    text: "clean short text",
    author: "test",
    uncertaintyScore: 0.1,
  });

  const r1 = await gate1.run(testAtom, ctx);
  if (!r1.ok) {
    console.log(`  gate1 rejected: ${r1.error.message}`);
    return;
  }
  const r2 = await gate2.run(r1.value, ctx);
  if (!r2.ok) {
    console.log(`  gate2 rejected: ${r2.error.message}`);
    return;
  }
  console.log(`  chain PASS: atom=${r2.value.id}`);
  console.log(
    "  [chain] Process<I,I> chains naturally via standard Composer wiring.",
  );
  console.log(
    "  GateA<I> would need a separate Composer.chain(gate1, gate2) method.",
  );
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

const TEST_ATOMS: Atom<ContentAtom>[] = [
  makeAtom("pk_atom_clean", {
    text: "Hello world",
    author: "alice",
    uncertaintyScore: 0.1,
  }),
  makeAtom("pk_atom_profane", {
    text: "This is a badword message",
    author: "bob",
    uncertaintyScore: 0.0,
  }),
  makeAtom("pk_atom_uncertain", {
    text: "Some ambiguous content",
    author: "charlie",
    uncertaintyScore: 0.7,
  }),
  makeAtom("pk_atom_trailing_whitespace", {
    text: "Clean text with trailing spaces   ",
    author: "diana",
    uncertaintyScore: 0.1,
  }),
];

const CTX: PipelineContext = {
  run_id: "pk_run_cat_vi_spike_1_gate",
  signal: new AbortController().signal,
};

console.log("### Cat VI spike #1 — probe-gate.ts ###");
console.log("Scenario: content moderation (4 atoms: clean/profane/uncertain/trailing)");

await runWayA(TEST_ATOMS, CTX);
await runWayB(TEST_ATOMS, CTX);
await runWayC(TEST_ATOMS, CTX);
await probeGateChaining(CTX);

console.log("\n=== Gate Probe Summary ===");
console.log("Way A (dedicated GateA<I>): breaks kit's Result<T,E> uniformity.");
console.log("Way B (Process<I,I>):       preserves uniformity; hold/reject via StageError.code.");
console.log("Way C (Composer config):    most declarative; loses OTel stage span.");
console.log("VERDICT: Gate<I> COLLAPSES to Process<I,I>. No new stage type needed.");
