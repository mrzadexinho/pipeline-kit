import { watch } from 'node:fs';
import { join } from 'node:path';
import type { DiscoveredPipeline } from '../discover.js';
import { discoverPipelines } from '../discover.js';

export interface DevCommandOptions {
  baseDir?: string;
  pattern?: string;
}

/**
 * `pk dev` — watch `pipelines/` for changes, re-discover on change,
 * and drive local cron triggers via setInterval.
 *
 * Returns a `stop()` handle for use in tests and process signal handlers.
 */
export async function devCommand(opts: DevCommandOptions = {}): Promise<{
  stop: () => void;
}> {
  // 1. Initial discovery
  let pipelines = await discoverPipelines(opts.baseDir, opts.pattern);
  console.log(`Discovered ${pipelines.length} pipeline(s)`);
  for (const p of pipelines) {
    console.log(`  - ${p.id} (${p.filePath})`);
  }

  // 2. Start local cron triggers for any pipeline with trigger.kind === 'cron'
  const cronIntervals: ReturnType<typeof setInterval>[] = [];

  function startCronTriggers(pipelineList: DiscoveredPipeline[]): void {
    // Clear existing intervals
    for (const interval of cronIntervals) clearInterval(interval);
    cronIntervals.length = 0;

    for (const p of pipelineList) {
      const desc = p.pipeline.describe() as Record<string, unknown>;
      const trigger = desc.trigger as { kind: string; expr?: string } | undefined;
      if (trigger?.kind === 'cron' && trigger.expr) {
        const ms = parseCronInterval(trigger.expr);
        if (ms > 0) {
          const interval = setInterval(async () => {
            console.log(`[cron] Running ${p.id}`);
            try {
              await p.pipeline.run();
            } catch (err) {
              console.error(`[cron] ${p.id} failed: ${String(err)}`);
            }
          }, ms);
          cronIntervals.push(interval);
          console.log(`  [cron] ${p.id} scheduled every ${ms}ms`);
        }
      }
    }
  }

  startCronTriggers(pipelines);

  // 3. Watch for file changes and re-discover
  const baseDir = opts.baseDir ?? process.cwd();
  const watchDir = join(baseDir, opts.pattern ?? 'pipelines');

  let watcher: ReturnType<typeof watch> | null = null;
  try {
    watcher = watch(watchDir, { recursive: true }, async (_eventType, filename) => {
      if (!filename?.includes('.pipeline.')) return;
      console.log(`[watch] Change detected: ${filename}`);
      pipelines = await discoverPipelines(opts.baseDir, opts.pattern);
      console.log(`[watch] Re-discovered ${pipelines.length} pipeline(s)`);
      startCronTriggers(pipelines);
    });
  } catch {
    // Watch dir may not exist yet — run in static mode
    console.log('[watch] Could not watch directory, running in static mode');
  }

  return {
    stop() {
      for (const interval of cronIntervals) clearInterval(interval);
      cronIntervals.length = 0;
      watcher?.close();
    },
  };
}

/**
 * Parse a simple interval expression to milliseconds.
 *
 * Supports:
 *   "every 30s"   → 30_000
 *   "every 5m"    → 300_000
 *   "every 1h"    → 3_600_000
 *   "* * * * *"   → 60_000  (every minute)
 *
 * Returns 0 if the expression is not parseable.
 */
export function parseCronInterval(expr: string): number {
  // "every Xs / Xm / Xh" pattern
  const everyMatch = expr.match(/^every\s+(\d+)\s*(s|m|h)$/i);
  if (everyMatch && everyMatch[1] !== undefined && everyMatch[2] !== undefined) {
    const value = parseInt(everyMatch[1], 10);
    const unit = everyMatch[2].toLowerCase();
    if (unit === 's') return value * 1_000;
    if (unit === 'm') return value * 60_000;
    if (unit === 'h') return value * 3_600_000;
  }

  // Standard cron "* * * * *" → every minute
  if (/^\*\s+\*\s+\*\s+\*\s+\*$/.test(expr.trim())) {
    return 60_000;
  }

  return 0;
}
