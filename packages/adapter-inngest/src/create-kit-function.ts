import type { PipelineContext, RunGuard, TriggerConfig } from '@idriszade/core';
import { createDisposableRegistry } from '@idriszade/core';
import type { MapContextOptions } from './context-mapping.js';
import { mapInngestContext } from './context-mapping.js';

// Structural StepTools type — do NOT import from inngest internals.
export interface StepTools {
  run: <R>(id: string, fn: () => R | Promise<R>) => Promise<R>;
  invoke: (id: string, opts: { function: unknown; data: unknown }) => Promise<unknown>;
  waitForEvent: (
    id: string,
    opts: { event: string; timeout: string; match?: string },
  ) => Promise<unknown | null>;
  sendEvent: (id: string, events: unknown) => Promise<unknown>;
}

export interface KitFunctionConfig {
  id: string;
  trigger: TriggerConfig;
  runGuard?: RunGuard;
  retries?: number;
  deps?: Record<string, unknown>;
}

export interface KitFunctionArgs {
  event: { data: unknown; attempt: number; [key: string]: unknown };
  step: StepTools;
  ctx: PipelineContext;
}

// Minimal structural type for the Inngest client — avoids importing internal types.
type InngestClient = {
  createFunction: (...args: unknown[]) => unknown;
};

/**
 * Factory that wraps inngest.createFunction() with kit conventions.
 *
 * Maps TriggerConfig → Inngest trigger, RunGuard → concurrency config,
 * builds a PipelineContext for the user handler, and disposes registered
 * resources in a finally block after each run (ADRs I-1, I-7).
 *
 * The handler receives { event, step, ctx } where:
 *   - event  = raw Inngest event (data + attempt + any additional fields)
 *   - step   = Inngest StepTools (for durability via kitStep)
 *   - ctx    = pre-built PipelineContext ready to pass to kit stages
 */
export function createKitFunction<T>(
  inngest: InngestClient,
  config: KitFunctionConfig,
  handler: (args: KitFunctionArgs) => Promise<T>,
): unknown {
  const inngestTrigger = mapTriggerConfig(config.trigger);
  const inngestConfig = buildFunctionConfig(config);

  return inngest.createFunction(
    inngestConfig,
    inngestTrigger,
    async ({ event, step }: { event: { data: unknown; attempt: number }; step: StepTools }) => {
      const registry = createDisposableRegistry();
      const runId = `pk_run_${crypto.randomUUID()}`;

      const mapOpts: MapContextOptions = {
        runId,
        pipelineId: config.id,
        deps: config.deps,
      };

      const ctx = mapInngestContext(
        {
          attempt: event.attempt,
          data: event.data as Record<string, unknown> | undefined,
        },
        mapOpts,
      );

      try {
        return await handler({ event, step, ctx });
      } finally {
        await registry.disposeAll({ timeoutMs: 5000 });
      }
    },
  );
}

/**
 * Map a kit TriggerConfig to an Inngest trigger shape.
 * Exported for unit testing.
 */
export function mapTriggerConfig(trigger: TriggerConfig): { event: string } | { cron: string } {
  switch (trigger.kind) {
    case 'cron':
      return { cron: trigger.expr };
    case 'webhook':
      return { event: `webhook${trigger.path}` };
    case 'event':
      return { event: trigger.name };
    case 'manual':
      return { event: 'manual/trigger' };
    case 'mcp':
      return { event: `mcp/${trigger.toolName}` };
  }
}

/**
 * Build an Inngest function config object from KitFunctionConfig.
 * Exported for unit testing.
 */
export function buildFunctionConfig(config: KitFunctionConfig): Record<string, unknown> {
  const fnConfig: Record<string, unknown> = { id: config.id };

  if (config.retries !== undefined) {
    fnConfig.retries = config.retries;
  }

  if (config.runGuard?.concurrency !== undefined) {
    const { limit, overflow } = config.runGuard.concurrency;
    if (overflow === 'reject') {
      fnConfig.concurrency = [{ limit, key: 'event.data.pipelineId' }];
    } else {
      fnConfig.concurrency = [{ limit }];
    }
  }

  if (config.runGuard?.dedup !== undefined) {
    fnConfig.idempotency = 'event.data.dedupKey';
  }

  return fnConfig;
}
