/**
 * Cat IV Spike #2 — probe-local-prod-seam.ts
 *
 * §5.2 seam for triggers: can a single trigger definition compile to both
 * dev (setInterval / Express handler / manual) and prod (Inngest config)?
 *
 * Test: same trigger definition, two execution modes.
 *   Dev:  setInterval / EventEmitter / direct call
 *   Prod: Inngest cron config / Inngest event trigger / Inngest function invoke
 *
 * Question: what is the adapter boundary?
 */

import { z } from "zod";
import type { KitTriggerEnvelope, TriggerConfig, Result, Atom } from "./types.js";
import { ok, err, makeAtom } from "./types.js";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

interface NewsletterItem {
  id: string;
  subject: string;
  recipients: number;
}

// ---------------------------------------------------------------------------
// Single trigger definition (Option B from probe-source-vs-trigger.ts)
// User writes this once — same for dev and prod.
// ---------------------------------------------------------------------------

const newsletterTrigger: TriggerConfig = {
  kind: "cron",
  expression: "0 8 * * 1",  // every Monday at 8am
  timezone: "UTC",
};

// Source: pulls data from "DB" (simulated)
async function pullNewsletterItems(): Promise<
  Result<Atom<NewsletterItem>[], { type: "source_error"; code: string; message: string }>
> {
  const items: NewsletterItem[] = [
    { id: "nl_001", subject: "Weekly Pipeline Kit Update", recipients: 42 },
    { id: "nl_002", subject: "Cat IV Research Summary", recipients: 18 },
  ];
  return ok(items.map((i) => makeAtom(`pk_atom_${i.id}`, i)));
}

// Process: transform each newsletter item (simulated)
async function processNewsletter(
  atom: Atom<NewsletterItem>
): Promise<Result<{ sent: boolean; itemId: string }, { code: string }>> {
  if (atom.data.recipients === 0) {
    return err({ code: "no_recipients" });
  }
  // Simulate sending
  return ok({ sent: true, itemId: atom.id });
}

// ---------------------------------------------------------------------------
// TriggerAdapter: the seam between trigger config and runtime
// ---------------------------------------------------------------------------

interface TriggerAdapter {
  /** Register the trigger with the runtime (called at startup) */
  register(
    config: TriggerConfig,
    handler: (env: KitTriggerEnvelope<unknown>) => Promise<void>
  ): void | Promise<void>;
  /** Stop the trigger (cleanup) */
  stop(): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// DEV adapter: setInterval / EventEmitter / direct call
// ---------------------------------------------------------------------------

class DevTriggerAdapter implements TriggerAdapter {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  register(
    config: TriggerConfig,
    handler: (env: KitTriggerEnvelope<unknown>) => Promise<void>
  ): void {
    if (config.kind === "cron") {
      // Simulate cron by running every 100ms in dev (or once immediately)
      // Real dev adapter would parse cron expression and use node-cron / later.js
      console.log(
        `  [DEV] Registered cron trigger: "${config.expression}" → simulating as immediate + 100ms interval`
      );
      const fire = () => {
        const env: KitTriggerEnvelope<{ scheduledAt: string }> = {
          id: `pk_tev_cron_dev_${Date.now()}`,
          type: "cron",
          source: "dev-trigger-adapter",
          time: new Date().toISOString(),
          data: { scheduledAt: new Date().toISOString() },
        };
        void handler(env as KitTriggerEnvelope<unknown>);
      };
      fire(); // fire immediately on registration in dev
      this.intervalHandle = setInterval(fire, 100);
    } else if (config.kind === "manual") {
      console.log(`  [DEV] Registered manual trigger — call adapter.triggerManual() to fire`);
    } else if (config.kind === "webhook") {
      console.log(
        `  [DEV] Registered webhook trigger at ${config.path} — wire to express in dev server`
      );
    } else {
      console.log(`  [DEV] Registered ${config.kind} trigger (no-op in dev)`);
    }
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log(`  [DEV] Stopped cron trigger simulation`);
    }
  }

  /** Dev-only: fire a manual trigger */
  triggerManual(handler: (env: KitTriggerEnvelope<unknown>) => Promise<void>): void {
    const env: KitTriggerEnvelope<{ caller: string; args: Record<string, unknown> }> = {
      id: `pk_tev_man_dev_${Date.now()}`,
      type: "manual",
      source: "dev-trigger-adapter",
      time: new Date().toISOString(),
      data: { caller: "dev:manual", args: {} },
    };
    void handler(env as KitTriggerEnvelope<unknown>);
  }
}

// ---------------------------------------------------------------------------
// PROD adapter stub (structural — no Inngest dep)
// ---------------------------------------------------------------------------

class ProdTriggerAdapter implements TriggerAdapter {
  /** Returns the Inngest trigger config derived from kit TriggerConfig */
  static toInngestTrigger(config: TriggerConfig): Record<string, unknown> {
    switch (config.kind) {
      case "cron":
        return { cron: config.expression };
      case "webhook":
        // Webhook arrives as Inngest event sent by HTTP handler
        return { event: `webhook/${config.path.replace(/\//g, ".")}` };
      case "event":
        return { event: config.eventName };
      case "manual":
        return { event: "pipeline/manual.invoked" };
      case "mcp":
        return { event: `mcp/${config.toolName}.called` };
    }
  }

  register(
    config: TriggerConfig,
    _handler: (env: KitTriggerEnvelope<unknown>) => Promise<void>
  ): void {
    // [STRUCTURAL-PREDICTION] In real prod adapter:
    //   const inngestTrigger = ProdTriggerAdapter.toInngestTrigger(config);
    //   inngest.createFunction({ id: "..." }, inngestTrigger, async ({ event, step }) => {
    //     const kitEnv = mapInngestEventToKitEnvelope(event, config.kind);
    //     await _handler(kitEnv);
    //   });
    const inngestTrigger = ProdTriggerAdapter.toInngestTrigger(config);
    console.log(
      `  [PROD] Would register Inngest trigger: ${JSON.stringify(inngestTrigger)}`
    );
    console.log(`  [PROD] Handler is wired — fires when Inngest delivers the trigger event`);
  }

  stop(): void {
    // Inngest functions are deregistered by unserving the endpoint
    console.log(`  [PROD] Inngest deregistration is serve() lifecycle — no-op here`);
  }
}

// ---------------------------------------------------------------------------
// Pipeline handler (runtime-agnostic — same for dev and prod)
// ---------------------------------------------------------------------------

async function pipelineHandler(env: KitTriggerEnvelope<unknown>): Promise<void> {
  console.log(`  [HANDLER] Received trigger event: type=${env.type}, id=${env.id}`);

  const pullResult = await pullNewsletterItems();
  if (!pullResult.ok) {
    console.log(`  [HANDLER] Source pull failed: ${pullResult.error.message}`);
    return;
  }

  const atoms = pullResult.value;
  console.log(`  [HANDLER] Pulled ${atoms.length} atoms from source`);

  for (const atom of atoms) {
    const processResult = await processNewsletter(atom);
    if (processResult.ok) {
      console.log(`  [HANDLER]   → processed ${atom.id}: sent=${processResult.value.sent}`);
    } else {
      console.log(`  [HANDLER]   → process failed ${atom.id}: ${processResult.error.code}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Run the seam probe
// ---------------------------------------------------------------------------

async function runSeamProbe(): Promise<void> {
  console.log("=== Cat IV Spike #2 — Local-Prod Seam Probe ===\n");

  console.log("§1. Single trigger definition (same for dev + prod):\n");
  console.log(`  TriggerConfig: ${JSON.stringify(newsletterTrigger)}\n`);

  console.log("§2. DEV mode — TriggerAdapter = DevTriggerAdapter:\n");
  const devAdapter = new DevTriggerAdapter();
  devAdapter.register(newsletterTrigger, pipelineHandler);

  // Let dev adapter fire once then stop
  await new Promise((resolve) => setTimeout(resolve, 50));
  devAdapter.stop();

  console.log("\n§3. PROD mode — TriggerAdapter = ProdTriggerAdapter:\n");
  const prodAdapter = new ProdTriggerAdapter();
  prodAdapter.register(newsletterTrigger, pipelineHandler);
  prodAdapter.stop();

  console.log("\n§4. Inngest trigger mapping (from ProdTriggerAdapter.toInngestTrigger):\n");
  const testConfigs: TriggerConfig[] = [
    { kind: "cron", expression: "0 8 * * 1" },
    { kind: "webhook", path: "/hooks/reports", secret: "abc" },
    { kind: "event", eventName: "pipeline/atom.processed" },
    { kind: "manual" },
    { kind: "mcp", toolName: "run_pipeline" },
  ];
  for (const cfg of testConfigs) {
    const inngest = ProdTriggerAdapter.toInngestTrigger(cfg);
    console.log(`  ${cfg.kind.padEnd(10)} → Inngest: ${JSON.stringify(inngest)}`);
  }

  console.log("\n§5. Seam analysis:\n");
  console.log("  SINGLE definition: YES — TriggerConfig compiles to both dev + prod adapters");
  console.log("  ADAPTER boundary: TriggerAdapter.register(config, handler) interface");
  console.log("  HANDLER: runtime-agnostic — receives KitTriggerEnvelope<T> in both modes");
  console.log("  DELTA dev→prod:");
  console.log("    dev:  setInterval / direct call → fires handler immediately");
  console.log("    prod: Inngest function → Inngest schedules / routes event → fires handler");
  console.log("  SEAM thickness: THIN — same as Cat V MemoryAdapter seam");
  console.log("    The adapter converts TriggerConfig → runtime config at startup");
  console.log("    The handler receives the same KitTriggerEnvelope<T> regardless of mode");

  console.log("\n§6. What changes when cron → webhook (in the seam):\n");
  console.log("  TriggerConfig: { kind: 'cron', expression } → { kind: 'webhook', path, secret }");
  console.log("  DevTriggerAdapter.register: setInterval → express.post(path, handler)");
  console.log("  ProdTriggerAdapter.register: { cron: expr } → { event: 'webhook/...' }");
  console.log("  pipelineHandler: UNCHANGED (receives KitTriggerEnvelope<T> — type differs)");
  console.log("  Source.pull(): may need to access webhook body via ctx.payload");
  console.log("    → this is the only caller-visible change: pull(ctx?) with optional context");

  console.log("\n§7. Verdict — adapter boundary:\n");
  console.log("  TriggerAdapter is the seam. It is NOT a kit-core type.");
  console.log("  It is an adapter-tier concern (similar to MemoryAdapter, SecretsAdapter).");
  console.log("  kit-core: TriggerConfig (discriminated union) + KitTriggerEnvelope<T>");
  console.log("  adapter-tier: DevTriggerAdapter + ProdTriggerAdapter (per runtime)");
  console.log("  Trigger<O> as a Tier-2 stage type: NOT NEEDED.");
  console.log("  The config + envelope pair is sufficient for the seam to be thin.");
}

void runSeamProbe();
