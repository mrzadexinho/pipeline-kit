/**
 * Cat VI spike #1 — probe-process-subtyping.ts
 *
 * Question: Is Process<I,O> too broad? Should it be sub-typed?
 *
 * Current Process handles: extract, classify, transform, filter, route,
 * enrich, validate, summarize.
 *
 * Probe: what do these sub-types ACTUALLY differ on?
 *   - Input/output cardinality: 1:1, 1:N, N:1, 1:0
 *   - Side effects: pure vs impure (external API call)
 *   - Determinism: deterministic vs non-deterministic (LLM)
 *
 * Key question: does TypeScript's generic system already express all
 * cardinality sub-types without new stage interfaces?
 *
 * Verdict preview: YES — cardinality lives in the TYPE PARAMETER, not the
 * interface shape. Side effects and determinism are documentation/convention
 * concerns, not structural type concerns.
 */

import {
  type Atom,
  type PipelineContext,
  type Process,
  type ProcessFilter,
  type ProcessManyToOne,
  type ProcessOneToMany,
  type ProcessOneToOne,
  type Result,
  type StageError,
  err,
  makeAtom,
  ok,
} from "./types.js";

// ---------------------------------------------------------------------------
// Cardinality table
// ---------------------------------------------------------------------------

/**
 * | Pattern   | TypeScript type          | Example            | New interface? |
 * |-----------|--------------------------|---------------------|----------------|
 * | 1:1       | Process<I, O>            | classify, transform | NO (current)   |
 * | 1:N       | Process<I, O[]>          | split, route        | NO             |
 * | N:1       | Process<I[], O>          | aggregate, summarise| NO             |
 * | 1:0       | (atom: Atom<I>) => bool  | filter predicate    | NO — see below |
 *
 * The 1:0 case is interesting: Process<I, never> is valid TypeScript but
 * semantically weird — an ok path that can never be reached.
 * In practice, 1:0 is a FILTER predicate, not a Process. The Composer
 * applies the filter BEFORE invoking the next stage.
 * This is exactly how Apache Beam DoFn.filter works, and how Kafka
 * KStream.filter works — it's an operator, not a transform.
 */

// ---------------------------------------------------------------------------
// 1:1 — classify
// ---------------------------------------------------------------------------

interface RawText { content: string }
interface Classified { content: string; category: string; confidence: number }

const classify1to1: ProcessOneToOne<RawText, Classified> = {
  id: "pk_proc_classify",
  async run(
    atom: Atom<RawText>,
    _ctx: PipelineContext,
  ): Promise<Result<Atom<Classified>, StageError>> {
    // Deterministic rule-based classification (no LLM)
    const category = atom.data.content.toLowerCase().includes("money")
      ? "finance"
      : "general";
    return ok(
      makeAtom(atom.id, { content: atom.data.content, category, confidence: 0.9 }),
    );
  },
};

// ---------------------------------------------------------------------------
// 1:N — route (same input type, output is array)
// ---------------------------------------------------------------------------

interface RoutedAtom { content: string; destination: string }

const route1toN: ProcessOneToMany<Classified, RoutedAtom> = {
  id: "pk_proc_route",
  async run(
    atom: Atom<Classified>,
    _ctx: PipelineContext,
  ): Promise<Result<Atom<RoutedAtom[]>, StageError>> {
    // Route to multiple destinations based on category
    const destinations =
      atom.data.category === "finance"
        ? ["finance-queue", "audit-log"]
        : ["general-queue"];
    const routedAtoms: RoutedAtom[] = destinations.map((dest) => ({
      content: atom.data.content,
      destination: dest,
    }));
    return ok(makeAtom(atom.id, routedAtoms));
  },
};

// ---------------------------------------------------------------------------
// N:1 — aggregate (array input → single output)
// ---------------------------------------------------------------------------

interface Summary { count: number; categories: string[] }

const aggregate1toN: ProcessManyToOne<Classified, Summary> = {
  id: "pk_proc_aggregate",
  async run(
    atom: Atom<Classified[]>,
    _ctx: PipelineContext,
  ): Promise<Result<Atom<Summary>, StageError>> {
    const cats = [...new Set(atom.data.map((a) => a.category))].sort();
    return ok(
      makeAtom(`pk_summary_${Date.now()}`, {
        count: atom.data.length,
        categories: cats,
      }),
    );
  },
};

// ---------------------------------------------------------------------------
// 1:0 — filter (predicate, NOT a Process)
//
// Attempting to model filter as Process<I, never>:
//
//   Process<RawText, never> — the ok path returns Atom<never>, which is
//   impossible to construct. TypeScript would allow this type but any
//   ok() call would need `ok(atom as Atom<never>)` — a forced cast.
//   This is NOT idiomatic and signals a design mismatch.
//
// The correct model: filter IS a predicate, not a transform.
// Apache Beam: DoFn that emits nothing (just returns without output.emit).
// Kafka Streams: KStream.filter(predicate) — predicate is a function.
// Flink: DataStream.filter(FilterFunction) — same.
//
// In kit terms: filter is a Composer config predicate applied BEFORE the
// next stage. It maps to Option C of the Gate probe (GateComposerConfig).
// ---------------------------------------------------------------------------

const filterShortTexts: ProcessFilter<RawText> = (atom) =>
  atom.data.content.length >= 10;

// ---------------------------------------------------------------------------
// Side effects: pure vs impure — NOT a structural type concern
//
// A Process that calls an external API is still Process<I, O>.
// The DIFFERENCE is in the implementation, not the interface.
// TypeScript has no built-in "Effect" or "IO" type at this level
// (unlike Effect.ts or Haskell IO). Convention in kit:
//   - Pure processes: deterministic, no deps, replay-safe (ADR-I-6).
//   - Impure (enrich): has deps (e.g., deps.httpClient), not replay-safe
//     without kitStep() shim (ADR-I-2).
//
// Sub-typing on side effects would require an Effect<S,E,R>-style system
// (Effect.ts). The cost: every Process would need to declare its effect
// context R. This is too invasive for v1 and orthogonal to the stage-type
// question.
//
// Verdict: side effects are a DOCUMENTATION convention, not a structural
// type constraint at the stage interface level.
// ---------------------------------------------------------------------------

type PureProcess<I, O> = Process<I, O>; // alias only — same interface

// ---------------------------------------------------------------------------
// Determinism: LLM vs rule-based — NOT a structural type concern
//
// LLM-backed Process<I, O> returns different O for same I.
// Rule-based Process<I, O> is deterministic.
// TypeScript cannot express this at the type level without higher-kinded
// types or phantom types.
//
// Kit's replay-safety constraint (ADR-I-6) is the practical consequence:
// non-deterministic processes must be wrapped in kitStep() for replay.
// This is a runtime constraint, not a structural type constraint.
//
// Verdict: determinism is a RUNTIME / DOCUMENTATION concern.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TypeScript proof: all cardinality sub-types share one interface
// ---------------------------------------------------------------------------

/**
 * Proof: Process<I,O>, Process<I,O[]>, Process<I[],O> are ALL assignable
 * to the same Process<I,O> interface when I and O are instantiated correctly.
 *
 * The interface does NOT change. Only the TYPE PARAMETERS change.
 * This is TypeScript's structural typing doing the work.
 */

function isProcess<I, O>(
  _p: Process<I, O>,
): true {
  return true;
}

// Proof that all three assignable (TypeScript compiles this, no casts)
const _p1: boolean = isProcess(classify1to1);
const _p2: boolean = isProcess(route1toN);
const _p3: boolean = isProcess(aggregate1toN);

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

const CTX: PipelineContext = {
  run_id: "pk_run_cat_vi_spike_1_subtyping",
  signal: new AbortController().signal,
};

console.log("### Cat VI spike #1 — probe-process-subtyping.ts ###");
console.log("Cardinality table: 1:1, 1:N, N:1, 1:0\n");

// 1:1
const raw1 = makeAtom("pk_atom_raw_1", { content: "big money transfer" });
const r1 = await classify1to1.run(raw1, CTX);
console.log(
  `1:1 classify: category=${r1.ok ? r1.value.data.category : "ERR"} confidence=${r1.ok ? r1.value.data.confidence : "ERR"}`,
);

// 1:N
if (r1.ok) {
  const r2 = await route1toN.run(r1.value, CTX);
  if (r2.ok) {
    console.log(
      `1:N route:    destinations=[${r2.value.data.map((a) => a.destination).join(", ")}]`,
    );
  }
}

// N:1
const classifiedBatch: Classified[] = [
  { content: "money news", category: "finance", confidence: 0.9 },
  { content: "tech news", category: "general", confidence: 0.8 },
  { content: "stock market", category: "finance", confidence: 0.95 },
];
const batchAtom = makeAtom("pk_batch_1", classifiedBatch);
const r3 = await aggregate1toN.run(batchAtom, CTX);
console.log(
  `N:1 aggregate: count=${r3.ok ? r3.value.data.count : "ERR"} cats=[${r3.ok ? r3.value.data.categories : "ERR"}]`,
);

// 1:0 filter
const rawAtoms = [
  makeAtom("pk_atom_short", { content: "hi" }),
  makeAtom("pk_atom_long", { content: "this is a longer text" }),
];
const passed = rawAtoms.filter(filterShortTexts);
console.log(`1:0 filter:   ${passed.length}/${rawAtoms.length} atoms passed (length >= 10)`);

// Type safety proof
console.log(`\nType safety proof: all 3 Process variants are Process<I,O> — no new interface.`);
console.log(`  classify1to1 isProcess: ${_p1}`);
console.log(`  route1toN    isProcess: ${_p2}`);
console.log(`  aggregate    isProcess: ${_p3}`);

console.log("\n=== Process Sub-typing Summary ===");
console.log("| Pattern | TypeScript type     | New interface? |");
console.log("|---------|---------------------|----------------|");
console.log("| 1:1     | Process<I, O>       | NO             |");
console.log("| 1:N     | Process<I, O[]>     | NO             |");
console.log("| N:1     | Process<I[], O>     | NO             |");
console.log("| 1:0     | predicate function  | NO (Composer)  |");
console.log("\nSide effects + determinism: runtime/convention, not structural types.");
console.log("VERDICT: TypeScript generics already express ALL Process cardinality sub-types.");
console.log("         No new stage interfaces needed.");
