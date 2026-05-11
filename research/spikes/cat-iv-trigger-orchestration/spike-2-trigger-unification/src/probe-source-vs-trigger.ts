/**
 * Cat IV Spike #2 — probe-source-vs-trigger.ts
 *
 * Critical comparison: the SAME cron-triggered pipeline implemented 3 ways.
 *
 *   Way A: Trigger<O> as a separate type that wraps Source<O>
 *   Way B: Source<O> that internally handles scheduling (trigger = Source config)
 *   Way C: Trigger as pure Inngest function config (no kit type at all)
 *
 * For each: count LOC, type parameters, user API surface, what changes when
 * switching from cron → webhook.
 */

import { z } from "zod";
import type { Atom, Result, Source, SourceError } from "./types.js";
import { ok, err, makeAtom } from "./types.js";

// ---------------------------------------------------------------------------
// Shared domain types (same for all 3 ways)
// ---------------------------------------------------------------------------

interface ReportItem {
  id: string;
  title: string;
  status: "pending" | "done";
}

const ReportItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["pending", "done"]),
});

// ---------------------------------------------------------------------------
// WAY A: Trigger<O> as a separate type wrapping Source<O>
//
// User writes two types: a Trigger and a Source.
// The Trigger fires → produces a TriggerEvent → Source consumes event → atoms.
// ---------------------------------------------------------------------------

namespace WayA {
  // A1. User defines a cron trigger type
  interface CronTrigger<Payload> {
    type: "trigger";
    kind: "cron";
    id: string;
    expression: string;
    fire(): Promise<Result<{ scheduledAt: string; expression: string } & { payload: Payload }, { code: string; message: string }>>;
  }

  // A2. User defines a Source that consumes the TriggerEvent
  interface TriggerAwareSource<TriggerPayload, AtomData> extends Source<AtomData> {
    fromTrigger(triggerEvent: { payload: TriggerPayload }): Promise<Result<Atom<AtomData>[], SourceError>>;
  }

  // A3. Concrete cron trigger
  export const reportCronTrigger: CronTrigger<void> = {
    type: "trigger",
    kind: "cron",
    id: "pk_trig_cron_daily",
    expression: "0 9 * * *",
    async fire() {
      return ok({
        scheduledAt: new Date().toISOString(),
        expression: this.expression,
        payload: undefined as void,
      });
    },
  };

  // A4. Concrete Source consuming trigger event
  export const reportSource: TriggerAwareSource<void, ReportItem> = {
    type: "source",
    id: "pk_src_reports",
    async pull() {
      // In Way A, Source.pull() is called by the Trigger orchestrator
      return this.fromTrigger({ payload: undefined });
    },
    async fromTrigger(_triggerEvent) {
      // Fetch pending reports from DB (simulated)
      const rows: ReportItem[] = [
        { id: "r1", title: "Monthly summary", status: "pending" },
        { id: "r2", title: "Weekly digest", status: "pending" },
      ];
      const atoms = rows.map((r) => makeAtom(`pk_atom_${r.id}`, r));
      return ok(atoms);
    },
  };

  // Way A: what changes when cron → webhook?
  // - Replace CronTrigger with WebhookTrigger (new type, different fields)
  // - Source.fromTrigger() signature changes: payload type changes
  //   (void → { body: unknown; headers: Record<string, string> })
  // - Both types must be changed: Trigger<void> → Trigger<WebhookBody>
  // - TypeScript error if you forget to update Source's generic parameter
  // LOC for trigger + source wiring: ~35 lines (excluding domain type)
  // Type parameters: CronTrigger<void>, TriggerAwareSource<void, ReportItem>
  //   → when switching: must update 2 generic parameters
}

// ---------------------------------------------------------------------------
// WAY B: Source<O> internally handles scheduling (trigger = Source config)
//
// Trigger kind is Source config — there's NO separate Trigger type.
// Source knows how it is triggered via its config.
// ---------------------------------------------------------------------------

namespace WayB {
  // B1. Source config includes trigger spec
  interface SourceConfig<O> {
    id: string;
    trigger:
      | { kind: "cron"; expression: string }
      | { kind: "webhook"; path: string; secret?: string }
      | { kind: "event"; eventName: string }
      | { kind: "manual" }
      | { kind: "mcp"; toolName: string };
    pull(context: TriggerContext): Promise<Result<Atom<O>[], SourceError>>;
  }

  interface TriggerContext {
    triggeredBy: "cron" | "webhook" | "event" | "manual" | "mcp";
    triggeredAt: string;
    payload: unknown;        // raw trigger payload (cron: tick; webhook: body; etc.)
  }

  // B2. Concrete source — cron variant
  export const reportSourceCron: SourceConfig<ReportItem> = {
    id: "pk_src_reports",
    trigger: { kind: "cron", expression: "0 9 * * *" },
    async pull(ctx) {
      // ctx.triggeredBy === "cron" → fetch all pending
      const rows: ReportItem[] = [
        { id: "r1", title: "Monthly summary", status: "pending" },
        { id: "r2", title: "Weekly digest", status: "pending" },
      ];
      const atoms = rows.map((r) => makeAtom(`pk_atom_${r.id}`, r));
      return ok(atoms);
    },
  };

  // B3. Webhook variant — ONLY the trigger config changes
  export const reportSourceWebhook: SourceConfig<ReportItem> = {
    id: "pk_src_reports",
    trigger: { kind: "webhook", path: "/hooks/reports", secret: "whsec_abc" },
    async pull(ctx) {
      // ctx.payload is the webhook body — validate with Zod
      const bodyResult = ReportItemSchema.array().safeParse(
        (ctx.payload as { items?: unknown })?.items
      );
      if (!bodyResult.success) {
        return err({ type: "source_error", code: "invalid_body", message: bodyResult.error.message });
      }
      const atoms = bodyResult.data.map((r) => makeAtom(`pk_atom_${r.id}`, r));
      return ok(atoms);
    },
  };

  // Way B: what changes when cron → webhook?
  // - Change .trigger field value (kind + fields): 1 line change
  // - Source<O> generic parameter: unchanged (still ReportItem)
  // - pull() context: ctx.payload type changes conceptually (tick → body)
  //   but TypeScript cannot enforce this — ctx.payload is typed as `unknown`
  //   and Zod handles validation at runtime
  // LOC for trigger + source wiring: ~20 lines (excluding domain type)
  // Type parameters: SourceConfig<ReportItem> → same when switching
  //   → when switching: 0 generic parameter changes required
  // TRADEOFF: ctx.payload is `unknown` — no compile-time guarantee that
  //   cron source doesn't accidentally try to parse webhook body
}

// ---------------------------------------------------------------------------
// WAY C: Trigger as pure Inngest function config (no kit type at all)
//
// No kit type for trigger. Trigger is defined in Inngest adapter layer.
// kit's Source is unaware of how it is triggered.
// ---------------------------------------------------------------------------

namespace WayC {
  // C1. Source is a pure pull function — no trigger config
  export const reportSource: Source<ReportItem> = {
    type: "source",
    id: "pk_src_reports",
    async pull() {
      // Source has no knowledge of WHY it was invoked.
      // The trigger type is an Inngest concern, not a kit concern.
      const rows: ReportItem[] = [
        { id: "r1", title: "Monthly summary", status: "pending" },
        { id: "r2", title: "Weekly digest", status: "pending" },
      ];
      return ok(rows.map((r) => makeAtom(`pk_atom_${r.id}`, r)));
    },
  };

  // C2. Trigger is Inngest function config — no kit type (structural only)
  // In real usage:
  //   const fn = inngest.createFunction(
  //     { id: "process-reports" },
  //     { cron: "0 9 * * *" },         // ← cron trigger
  //     async ({ step }) => {
  //       const atoms = await step.run("pull", () => reportSource.pull());
  //       ...
  //     }
  //   );
  //
  // To switch to webhook:
  //   { cron: "0 9 * * *" }  →  { event: "webhook/reports.received" }
  // No change to reportSource at all.

  // Way C: what changes when cron → webhook?
  // - Change Inngest function config: { cron: expr } → { event: name }
  // - Source<O>: NO change (it's a pure pull function)
  // - Handler: may need to pass webhook payload to source pull() via context
  //   (requires adding a parameter to pull() or using a factory pattern)
  // LOC for trigger: ~1 line in Inngest config (outside kit)
  // Type parameters: Source<ReportItem> — unchanged
  //   → when switching: 0 generic parameter changes
  // TRADEOFF: source cannot access trigger payload type-safely
  //   (webhook body is only reachable via Inngest evt.data, not from Source.pull())
  //   → if source needs webhook body, must pass via pull(ctx?) parameter

  // C3. Factory pattern to pass trigger context to source
  interface PullContext {
    trigger: "cron" | "webhook" | "event" | "manual" | "mcp";
    payload: unknown;
  }

  interface ContextualSource<O> {
    type: "source";
    id: string;
    pull(ctx: PullContext): Promise<Result<Atom<O>[], SourceError>>;
  }

  export const reportSourceContextual: ContextualSource<ReportItem> = {
    type: "source",
    id: "pk_src_reports",
    async pull(ctx) {
      if (ctx.trigger === "webhook") {
        const parsed = ReportItemSchema.array().safeParse(
          (ctx.payload as { items?: unknown })?.items
        );
        if (!parsed.success) {
          return err({ type: "source_error", code: "invalid_body", message: parsed.error.message });
        }
        return ok(parsed.data.map((r) => makeAtom(`pk_atom_${r.id}`, r)));
      }
      // Default: cron / manual / event
      const rows: ReportItem[] = [
        { id: "r1", title: "Monthly summary", status: "pending" },
      ];
      return ok(rows.map((r) => makeAtom(`pk_atom_${r.id}`, r)));
    },
  };
  // Note: ContextualSource is now structurally equivalent to WayB.SourceConfig
  // minus the .trigger field. They converge.
}

// ---------------------------------------------------------------------------
// LOC and API surface comparison
// ---------------------------------------------------------------------------

function runComparison(): void {
  console.log("=== Cat IV Spike #2 — Source-vs-Trigger LOC Comparison ===\n");

  const comparison = [
    {
      way: "A: Trigger<O> wraps Source<O>",
      loc: 35,
      typeParams: 2,
      apiSurface: "CronTrigger<P>, TriggerAwareSource<P, O>",
      cronToWebhook: "Change Trigger type + Payload generic on Source",
      genericChanges: 2,
      typeSafety: "HIGH: payload type checked at compile time",
      tradeoff: "MORE types, more complexity for simple cases",
    },
    {
      way: "B: Source<O> with trigger config",
      loc: 22,
      typeParams: 1,
      apiSurface: "SourceConfig<O> (trigger is discriminated union field)",
      cronToWebhook: "Change .trigger field value (1 line)",
      genericChanges: 0,
      typeSafety: "MEDIUM: ctx.payload is unknown, Zod validates at runtime",
      tradeoff: "Simpler but ctx.payload loses compile-time type",
    },
    {
      way: "C: Pure Source<O> + Inngest config",
      loc: 12,
      typeParams: 1,
      apiSurface: "Source<O> (trigger is NOT in kit at all)",
      cronToWebhook: "Change Inngest config only, Source unchanged",
      genericChanges: 0,
      typeSafety: "LOW without ContextualSource; MEDIUM with pull(ctx)",
      tradeoff: "Simplest but trigger payload inaccessible in Source",
    },
  ];

  for (const row of comparison) {
    console.log(`  Way ${row.way}`);
    console.log(`    LOC (trigger+source wiring):   ${row.loc}`);
    console.log(`    Type parameters:               ${row.typeParams}`);
    console.log(`    User-facing API:               ${row.apiSurface}`);
    console.log(`    Cron → webhook change:         ${row.cronToWebhook}`);
    console.log(`    Generic param changes:         ${row.genericChanges}`);
    console.log(`    Type safety:                   ${row.typeSafety}`);
    console.log(`    Key tradeoff:                  ${row.tradeoff}`);
    console.log();
  }

  console.log("§ Convergence finding:\n");
  console.log("  Way C.ContextualSource + Way B.SourceConfig converge structurally.");
  console.log("  Both collapse to: Source<O> with optional trigger context parameter.");
  console.log("  Way A introduces a second type (Trigger<P>) that is not needed:");
  console.log("    - The trigger payload (P) is only needed in Source.pull()");
  console.log("    - It can be passed as a parameter to pull(ctx) instead");
  console.log("    - A separate Trigger<P> type adds generics complexity with no net gain");
  console.log();
  console.log("§ Key insight:\n");
  console.log("  Trigger type is only valuable if:");
  console.log("    (a) Multiple stages need access to the trigger payload, OR");
  console.log("    (b) Kit needs to orchestrate trigger → source wiring automatically");
  console.log("  For a personal toolkit (single Source per pipeline), (a) and (b) are false.");
  console.log("  → Trigger<O> as a separate kit type is NOT needed at Tier-2.");

  // Validate all 3 ways are structurally correct by instantiating them
  void WayA.reportCronTrigger;
  void WayA.reportSource;
  void WayB.reportSourceCron;
  void WayB.reportSourceWebhook;
  void WayC.reportSource;
  void WayC.reportSourceContextual;
  console.log("§ Structural validation: all 3 way implementations instantiate without error.");
}

runComparison();
