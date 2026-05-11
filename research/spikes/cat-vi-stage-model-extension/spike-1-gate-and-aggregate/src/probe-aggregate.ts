/**
 * Cat VI spike #1 — probe-aggregate.ts
 *
 * Scenario: collect 5 classified atoms, produce one summary atom.
 * - Input payload:  { id: string; category: string; score: number }
 * - Output payload: { totalCount: number; avgScore: number; categories: string[] }
 *
 * Three implementations:
 *   Way A — AggregateA<I, O>: dedicated stage type with accumulate() + window
 *   Way B — Process<I[], O>: array-input Process + simulated Composer buffer config
 *   Way C — Source<O> inversion: buffering Source that pulls from upstream
 *
 * Key question: who owns buffering semantics? The stage type or the Composer?
 *
 * Industry context inline:
 *   - Apache Beam: CombineFn is a SEPARATE concern from DoFn. Windowing is
 *     framework-owned (not stage-owned).
 *   - Kafka Streams: .groupByKey().aggregate() — aggregate requires a
 *     WindowedStream (framework-owned window, not stage-owned).
 *   - Flink: WindowedStream.aggregate(AggregateFunction) — same: window is
 *     framework-provided to the aggregate function.
 *   Conclusion: industry consensus is that windowing/buffering belongs to
 *   the FRAMEWORK (Composer), not the aggregate stage type itself.
 */

import {
  type AggregateA,
  type AggregateB,
  type AggregateC,
  type Atom,
  type PipelineContext,
  type Result,
  type Source,
  type StageError,
  type WindowConfig,
  err,
  makeAtom,
  ok,
} from "./types.js";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface ClassifiedAtom {
  id: string;
  category: string;
  score: number;
}

interface SummaryAtom {
  totalCount: number;
  avgScore: number;
  categories: string[];
  windowType: string;
}

// ---------------------------------------------------------------------------
// Shared accumulation logic
// ---------------------------------------------------------------------------

function summarise(atoms: Atom<ClassifiedAtom>[]): SummaryAtom {
  const scores = atoms.map((a) => a.data.score);
  const avg = scores.reduce((s, x) => s + x, 0) / scores.length;
  const cats = [...new Set(atoms.map((a) => a.data.category))].sort();
  return {
    totalCount: atoms.length,
    avgScore: Math.round(avg * 100) / 100,
    categories: cats,
    windowType: "count-5",
  };
}

// ---------------------------------------------------------------------------
// Way A: AggregateA<I, O> — dedicated stage type
//
// LOC: ~18 LOC implementation + ~25 LOC simulated Composer buffer
// Type safety: window config is co-located with the accumulate() method.
//   Pros: self-documenting (AggregateA.window tells you buffering policy).
//   Cons: the Composer STILL needs to own the buffer (accumulate() receives
//         an already-filled []). The type carries window info but the
//         EXECUTION is still Composer-side. This is a leaky abstraction.
// Observation: AggregateA is semantically Process<I[], O> with window
//   metadata ATTACHED to the stage. The metadata doesn't change what the
//   Composer must do — it still owns buffering.
// ---------------------------------------------------------------------------

function makeCountAggregateA(
  n: number,
): AggregateA<ClassifiedAtom, SummaryAtom> {
  return {
    type: "aggregate",
    id: "pk_agg_summary_a",
    window: { type: "count", n },
    async accumulate(
      atoms: Atom<ClassifiedAtom>[],
      _ctx: PipelineContext,
    ): Promise<Result<Atom<SummaryAtom>, StageError>> {
      if (atoms.length < n) {
        return err({
          type: "stage_error",
          code: "aggregate_incomplete",
          message: `need ${n} atoms, got ${atoms.length}`,
          retryable: true,
        });
      }
      return ok(
        makeAtom(`pk_atom_summary_a_${Date.now()}`, summarise(atoms)),
      );
    },
  };
}

/** Simulated Composer buffer for AggregateA: collects until window is full. */
async function composerBufferA(
  source: Atom<ClassifiedAtom>[],
  agg: AggregateA<ClassifiedAtom, SummaryAtom>,
  ctx: PipelineContext,
  label: string,
): Promise<void> {
  const window = agg.window;
  const n = window.type === "count" ? window.n : source.length;
  const buffer: Atom<ClassifiedAtom>[] = [];

  for (const atom of source) {
    buffer.push(atom);
    if (buffer.length >= n) {
      const result = await agg.accumulate(buffer.splice(0, n), ctx);
      if (result.ok) {
        console.log(
          `  [${label}] summary: count=${result.value.data.totalCount} avg=${result.value.data.avgScore} cats=[${result.value.data.categories}]`,
        );
      } else {
        console.log(`  [${label}] ERR: ${result.error.message}`);
      }
    }
  }
  // NOTE: The Composer owns the buffer[] and the window boundary check.
  // The stage type just holds the window config as METADATA.
  // Compare: Flink WindowedStream.aggregate(fn) — fn has no window knowledge.
  console.log(
    `  [${label}] OBSERVATION: Composer owns buffer. AggregateA.window is metadata only.`,
  );
}

async function runWayA(
  atoms: Atom<ClassifiedAtom>[],
  ctx: PipelineContext,
): Promise<void> {
  console.log("\n--- Way A: AggregateA<I,O> dedicated stage type ---");
  const agg = makeCountAggregateA(5);
  await composerBufferA(atoms, agg, ctx, "A");
}

// ---------------------------------------------------------------------------
// Way B: Process<I[], O> + Composer buffer config
//
// LOC: ~14 LOC implementation + ~20 LOC simulated Composer buffer
// Type safety: Process<ClassifiedAtom[], SummaryAtom> — TypeScript expresses
//   this TODAY with no new interface. The array type [] in the input is the
//   only difference from Process<I, O>.
// Who owns buffering? Same as A: the Composer fills the array before calling
//   run(). The stage just operates on the filled array.
// Observation: Process<I[], O> is structurally identical to AggregateA<I,O>
//   minus the .window metadata field. Both require Composer-side buffering.
// ADR direction: ship buffer config on COMPOSER, not on stage type.
// ---------------------------------------------------------------------------

function makeCountAggregateB(): AggregateB<ClassifiedAtom, SummaryAtom> {
  return {
    id: "pk_proc_summary_b",
    async run(
      atom: Atom<ClassifiedAtom[]>,
      _ctx: PipelineContext,
    ): Promise<Result<Atom<SummaryAtom>, StageError>> {
      const atoms = atom.data;
      if (atoms.length === 0) {
        return err({
          type: "stage_error",
          code: "aggregate_incomplete",
          message: "empty batch",
          retryable: true,
        });
      }
      return ok(
        makeAtom(`pk_atom_summary_b_${Date.now()}`, summarise(
          atom.data.map((d, i) =>
            makeAtom(`pk_inner_${i}`, d),
          ),
        )),
      );
    },
  };
}

/** Simulated Composer buffer config for Process<I[], O>. */
interface ComposerBufferConfig {
  window: WindowConfig;
}

async function composerBufferB(
  source: Atom<ClassifiedAtom>[],
  proc: AggregateB<ClassifiedAtom, SummaryAtom>,
  config: ComposerBufferConfig,
  ctx: PipelineContext,
  label: string,
): Promise<void> {
  const n =
    config.window.type === "count" ? config.window.n : source.length;
  const buffer: ClassifiedAtom[] = [];

  for (const atom of source) {
    buffer.push(atom.data);
    if (buffer.length >= n) {
      const batchData = buffer.splice(0, n);
      const batchAtom = makeAtom(`pk_batch_${Date.now()}`, batchData);
      const result = await proc.run(batchAtom, ctx);
      if (result.ok) {
        console.log(
          `  [${label}] summary: count=${result.value.data.totalCount} avg=${result.value.data.avgScore} cats=[${result.value.data.categories}]`,
        );
      } else {
        console.log(`  [${label}] ERR: ${result.error.message}`);
      }
    }
  }
  // Key finding: ComposerBufferConfig.window is IDENTICAL to
  // AggregateA.window. Moving window config from the stage type to the
  // Composer config object has ZERO semantic effect. The Composer
  // behaviour is identical. The only difference is WHERE the config lives.
  // Way B is strictly simpler: Process<I[], O> needs no new interface.
  console.log(
    `  [${label}] OBSERVATION: Composer buffer config = AggregateA.window. Same semantics.`,
  );
  console.log(
    `  [${label}] Process<I[], O> expresses aggregate with NO new stage type.`,
  );
}

async function runWayB(
  atoms: Atom<ClassifiedAtom>[],
  ctx: PipelineContext,
): Promise<void> {
  console.log("\n--- Way B: Process<I[], O> + Composer buffer config ---");
  const proc = makeCountAggregateB();
  await composerBufferB(atoms, proc, { window: { type: "count", n: 5 } }, ctx, "B");
}

// ---------------------------------------------------------------------------
// Way C: Source<SummaryAtom> inversion — aggregate IS the source
//
// LOC: ~35 LOC implementation
// Type safety: AggregateC<I, O> implements Source<O>. pull() is an
//   AsyncIterable<Result<Atom<O>>> — standard Source contract.
// Who owns buffering? The aggregate stage ITSELF — it pulls from upstream.
//   This is the Kafka KTable / Flink WindowedStream inversion pattern.
// Observation: this works BUT creates a tight coupling between the
//   aggregate stage and its upstream Source. Composers can't freely
//   reorder stages. It's also MORE code than Way B.
// When is it valid? When the aggregation IS the source semantics — e.g.,
//   a daily-summary source that materialises from an events stream.
//   This is a SPECIAL CASE, not the general aggregate pattern.
// ---------------------------------------------------------------------------

function makeSourceC(
  items: Atom<ClassifiedAtom>[],
): Source<ClassifiedAtom> {
  return {
    id: "pk_src_classified",
    async *pull(_ctx: PipelineContext) {
      for (const atom of items) {
        yield ok(atom);
      }
    },
  };
}

function makeCountAggregateC(
  upstream: Source<ClassifiedAtom>,
  n: number,
): AggregateC<ClassifiedAtom, SummaryAtom> {
  const src = upstream;
  return {
    type: "buffering-source",
    id: "pk_src_summary_c",
    window: { type: "count", n },
    upstream: src,
    async flush(
      atoms: Atom<ClassifiedAtom>[],
      _ctx: PipelineContext,
    ): Promise<Result<Atom<SummaryAtom>, StageError>> {
      return ok(
        makeAtom(`pk_atom_summary_c_${Date.now()}`, summarise(atoms)),
      );
    },
    async *pull(ctx: PipelineContext): AsyncIterable<Result<Atom<SummaryAtom>, StageError>> {
      const buffer: Atom<ClassifiedAtom>[] = [];
      for await (const result of src.pull(ctx)) {
        if (!result.ok) {
          yield err(result.error);
          continue;
        }
        buffer.push(result.value);
        if (buffer.length >= n) {
          yield await this.flush(buffer.splice(0, n), ctx);
        }
      }
      // Flush remainder on source exhaustion (type: "all" window semantics)
      if (buffer.length > 0) {
        yield await this.flush(buffer, ctx);
      }
    },
  };
}

async function runWayC(
  atoms: Atom<ClassifiedAtom>[],
  ctx: PipelineContext,
): Promise<void> {
  console.log("\n--- Way C: Source<SummaryAtom> inversion ---");
  const upstream = makeSourceC(atoms);
  const aggC = makeCountAggregateC(upstream, 5);

  for await (const result of aggC.pull(ctx)) {
    if (result.ok) {
      console.log(
        `  [C] summary: count=${result.value.data.totalCount} avg=${result.value.data.avgScore} cats=[${result.value.data.categories}]`,
      );
    } else {
      console.log(`  [C] ERR: ${result.error.message}`);
    }
  }
  // This works but creates tight upstream coupling. The aggregate stage
  // cannot be placed freely in a Composer pipeline — it owns its upstream.
  console.log(
    "  [C] OBSERVATION: Source inversion creates upstream coupling.",
  );
  console.log(
    "      Valid for 'materialised summary sources'; wrong for general aggregate.",
  );
}

// ---------------------------------------------------------------------------
// Backpressure probe
// ---------------------------------------------------------------------------

async function probeBackpressure(ctx: PipelineContext): Promise<void> {
  console.log("\n--- Backpressure probe ---");
  // Simulate a slow flush (50ms) with a fast upstream (10 atoms)
  // Way B: Composer-owned buffer means Composer controls backpressure.
  //   If the Composer is async-sequential it naturally applies backpressure:
  //   it won't pull the next atom until the current batch is flushed.
  //   This is consistent with kit's AsyncIterable Source contract.
  // Way A: Same as B — Composer owns the buffer, so same backpressure story.
  // Way C: The aggregate Source owns the buffer AND the upstream pull.
  //   Backpressure is internal to the stage — harder to observe externally.

  const slowFlush = async (atoms: Atom<ClassifiedAtom>[]) => {
    await new Promise((r) => setTimeout(r, 50)); // simulate slow LLM summarise
    return summarise(atoms);
  };

  const start = Date.now();
  const atoms = Array.from({ length: 10 }, (_, i) =>
    makeAtom(`pk_atom_bp_${i}`, {
      id: `bp_${i}`,
      category: "test",
      score: 0.5,
    }),
  );

  // Way B with slow flush: Composer waits for flush before pulling next window
  let batchCount = 0;
  const buffer: ClassifiedAtom[] = [];
  for (const atom of atoms) {
    buffer.push(atom.data);
    if (buffer.length >= 5) {
      await slowFlush(
        buffer.splice(0, 5).map((d, i) => makeAtom(`pk_inner_bp_${i}`, d)),
      );
      batchCount++;
    }
  }

  const elapsed = Date.now() - start;
  console.log(
    `  backpressure probe: ${batchCount} batches, ${elapsed}ms (2 slow flushes × 50ms ≈ 100ms)`,
  );
  console.log(
    "  Composer-owned buffer naturally applies backpressure via async-sequential pull.",
  );
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

const TEST_ATOMS: Atom<ClassifiedAtom>[] = [
  makeAtom("pk_atom_c1", { id: "c1", category: "finance", score: 0.8 }),
  makeAtom("pk_atom_c2", { id: "c2", category: "tech", score: 0.9 }),
  makeAtom("pk_atom_c3", { id: "c3", category: "finance", score: 0.7 }),
  makeAtom("pk_atom_c4", { id: "c4", category: "health", score: 0.6 }),
  makeAtom("pk_atom_c5", { id: "c5", category: "tech", score: 0.85 }),
];

const CTX: PipelineContext = {
  run_id: "pk_run_cat_vi_spike_1_aggregate",
  signal: new AbortController().signal,
};

console.log("### Cat VI spike #1 — probe-aggregate.ts ###");
console.log("Scenario: batch-summarise 5 classified atoms (count window)");

await runWayA(TEST_ATOMS, CTX);
await runWayB(TEST_ATOMS, CTX);
await runWayC(TEST_ATOMS, CTX);
await probeBackpressure(CTX);

console.log("\n=== Aggregate Probe Summary ===");
console.log("Way A (AggregateA<I,O>):  window config on stage; Composer still owns buffer.");
console.log("Way B (Process<I[],O>):   window config on Composer; no new type needed.");
console.log("Way C (Source inversion): tight upstream coupling; special-case only.");
console.log("Industry consensus: windowing belongs to FRAMEWORK (Beam/Kafka/Flink all agree).");
console.log("VERDICT: Aggregate COLLAPSES to Process<I[],O> + Composer buffer config.");
