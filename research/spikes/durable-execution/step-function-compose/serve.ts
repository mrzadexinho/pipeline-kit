/**
 * Cat I Spike #1 — Hono server that registers the Inngest function.
 * Port 3123 (avoids conflict with Inngest dev server on 8288).
 *
 * Run: bun run serve.ts
 */

import { serve as honoServe } from "@hono/node-server";
import { Hono } from "hono";
import { serve as inngestServe } from "inngest/hono";
import { inngest, pipelineRun } from "./spike.ts";

const app = new Hono();

// Mount Inngest handler at /api/inngest
app.on(
  ["GET", "POST", "PUT"],
  "/api/inngest",
  inngestServe({
    client: inngest,
    functions: [pipelineRun],
  })
);

// Health check
app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

const PORT = 3123;
console.log(`[serve] starting on http://localhost:${PORT}`);

honoServe(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`[serve] listening on http://localhost:${info.port}`);
    console.log(`[serve] Inngest endpoint: http://localhost:${info.port}/api/inngest`);
  }
);
