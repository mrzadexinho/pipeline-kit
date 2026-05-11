/**
 * Cat IV Spike #2 — probe-four-shapes.ts
 *
 * Implements 5 trigger shapes (cron, webhook, event, manual, MCP) and checks
 * whether they converge to the same TriggerEvent<O> envelope.
 *
 * For each shape:
 *   1. Trigger definition (what the user writes)
 *   2. Trigger output (what the pipeline receives)
 *   3. Inngest config mapping (prod) vs in-process (dev)
 *
 * Key question: do all 5 produce the same KitTriggerEnvelope<O>?
 */

import { z } from "zod";
import type {
  KitTriggerEnvelope,
  CronTrigger,
  WebhookTrigger,
  EventTrigger,
  ManualTrigger,
  McpTrigger,
  Result,
} from "./types.js";
import { ok, err, makeAtom } from "./types.js";

// ---------------------------------------------------------------------------
// Domain payload types for this probe
// ---------------------------------------------------------------------------

/** Payload that arrives with a cron tick — minimal, no user data */
interface CronPayload {
  scheduledAt: string;        // ISO 8601 timestamp the cron was scheduled for
  expression: string;
}

/** Payload that arrives with a webhook POST body */
interface WebhookPayload {
  headers: Record<string, string>;
  body: unknown;
  path: string;
  method: string;
}

/** Payload from an internal event (e.g., "pipeline/atom.processed") */
interface EventPayload {
  eventName: string;
  eventId: string;
  data: unknown;
}

/** Payload from a manual invocation */
interface ManualPayload {
  caller: string;
  args: Record<string, unknown>;
}

/** Payload from an MCP tool call */
interface McpPayload {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  serverId: string;
}

// ---------------------------------------------------------------------------
// Shared: produce a KitTriggerEnvelope from each shape
// ---------------------------------------------------------------------------

type FireResult<T> = Result<KitTriggerEnvelope<T>, { code: string; message: string }>;

// ---------------------------------------------------------------------------
// Shape 1: Cron trigger
// ---------------------------------------------------------------------------

const cronConfig: CronTrigger = {
  kind: "cron",
  expression: "0/5 * * * *",   // every 5 minutes (quartz-style; avoids JSDoc glob issue)
  timezone: "UTC",
};

/**
 * User-facing definition:
 *   pipeline.trigger({ kind: "cron", expression: "0/5 * * * *" })
 *
 * What the pipeline receives:
 *   KitTriggerEnvelope<CronPayload>
 *
 * Inngest config (prod):
 *   inngest.createFunction({ id: "my-pipeline" }, { cron: "0/5 * * * *" }, handler)
 *
 * In-process (dev):
 *   setInterval(firePipeline, 5 * 60 * 1000)
 */
function fireCron(triggerId: string): FireResult<CronPayload> {
  const now = new Date();
  const envelope: KitTriggerEnvelope<CronPayload> = {
    id: `pk_tev_cron_${now.getTime()}`,
    type: "cron",
    source: triggerId,
    time: now.toISOString(),
    data: {
      scheduledAt: now.toISOString(),
      expression: cronConfig.expression,
    },
  };
  return ok(envelope);
}

// Inngest config equivalent (no Inngest dep — structural only)
const cronInngestConfig = {
  runtime: "inngest" as const,
  trigger: { cron: cronConfig.expression },
  // handler receives: evt = { name: "timer/cron", data: { cron: { ts: number } } }
  // kit wraps: KitTriggerEnvelope<CronPayload> from evt.data.cron.ts
};

// ---------------------------------------------------------------------------
// Shape 2: Webhook trigger
// ---------------------------------------------------------------------------

const webhookConfig: WebhookTrigger = {
  kind: "webhook",
  path: "/hooks/pipeline/:pipelineId",
  method: "POST",
  secret: "whsec_test_secret",
};

const WebhookBodySchema = z.object({
  event: z.string(),
  payload: z.record(z.unknown()),
});

/**
 * User-facing definition:
 *   pipeline.trigger({ kind: "webhook", path: "/hooks/...", secret: "..." })
 *
 * What the pipeline receives:
 *   KitTriggerEnvelope<WebhookPayload>
 *
 * Inngest config (prod):
 *   Inngest doesn't have a native webhook trigger — webhook handler POSTs
 *   an Inngest event: await inngest.send({ name: "webhook/received", data: body })
 *   Then: createFunction({ ... }, { event: "webhook/received" }, handler)
 *
 * In-process (dev):
 *   express.post(webhookConfig.path, (req, res) => { firePipeline(req.body); })
 */
function fireWebhook(
  triggerId: string,
  rawHeaders: Record<string, string>,
  rawBody: unknown,
  path: string
): FireResult<WebhookPayload> {
  // Zod boundary: validate incoming body shape
  const parsed = WebhookBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return err({ code: "webhook_body_invalid", message: parsed.error.message });
  }

  const envelope: KitTriggerEnvelope<WebhookPayload> = {
    id: `pk_tev_wh_${Date.now()}`,
    type: "webhook",
    source: triggerId,
    time: new Date().toISOString(),
    data: {
      headers: rawHeaders,
      body: parsed.data,
      path,
      method: webhookConfig.method,
    },
  };
  return ok(envelope);
}

// Inngest config equivalent
const webhookInngestConfig = {
  runtime: "inngest" as const,
  // Webhooks arrive via HTTP → send Inngest event → trigger function
  trigger: { event: "webhook/pipeline.received" },
  // Note: webhook verification (HMAC) happens in the HTTP handler BEFORE send()
  // kit's WebhookTrigger config (secret) belongs in the HTTP adapter, not the Inngest adapter
};

// ---------------------------------------------------------------------------
// Shape 3: Event trigger
// ---------------------------------------------------------------------------

const eventConfig: EventTrigger = {
  kind: "event",
  eventName: "pipeline/atom.processed",
  filter: { status: "completed" },
};

/**
 * User-facing definition:
 *   pipeline.trigger({ kind: "event", eventName: "pipeline/atom.processed" })
 *
 * What the pipeline receives:
 *   KitTriggerEnvelope<EventPayload>
 *
 * Inngest config (prod):
 *   createFunction({ ... }, { event: "pipeline/atom.processed" }, handler)
 *   evt.data is the event payload
 *
 * In-process (dev):
 *   EventEmitter.on("pipeline/atom.processed", (data) => { firePipeline(data) })
 */
function fireEvent(
  triggerId: string,
  eventName: string,
  eventId: string,
  data: unknown
): FireResult<EventPayload> {
  const envelope: KitTriggerEnvelope<EventPayload> = {
    id: `pk_tev_evt_${Date.now()}`,
    type: "event",
    source: triggerId,
    time: new Date().toISOString(),
    data: { eventName, eventId, data },
  };
  return ok(envelope);
}

// Inngest config equivalent
const eventInngestConfig = {
  runtime: "inngest" as const,
  trigger: { event: eventConfig.eventName },
  // Inngest evt.data maps directly to EventPayload.data
  // eventId = evt.id, eventName = evt.name
};

// ---------------------------------------------------------------------------
// Shape 4: Manual trigger
// ---------------------------------------------------------------------------

const manualConfig: ManualTrigger = {
  kind: "manual",
  allowedCallers: ["user:alice", "service:cron-fallback"],
};

/**
 * User-facing definition:
 *   pipeline.trigger({ kind: "manual" })
 *   pipeline.run({ caller: "user:alice", args: { ... } })
 *
 * What the pipeline receives:
 *   KitTriggerEnvelope<ManualPayload>
 *
 * Inngest config (prod):
 *   inngest.send({ name: "pipeline/manual.invoked", data: { caller, args } })
 *   createFunction({ ... }, { event: "pipeline/manual.invoked" }, handler)
 *
 * In-process (dev):
 *   Direct function call: firePipeline({ caller, args })
 */
function fireManual(
  triggerId: string,
  caller: string,
  args: Record<string, unknown>
): FireResult<ManualPayload> {
  if (
    manualConfig.allowedCallers &&
    !manualConfig.allowedCallers.includes(caller)
  ) {
    return err({
      code: "manual_caller_not_allowed",
      message: `Caller ${caller} not in allowedCallers`,
    });
  }

  const envelope: KitTriggerEnvelope<ManualPayload> = {
    id: `pk_tev_man_${Date.now()}`,
    type: "manual",
    source: triggerId,
    time: new Date().toISOString(),
    data: { caller, args },
  };
  return ok(envelope);
}

// Inngest config equivalent
const manualInngestConfig = {
  runtime: "inngest" as const,
  trigger: { event: "pipeline/manual.invoked" },
  // caller + args live in evt.data
};

// ---------------------------------------------------------------------------
// Shape 5: MCP trigger (from Cat VIII packs §4.3)
// ---------------------------------------------------------------------------

const mcpConfig: McpTrigger = {
  kind: "mcp",
  toolName: "run_pipeline",
  serverId: "orchestr8-mcp",
};

const McpArgsSchema = z.object({
  pipelineId: z.string(),
  input: z.record(z.unknown()).optional(),
});

/**
 * User-facing definition:
 *   pipeline.trigger({ kind: "mcp", toolName: "run_pipeline", serverId: "orchestr8-mcp" })
 *
 * What the pipeline receives:
 *   KitTriggerEnvelope<McpPayload>
 *
 * Inngest config (prod):
 *   MCP server calls pipeline HTTP endpoint → POST → Inngest event → function
 *   OR: MCP tool directly calls inngest.send({ name: "mcp/tool.called", data: { ... } })
 *
 * In-process (dev):
 *   MCP server tool handler calls firePipeline(args) directly
 */
function fireMcp(
  triggerId: string,
  toolCallId: string,
  rawArgs: unknown,
  serverId: string
): FireResult<McpPayload> {
  const parsed = McpArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return err({ code: "mcp_args_invalid", message: parsed.error.message });
  }

  const envelope: KitTriggerEnvelope<McpPayload> = {
    id: `pk_tev_mcp_${Date.now()}`,
    type: "mcp",
    source: triggerId,
    time: new Date().toISOString(),
    data: {
      toolName: mcpConfig.toolName,
      toolCallId,
      args: parsed.data as Record<string, unknown>,
      serverId,
    },
  };
  return ok(envelope);
}

// Inngest config equivalent
const mcpInngestConfig = {
  runtime: "inngest" as const,
  trigger: { event: "mcp/tool.called" },
  // toolName + args + serverId live in evt.data
};

// ---------------------------------------------------------------------------
// Convergence probe: do all 5 produce structurally identical envelopes?
// ---------------------------------------------------------------------------

function runConvergenceProbe(): void {
  console.log("=== Cat IV Spike #2 — Five-Shape Convergence Probe ===\n");

  const triggerId = "pk_src_pipeline_alpha";

  // Fire each shape
  const cronResult = fireCron(triggerId);
  const webhookResult = fireWebhook(
    triggerId,
    { "content-type": "application/json", "x-webhook-sig": "sha256=abc" },
    { event: "payment.completed", payload: { amount: 100 } },
    "/hooks/pipeline/pipe_123"
  );
  const eventResult = fireEvent(
    triggerId,
    "pipeline/atom.processed",
    "evt_abc123",
    { atomId: "pk_atom_xyz", status: "completed" }
  );
  const manualResult = fireManual(triggerId, "user:alice", {
    force: true,
    reason: "manual override",
  });
  const mcpResult = fireMcp(
    triggerId,
    "call_mcp_001",
    { pipelineId: "pk_pipe_abc", input: { query: "hello" } },
    "orchestr8-mcp"
  );

  const results = [
    { shape: "cron", result: cronResult },
    { shape: "webhook", result: webhookResult },
    { shape: "event", result: eventResult },
    { shape: "manual", result: manualResult },
    { shape: "mcp", result: mcpResult },
  ];

  // Check convergence: same top-level keys?
  console.log("§ Envelope field presence across all 5 shapes:\n");
  const expectedFields = ["id", "type", "source", "time", "data"] as const;

  for (const { shape, result } of results) {
    if (!result.ok) {
      console.log(`  ${shape}: ERROR — ${result.error.message}`);
      continue;
    }
    const envelope = result.value;
    const presentFields = expectedFields.filter((f) => f in envelope);
    const allPresent = presentFields.length === expectedFields.length;
    console.log(
      `  ${shape}: ${allPresent ? "CONVERGES" : "DIVERGES"} — fields: [${presentFields.join(", ")}]`
    );
    console.log(`    .type = "${envelope.type}", .source = "${envelope.source}"`);
    console.log(`    .data keys = [${Object.keys(envelope.data as object).join(", ")}]`);
  }

  // Key divergence: .data shape differs per trigger type
  console.log("\n§ Data shape divergence (expected — each trigger type has distinct payload):\n");
  console.log("  cron    .data: { scheduledAt, expression }");
  console.log("  webhook .data: { headers, body, path, method }");
  console.log("  event   .data: { eventName, eventId, data }");
  console.log("  manual  .data: { caller, args }");
  console.log("  mcp     .data: { toolName, toolCallId, args, serverId }");

  // Inngest config comparison
  console.log("\n§ Inngest config mapping (prod runtime):\n");
  const configs = [
    { shape: "cron", config: cronInngestConfig },
    { shape: "webhook", config: webhookInngestConfig },
    { shape: "event", config: eventInngestConfig },
    { shape: "manual", config: manualInngestConfig },
    { shape: "mcp", config: mcpInngestConfig },
  ];
  for (const { shape, config } of configs) {
    console.log(`  ${shape}: trigger = ${JSON.stringify(config.trigger)}`);
  }

  console.log("\n§ Verdict from shape probe:");
  console.log("  Envelope top-level: CONVERGES (id, type, source, time, data)");
  console.log("  Envelope .data: DIVERGES per trigger type (expected — generic<T> handles this)");
  console.log("  Inngest mapping: ALL collapse to either { cron: expr } or { event: name }");
  console.log("  Webhook is NOT a native Inngest trigger — it routes via event send()");
  console.log("  MCP is NOT a native Inngest trigger — it routes via event send()");
  console.log("  → 5 trigger types → 2 Inngest primitives (cron | event)");
  console.log("  → KitTriggerEnvelope<T> is the unifying envelope — T differs per type");
}

runConvergenceProbe();
