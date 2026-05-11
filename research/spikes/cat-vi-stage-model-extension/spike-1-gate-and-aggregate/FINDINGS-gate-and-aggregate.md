# Spike #1 — gate-and-aggregate FINDINGS

> Spike: throwaway structural probe — do `Gate<I>` and `Aggregate<I[],O>`
> need new stage type interfaces, or do they collapse to existing
> `Process<I,O>` + Composer config?
> Location: `research/spikes/cat-vi-stage-model-extension/spike-1-gate-and-aggregate/`
> Author: Executor — 2026-05-11.
> Friction anchor: F-PRIMITIVE (catalog top-15 #3).
> Status: spike output (NOT a notes file; brain synthesises
> `docs/research-notes-v1-cat-VI.md` later, after additional spikes).
> Companion: `docs/research-outline-v1.md` § Category VI (Stage Model Extension).

## §1. SETUP

- No external runtime deps (`devDependencies` only: typescript, tsx, zod, @types/node).
- Strictly typed; no `any`; ESM; Bun-runnable. All probes pass with exit 0.
- 4 probe files: `probe-gate.ts`, `probe-aggregate.ts`,
  `probe-process-subtyping.ts`, `probe-reviewable-subsumption.ts`.
- Shared type exploration in `src/types.ts`.
- Scenarios:
  - **Gate**: content moderation (profane → reject; uncertain → hold; clean → pass; trailing whitespace → transform). 4 atoms. 3 implementations (A/B/C) + chaining probe.
  - **Aggregate**: batch-summarise 5 classified atoms into 1 summary. Count window. 3 implementations (A/B/C) + backpressure probe.
  - **Process sub-typing**: cardinality table (1:1, 1:N, N:1, 1:0). TypeScript proof that no new interfaces are needed.
  - **Reviewable subsumption**: does Gate<I> ⊇ Reviewable<I>? Content with editable fields.

**Run commands (from spike directory):**

```
bun run src/probe-gate.ts
bun run src/probe-aggregate.ts
bun run src/probe-process-subtyping.ts
bun run src/probe-reviewable-subsumption.ts
```

---

## §2. OBSERVATIONS

### O1 — Gate<I>: dedicated type vs Process<I,I>

Three ways to implement the same content moderation logic:

**Way A** (`GateA<I>` with `evaluate()` → `GateDecision<I>`):

```
[A] atom=pk_atom_profane action=reject reason="profanity detected"
[A] atom=pk_atom_uncertain action=hold reason="uncertainty score too high..."
[A] OBSERVATION: GateDecision<I> is NOT Result<Atom<I>, StageError>.
    Callers must handle a SECOND return-type vocabulary. Kit uniformity broken.
```

**Way B** (`Process<I, I>` with StageError.code = `gate_rejected` / `gate_held`):

```
[B] atom=pk_atom_profane action=gate_rejected retryable=false
[B] atom=pk_atom_uncertain action=gate_held retryable=true
[B] OBSERVATION: Process<I, I> fully expresses gate semantics.
    hold/reject encoded in StageError.code + retryable. Kit uniformity preserved.
```

**Way C** (Composer config predicate — no stage type):

```
[C] atom=pk_atom_uncertain action=hold holdAction=hrp_waitForEvent timeout=PT24H
[C] OBSERVATION: gate-as-config is most declarative but NOT a kit stage.
    OTel trace has no 'gate' span. Way B preserves stage observability.
```

**LOC comparison (implementation only):**

| Way | LOC | Type safety | OTel span | Kit uniformity |
|-----|-----|-------------|-----------|----------------|
| A   | ~9  | GateDecision (new vocab) | YES | BROKEN |
| B   | ~22 | StageError.code (existing vocab) | YES | PRESERVED |
| C   | ~12 | predicate return type | NO | PRESERVED |

**Chain probe:**

```
[chain] Process<I,I> chains naturally via standard Composer wiring.
GateA<I> would need a separate Composer.chain(gate1, gate2) method.
```

**Key question answered:** Does Gate add type-level guarantees that `Process<I,I>` cannot express?

NO. The 4 gate actions map exactly onto the existing Result vocabulary:
- `ok(outputAtom)` — pass or transform
- `err({ code: "gate_held", retryable: true })` — hold → HRP waitForEvent (ADR-I-5)
- `err({ code: "gate_rejected", retryable: false })` — reject → NonRetryableError (ADR-I-3)

`GateDecision<I>` introduces a parallel return type vocabulary at zero structural benefit. Way A also cannot wire into a Composer pipeline uniformly with `Process<I,O>` — the Composer would need a dedicated `through(gate)` overload distinct from `through(process)`.

---

### O2 — Aggregate<I[],O>: dedicated type vs Process<I[],O> + buffer config

All three ways produce identical output:

```
[A] summary: count=5 avg=0.77 cats=[finance,health,tech]
[A] OBSERVATION: Composer owns buffer. AggregateA.window is metadata only.

[B] summary: count=5 avg=0.77 cats=[finance,health,tech]
[B] OBSERVATION: Composer buffer config = AggregateA.window. Same semantics.
    Process<I[], O> expresses aggregate with NO new stage type.

[C] summary: count=5 avg=0.77 cats=[finance,health,tech]
[C] OBSERVATION: Source inversion creates upstream coupling.
    Valid for 'materialised summary sources'; wrong for general aggregate.
```

**Key question answered:** Who owns buffering — the stage type or the Composer?

**The Composer owns buffering.** In Way A, `AggregateA.window` is metadata — the
Composer still fills the buffer and calls `accumulate()`. Moving `.window` from
the stage type to Composer config has zero semantic effect. `AggregateA<I,O>` is
structurally `Process<I[], O>` with `.window` attached. TypeScript expresses
`Process<ClassifiedAtom[], SummaryAtom>` today with no new interface.

**Backpressure probe:**

```
backpressure probe: 2 batches, 104ms (2 slow flushes × 50ms ≈ 100ms)
Composer-owned buffer naturally applies backpressure via async-sequential pull.
```

**Industry consensus validates this:**
- **Apache Beam:** `CombineFn` has no window knowledge — windowing is framework-provided.
- **Kafka Streams:** `.groupByKey().aggregate()` — aggregate function knows nothing about window boundaries.
- **Flink:** `WindowedStream.aggregate(AggregateFunction)` — same split.

All three major streaming frameworks: windowing/buffering belongs to the framework (Composer), not the accumulator function (stage).

**Way C disqualifier:** Source inversion couples the aggregate to its upstream at construction time. Composer cannot freely reorder stages. Special-case pattern only (materialised views).

---

### O3 — Process sub-typing: cardinality table

```
1:1 classify: category=finance confidence=0.9
1:N route:    destinations=[finance-queue, audit-log]
N:1 aggregate: count=3 cats=[finance,general]
1:0 filter:   1/2 atoms passed (length >= 10)

Type safety proof: all 3 Process variants are Process<I,O> — no new interface.
  classify1to1 isProcess: true
  route1toN    isProcess: true
  aggregate    isProcess: true
```

| Pattern | TypeScript type           | New interface? | Note |
|---------|--------------------------|----------------|------|
| 1:1     | `Process<I, O>`           | NO             | current kit type |
| 1:N     | `Process<I, O[]>`         | NO             | array in output type |
| N:1     | `Process<I[], O>`         | NO             | array in input type |
| 1:0     | `(atom: Atom<I>) => bool` | NO             | Composer predicate |

TypeScript's structural typing handles all cardinality sub-types via generic instantiation. Interface shape does not change — only type parameters change.

`Process<I, never>` (1:0 as Process) is type-valid but semantically broken — the ok path is unreachable. Filter is NOT a Process; it is a Composer predicate. Aligns with Beam/Kafka/Flink: all use predicates (not transforms) for filtering.

Side effects and determinism: runtime/convention, not structural types. No sub-type needed.

---

### O4 — Reviewable<I> subsumption

```
Via Reviewable<I> (v0, with edit delta):
  atom=pk_atom_long_title_content decision=edit editedFields=[title] newTitle="Edited Title"

Via GateA<I> wrapping Reviewable (edit delta LOST):
  atom=pk_atom_long_title_content action=transform [edit delta: NOT in GateDecision envelope]

Via GateB/Process<I,I> wrapping Reviewable (edit delta LOST):
  atom=pk_atom_long_title_content ok=true editedFields=absent (delta lost without metadata)
```

| Axis | Gate ⊇ Reviewable? |
|------|--------------------|
| Control flow (pass/hold/reject/transform ← approve/hold/reject/edit) | YES |
| Field-level edit semantics (`Partial<I>` delta, `applyEdits`, `edited_fields`) | NO |

`GateDecision.transform` carries the full mutated `Atom<I>` — the reviewer's sparse
delta (`Partial<I>`) is lost. This matters for:
1. Audit trail (which fields changed).
2. Cat V §Q3 feedback loop (`wasEdited` + field deltas → `memory.write()`).
3. Edit validation (`applyEdits()` enforces `editable: true` field constraint).

**Resolution:** Both `Gate<I>` and `Reviewable<I>` are `Process<I, I>`. They are named
patterns at the adapter tier, not competing types. `Reviewable<I>` stays as a
`Process<I, I>` specialisation with field-level audit semantics. No generalisation needed.

---

### O5 — Industry comparison

| System | Gate type? | Aggregate type? | Windowing owner |
|--------|------------|-----------------|-----------------|
| Apache Beam | No — DoFn drops atoms | CombineFn (separate) | Framework (PTransform) |
| Kafka Streams | `.filter()` predicate | `.aggregate()` on KGroupedStream | Framework (window DSL) |
| Flink | `.filter()` predicate | `WindowedStream.aggregate()` | Framework (window assigner) |
| LangGraph | Conditional edges (not gate node) | State reducers | Framework (graph engine) |
| Effect.ts | `.filterOrFail()` | No aggregate primitive | N/A (functional composition) |

**Pattern:** NO industry streaming system has a dedicated Gate stage type. The
absence in Beam/Kafka/Flink/LangGraph is not an oversight — gate semantics are
fully expressible as transforms with conditional drop/hold output. Adding a Gate
type fragments the transform pipeline without adding expressiveness.

---

## §3. VERDICT

### Gate<I>

**NO new stage type.** `Gate<I>` collapses entirely to `Process<I, I>` with two
conventions:
- `err({ code: "gate_held", retryable: true })` → Composer maps to HRP `waitForEvent` (ADR-I-5).
- `err({ code: "gate_rejected", retryable: false })` → Composer maps to `NonRetryableError` (ADR-I-3).

These conventions should be documented as a named pattern ("gate pattern") in
v1 kit docs, but require no interface changes.

### Aggregate<I[],O>

**NO new stage type.** `Aggregate<I[], O>` collapses to `Process<I[], O>` with
Composer buffer config.

**Partial — one Composer enhancement needed:** Composer needs a `buffer({ window })`
configuration option that fills the atom array before calling the wrapped
`Process<I[], O>`. This is a Composer config enhancement, not a new stage interface.
Window config (`count/time/all`) lives on the Composer, not on the stage.

### Process sub-typing

**NO specialization.** TypeScript generics already express all 4 cardinality patterns.
`Process<I,O>` is correctly broad. Side effects and determinism are convention +
documentation, not structural types.

### Reviewable<I>

**Unchanged.** v0 `Reviewable<I>` is a named `Process<I, I>` specialisation with
field-level audit semantics. `Gate<I>` does not subsume it. No generalisation needed.

---

## §4. CARRY-FORWARDS

1. **Composer buffer config shape** (Cat VI ADR candidate). `Composer.through(process, { buffer: { window: { type: 'count', n: 5 } } })` is the minimal API to enable `Process<I[], O>` aggregate. Brain should ADR the window config shape (count/time/all) at Cat VI synthesis. Cross-cuts Cat I (Inngest adapter — how does `kitStep()` interact with buffered batches?).

2. **StageError code taxonomy for gate patterns** (Cat VI ADR candidate). `gate_held` and `gate_rejected` are new error codes. Brain should lock the full `StageError.code` enum at Cat VI synthesis. Cross-cuts Cat I ADR-I-3 (NonRetryableError mapping).

3. **`hold` timeout propagation path** (Cat I / Cat VI cross-cut). When a `Process<I,I>` gate returns `err({ code: "gate_held", retryable: true })`, the Composer must pass the timeout to the HRP `waitForEvent` step (ADR-I-5). Brain should decide whether timeout lives in `StageError.metadata` or as a dedicated field.

4. **Reviewable<I> feedback loop via MemoryAdapter** (Cat V cf #12 / Cat I cf #12). Reviewable edit deltas (`Partial<I>`) should be storable in `MemoryAdapter` for next-run feedback (Cat V §Q3 — `EditableField` feedback loop). Cross-cuts Cat V ADR-V-3.

5. **`Disposable` lifecycle and buffering-Source inversion** (Cat VI / Cat V ADR-V-2). If an `AggregateC`-style buffering-Source is ever needed, it owns an upstream `Source<I>` reference that may be `Disposable`. Composer `DisposableRegistry` (Cat V ADR-V-2) must handle nested disposables. Not a v1 blocker.

6. **1:N cardinality and Composer fan-out reconciliation** (Cat IV carry). `Process<I, O[]>` returns `Atom<O[]>` — a single atom whose payload is an array. Composer must decide: flatten into N downstream atoms (fan-out), or pass array as-is. Cross-cuts Cat IV `FINDINGS-fan-out-compose.md` §O4.

7. **`Process<I, never>` formal disqualification** (ADR note). Brain should add a note to the Cat VI ADR disqualifying this pattern and confirming that 1:0 filtering is always a Composer predicate.

---

## §5. STATUS

Throwaway code; single spike; no kit-core amendments; no ADR drafts in this file.
Four probes clean (no TypeScript errors, no runtime errors, all assertions logged
as expected).

Brain synthesises in `docs/research-notes-v1-cat-VI.md` after additional Cat VI
spikes (Spike B: two-plane).

*Author: Executor — 2026-05-11. Master tip at spike start: `856d918`.*
*Strict TS clean; Result<T,E> only; no `any`; ESM; Bun-runnable.*
