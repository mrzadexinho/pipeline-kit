/**
 * Cat VI spike #1 — probe-reviewable-subsumption.ts
 *
 * Question: Does Gate<I> subsume Reviewable<I>?
 *
 * v0 Reviewable<I> has:
 *   - field-level editable fields (EditableField<T>)
 *   - decision: approve / reject / edit
 *   - applyEdits(atom, edits) → new atom with field-level mutations
 *   - timeout
 *
 * Proposed Gate<I> has:
 *   - pass / hold / reject / transform
 *
 * Key probe: is Reviewable<I> expressible as Gate<I> where:
 *   hold  → sendForReview (HRP waitForEvent checkpoint)
 *   pass  → autoApprove (confidence threshold passed, no review)
 *   transform → applyEdits (reviewer made field-level changes)
 *   reject → reviewer rejected
 *
 * Or: does Reviewable<I> need field-level edit semantics that Gate<I>
 * cannot express?
 *
 * Structural finding: Gate<I> = Process<I, I>. Reviewable<I> also returns
 * the same type I (possibly mutated). So BOTH map to Process<I, I>.
 * The question reduces to: does the DECISION PAYLOAD differ structurally?
 */

import {
  type Atom,
  type EditableField,
  type GateA,
  type GateB,
  type GateDecision,
  type PipelineContext,
  type ReviewDecision,
  type ReviewableI,
  type Result,
  type StageError,
  err,
  makeAtom,
  ok,
} from "./types.js";

// ---------------------------------------------------------------------------
// Domain: content moderation with field-level editability
// ---------------------------------------------------------------------------

interface ModeratableContent {
  title: EditableField<string>;
  body: EditableField<string>;
  author: string; // NOT editable — reviewer cannot change authorship
  confidence: number; // system-assigned, NOT editable
}

// ---------------------------------------------------------------------------
// Reviewable<I> — v0 implementation
//
// applyEdits handles field-level mutations.
// Structural observation: the "edit" decision requires Partial<I> edits,
// which means the caller must know which fields ARE editable.
// Gate<I>.transform carries the ENTIRE mutated atom — it doesn't encode
// which fields were changed.
//
// This is a REAL structural difference:
//   Reviewable<I>: { decision: "edit", edits: Partial<I> } — sparse delta
//   Gate<I>.transform: { action: "transform", atom: Atom<I> } — full atom
//
// The sparse delta in Reviewable<I> is load-bearing:
//   1. The review UI can show exactly which fields changed (audit trail).
//   2. applyEdits() validates that edits only touch editable fields.
//   3. The delta can be stored in memory for feedback loops (Cat V §Q3).
// Gate<I>.transform cannot express the sparse delta natively.
// ---------------------------------------------------------------------------

function makeContentReviewable(): ReviewableI<ModeratableContent> {
  return {
    type: "reviewable",
    id: "pk_reviewable_content",
    timeout: "PT24H",

    async sendForReview(
      atom: Atom<ModeratableContent>,
      _ctx: PipelineContext,
    ): Promise<ReviewDecision<ModeratableContent>> {
      // Simulate reviewer decision (deterministic for probe)
      const hasProhibited = atom.data.body.value.includes("prohibited");
      const needsEdit = atom.data.title.value.length > 50;

      if (hasProhibited) {
        return { decision: "reject", reason: "prohibited content in body" };
      }
      if (needsEdit) {
        return {
          decision: "edit",
          atom,
          edits: { title: { value: "Edited Title", editable: true } },
        };
      }
      return { decision: "approve", atom };
    },

    applyEdits(
      atom: Atom<ModeratableContent>,
      edits: Partial<ModeratableContent>,
    ): Atom<ModeratableContent> {
      // Only apply edits to editable fields
      const merged = { ...atom.data };
      for (const [k, v] of Object.entries(edits)) {
        const key = k as keyof ModeratableContent;
        const current = merged[key];
        if (
          typeof current === "object" &&
          current !== null &&
          "editable" in current &&
          (current as EditableField<unknown>).editable === true
        ) {
          // Safe cast: editable field — reviewer may mutate
          (merged as Record<string, unknown>)[key] = v;
        }
        // Non-editable fields (author, confidence) silently ignored
      }
      return makeAtom(atom.id, merged, {
        ...atom.metadata,
        edited_fields: Object.keys(edits),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// GateA<I> wrapping Reviewable<I> — is Gate ⊇ Reviewable?
//
// Attempt to implement Reviewable<I> as a Gate<I>:
//   approve  → { action: "pass", atom }
//   reject   → { action: "reject", reason }
//   edit     → { action: "transform", atom: applyEdits(atom, edits) }
//   timeout  → { action: "hold", reason: "timed out", timeout }
//
// Structural loss: when Gate returns "transform", the caller sees a
// mutated atom but has NO metadata about which fields changed.
// The edit delta (Partial<I>) is LOST in the GateDecision envelope.
// ---------------------------------------------------------------------------

function makeGateFromReviewable(
  reviewable: ReviewableI<ModeratableContent>,
): GateA<ModeratableContent> {
  return {
    type: "gate",
    id: "pk_gate_from_reviewable",
    async evaluate(
      atom: Atom<ModeratableContent>,
      ctx: PipelineContext,
    ): Promise<GateDecision<ModeratableContent>> {
      const decision = await reviewable.sendForReview(atom, ctx);
      switch (decision.decision) {
        case "approve":
          return { action: "pass", atom: decision.atom };
        case "reject":
          return { action: "reject", reason: decision.reason };
        case "edit": {
          // Apply edits to get mutated atom — but edit DELTA is LOST
          const mutated = reviewable.applyEdits(decision.atom, decision.edits);
          return { action: "transform", atom: mutated };
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// GateB<I> wrapping Reviewable<I> — Process<I, I> version
//
// Same wrapping, now as Process<I, I>.
// The edit delta loss is identical — but the overall type is simpler.
// Result.ok carries the (possibly mutated) atom.
// Result.err carries reject / hold.
// ---------------------------------------------------------------------------

function makeProcessGateFromReviewable(
  reviewable: ReviewableI<ModeratableContent>,
): GateB<ModeratableContent> {
  return {
    id: "pk_proc_gate_from_reviewable",
    async run(
      atom: Atom<ModeratableContent>,
      ctx: PipelineContext,
    ): Promise<Result<Atom<ModeratableContent>, StageError>> {
      const decision = await reviewable.sendForReview(atom, ctx);
      switch (decision.decision) {
        case "approve":
          return ok(decision.atom);
        case "edit": {
          const mutated = reviewable.applyEdits(decision.atom, decision.edits);
          return ok(mutated); // edit delta LOST here too
        }
        case "reject":
          return err({
            type: "stage_error",
            code: "gate_rejected",
            message: decision.reason,
            retryable: false,
          });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Subsumption verdict probe
//
// Can Reviewable<I> be FULLY expressed as Gate<I>?
//   - Approve ← pass/ok            ✓ expressible
//   - Reject  ← reject/err         ✓ expressible
//   - Hold    ← hold/err(retryable)✓ expressible (maps to HRP waitForEvent)
//   - Edit    ← transform/ok       ✗ PARTIAL — edit delta not in Gate envelope
//
// Conclusion: Gate<I> ⊇ Reviewable<I> ONLY in terms of CONTROL FLOW.
// The field-level edit semantics (EditableField, applyEdits, Partial<I>
// delta, edited_fields metadata) are LOST when Reviewable wraps to Gate.
//
// Two possible resolutions:
//   (A) Carry edit delta in Atom<I>.metadata (lossy for type safety)
//   (B) Keep Reviewable<I> as a SPECIALISATION of Process<I, I> that
//       adds field-level edit semantics on top. Gate<I> is NOT needed
//       because both Reviewable<I> and a plain gate ARE Process<I, I>.
//
// Resolution (B) is cleaner: kit ships Reviewable<I> (v0), which IS
// Process<I, I> specialised with field-level audit semantics.
// Gate<I> as a NEW type adds nothing because Process<I, I> already
// expresses the control flow. The "gate" is an adapter concern — it
// wraps any Process<I, I> that uses StageError.code to signal hold/reject.
// ---------------------------------------------------------------------------

async function probeSubsumption(ctx: PipelineContext): Promise<void> {
  console.log("\n--- Reviewable<I> subsumption probe ---");

  const reviewable = makeContentReviewable();
  const gateA = makeGateFromReviewable(reviewable);
  const gateB = makeProcessGateFromReviewable(reviewable);

  const atoms: Atom<ModeratableContent>[] = [
    makeAtom("pk_atom_clean_content", {
      title: { value: "Short Title", editable: true },
      body: { value: "Clean content here", editable: true },
      author: "alice",
      confidence: 0.9,
    }),
    makeAtom("pk_atom_prohibited_content", {
      title: { value: "Normal Title", editable: true },
      body: { value: "This has prohibited content", editable: true },
      author: "bob",
      confidence: 0.5,
    }),
    makeAtom("pk_atom_long_title_content", {
      title: {
        value: "This Is A Very Very Long Title That Exceeds Fifty Characters",
        editable: true,
      },
      body: { value: "Normal body content", editable: true },
      author: "charlie",
      confidence: 0.8,
    }),
  ];

  console.log("\n  Via Reviewable<I> (v0, with edit delta):");
  for (const atom of atoms) {
    const decision = await reviewable.sendForReview(atom, ctx);
    if (decision.decision === "edit") {
      const mutated = reviewable.applyEdits(decision.atom, decision.edits);
      console.log(
        `    atom=${atom.id} decision=edit editedFields=[${mutated.metadata["edited_fields"]}] newTitle="${mutated.data.title.value}"`,
      );
    } else {
      console.log(
        `    atom=${atom.id} decision=${decision.decision}`,
      );
    }
  }

  console.log("\n  Via GateA<I> wrapping Reviewable (edit delta LOST):");
  for (const atom of atoms) {
    const decision = await gateA.evaluate(atom, ctx);
    console.log(
      `    atom=${atom.id} action=${decision.action}${
        "reason" in decision ? ` reason="${decision.reason}"` : ""
      }${
        decision.action === "transform"
          ? ` [edit delta: NOT in GateDecision envelope]`
          : ""
      }`,
    );
  }

  console.log("\n  Via GateB/Process<I,I> wrapping Reviewable (edit delta LOST):");
  for (const atom of atoms) {
    const result = await gateB.run(atom, ctx);
    if (result.ok) {
      const editedFields = result.value.metadata["edited_fields"];
      console.log(
        `    atom=${atom.id} ok=true editedFields=${editedFields ? `[${editedFields}]` : "absent (delta lost without metadata)"}`,
      );
    } else {
      console.log(
        `    atom=${atom.id} ok=false code=${result.error.code}`,
      );
    }
  }

  console.log("\n  Subsumption verdict:");
  console.log(
    "    Gate<I> ⊇ Reviewable<I> on CONTROL FLOW: pass/hold/reject/transform ← approve/hold/reject/edit",
  );
  console.log(
    "    Gate<I> ⊄ Reviewable<I> on FIELD SEMANTICS: edit delta (Partial<I>) not in Gate envelope",
  );
  console.log(
    "    Both Gate<I> and Reviewable<I> collapse to Process<I, I>.",
  );
  console.log(
    "    Reviewable<I> is a SPECIALISATION of Process<I, I> with audit metadata.",
  );
  console.log(
    "    Gate<I> is NOT needed as a new type — it is a named pattern on Process<I, I>.",
  );
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

const CTX: PipelineContext = {
  run_id: "pk_run_cat_vi_spike_1_reviewable",
  signal: new AbortController().signal,
};

console.log("### Cat VI spike #1 — probe-reviewable-subsumption.ts ###");
console.log("Question: Gate<I> ⊇ Reviewable<I>?\n");

await probeSubsumption(CTX);

console.log("\n=== Reviewable Subsumption Summary ===");
console.log("Reviewable<I> decisions: approve / reject / edit (sparse delta) / [implicit hold via timeout]");
console.log("Gate<I>       actions:   pass  / reject / transform (full atom)  / hold");
console.log("");
console.log("Control flow: Gate ⊇ Reviewable (all decisions expressible).");
console.log("Field semantics: Gate CANNOT express sparse edit delta natively.");
console.log("");
console.log("Resolution: Reviewable<I> stays as a Process<I,I> specialisation.");
console.log("            Gate<I> = Process<I,I> with hold/reject encoded in StageError.");
console.log("            No new Gate stage type. No new Reviewable generalization.");
console.log("            BOTH are Process<I, I>. The distinction is in the ADAPTER.");
