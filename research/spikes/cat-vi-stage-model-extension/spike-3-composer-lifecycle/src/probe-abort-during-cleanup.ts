/**
 * Cat VI Spike #3 — probe-abort-during-cleanup.ts
 *
 * Edge case: AbortSignal fires during disposal.
 *
 * Scenario:
 *   1. User cancels pipeline. AbortSignal fires. Composer stops stages.
 *   2. Composer enters disposal: calls disposeAll().
 *   3. memory.close() takes 500ms (flushing disk). Trigger.close() is instant.
 *   4. Should disposal respect the pipeline AbortSignal? Or use a separate timeout?
 *
 * Industry references:
 *   - Node.js server.close(): always completes (graceful shutdown; ignores SIGINT after)
 *   - Kubernetes terminationGracePeriodSeconds: bounded grace, then SIGKILL
 *   - Go context.Done(): cleanup should be bounded but not cancelled by request context
 *   - AWS Lambda: 2s extension lifetime after function returns
 *
 * Proposal: disposal gets a SEPARATE timeout (not pipeline signal).
 *   - Pipeline AbortSignal: "stop processing new work"
 *   - Disposal timeout: "stop waiting for cleanup"
 *   - After disposal timeout: log warning + abandon (never throw on abandon)
 *
 * 3 scenarios:
 *   Scenario 1: abort fires BEFORE pipeline completes (mid-run abort)
 *   Scenario 2: abort fires DURING disposal (slow close while cleaning up)
 *   Scenario 3: disposal timeout fires (close() takes too long)
 */

import {
  type Disposable, type DisposalOptions, type DisposeAllResult,
  isDisposable,
} from './types.js';

// =============================================================================
// Instrumented DisposableRegistry (full impl — for abort probe)
// =============================================================================

class DisposableRegistry {
  private readonly entries: Array<{ name: string; teardown: () => Promise<void> }> = [];

  register(name: string, teardown: () => Promise<void>): void {
    this.entries.push({ name, teardown });
  }

  /** LIFO disposal with individual timeout and error isolation */
  async disposeAll(opts: DisposalOptions = {}): Promise<DisposeAllResult> {
    const { timeoutMs = 5000, onTimeout, onError } = opts;
    const disposed: string[] = [];
    const errors: Array<{ name: string; error: unknown }> = [];

    for (const { name, teardown } of [...this.entries].reverse()) {
      const start = Date.now();
      try {
        await Promise.race([
          teardown(),
          new Promise<never>((_, reject) =>
            setTimeout(() => {
              const elapsed = Date.now() - start;
              onTimeout?.(name, elapsed);
              reject(new Error(`disposal timeout after ${timeoutMs}ms`));
            }, timeoutMs)
          ),
        ]);
        disposed.push(name);
        console.log(`  [registry] disposed name=${name} elapsed=${Date.now() - start}ms`);
      } catch (e) {
        onError?.(name, e);
        errors.push({ name, error: e });
        console.log(`  [registry] error name=${name} error=${String(e)}`);
      }
    }

    return { disposed, errors };
  }
}

// =============================================================================
// Mock adapters with configurable delays
// =============================================================================

function createSlowMemoryAdapter(closeDelayMs: number): Disposable & { name: string } {
  return {
    name: 'slow-memory',
    async close() {
      console.log(`  [slow-memory] close() started (will take ${closeDelayMs}ms)`);
      await new Promise(r => setTimeout(r, closeDelayMs));
      console.log('  [slow-memory] close() done');
    },
  };
}

function createFastTriggerAdapter(): Disposable & { name: string } {
  return {
    name: 'fast-trigger',
    async close() {
      console.log('  [fast-trigger] close() instant');
    },
  };
}

// =============================================================================
// Simulated pipeline runner
// =============================================================================

async function simulatePipeline(
  signal: AbortSignal,
  workDelayMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException('pipeline aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, workDelayMs);
  });
}

// =============================================================================
// Scenario 1 — abort fires BEFORE pipeline completes (mid-run abort)
// =============================================================================

async function scenarioMidRunAbort(): Promise<void> {
  console.log('\n--- Scenario 1: abort fires before pipeline completes ---');

  const controller = new AbortController();
  const registry = new DisposableRegistry();

  const memory = createSlowMemoryAdapter(50);
  const trigger = createFastTriggerAdapter();

  registry.register('memory', () => memory.close());
  registry.register('trigger', () => trigger.close());

  // Abort after 20ms; pipeline would run for 500ms
  setTimeout(() => {
    console.log('  [test] firing abort signal');
    controller.abort();
  }, 20);

  let pipelineError: Error | null = null;
  try {
    await simulatePipeline(controller.signal, 500);
  } catch (e) {
    pipelineError = e instanceof Error ? e : new Error(String(e));
    console.log(`  [pipeline] caught: ${pipelineError.name}: ${pipelineError.message}`);
  }

  // DISPOSAL runs AFTER abort — with SEPARATE 200ms timeout per adapter
  console.log('  [test] entering disposal (separate timeout, not pipeline signal)');
  const result = await registry.disposeAll({
    timeoutMs: 200, // separate timeout — NOT the pipeline AbortSignal
    onTimeout: (name, ms) => console.log(`  [test] disposal timeout name=${name} elapsed=${ms}ms`),
    onError: (name, e) => console.log(`  [test] disposal error name=${name} err=${String(e)}`),
  });

  console.log('  [result] disposed:', result.disposed);
  console.log('  [result] errors:', result.errors.map(e => e.name));
  console.log('  [analysis] pipeline-abort DOES NOT cancel disposal — correct behavior.');
  console.log('  [analysis] disposal gets its own 200ms timeout; both adapters close cleanly.');
}

// =============================================================================
// Scenario 2 — abort fires DURING disposal (slow close)
// =============================================================================

async function scenarioAbortDuringDisposal(): Promise<void> {
  console.log('\n--- Scenario 2: abort fires during disposal (slow memory close 300ms) ---');

  const controller = new AbortController();
  const registry = new DisposableRegistry();

  const memory = createSlowMemoryAdapter(300); // slow — 300ms close
  const trigger = createFastTriggerAdapter();

  registry.register('memory', () => memory.close());
  registry.register('trigger', () => trigger.close());

  // Pipeline finishes normally
  await simulatePipeline(controller.signal, 10);
  console.log('  [pipeline] finished normally');

  // Abort fires DURING disposal (100ms into it)
  setTimeout(() => {
    console.log('  [test] abort fired DURING disposal (simulates impatient caller)');
    controller.abort();
  }, 100);

  // Disposal uses its OWN timeout (400ms) — ignores the abort signal
  // This is the KEY design decision: disposal timeout is NOT the pipeline signal
  console.log('  [test] entering disposal with 400ms timeout (ignoring abort signal)');
  const result = await registry.disposeAll({
    timeoutMs: 400,
    onTimeout: (name, ms) => console.log(`  [test] disposal timeout name=${name} elapsed=${ms}ms`),
    onError: (name, e) => console.log(`  [test] disposal error name=${name} err=${String(e)}`),
  });

  console.log('  [result] disposed:', result.disposed);
  console.log('  [result] errors:', result.errors.map(e => e.name));
  console.log('  [analysis] abort signal during disposal is IGNORED by registry.');
  console.log('  [analysis] disposal completes anyway (memory.close took 300ms < 400ms timeout).');
  console.log('  [analysis] this matches Node.js server.close() + K8s graceful shutdown semantics.');
}

// =============================================================================
// Scenario 3 — disposal timeout fires (close() takes too long)
// =============================================================================

async function scenarioDisposalTimeout(): Promise<void> {
  console.log('\n--- Scenario 3: disposal timeout fires (memory close takes 1000ms, timeout=150ms) ---');

  const registry = new DisposableRegistry();

  const memory = createSlowMemoryAdapter(1000); // very slow — will timeout
  const trigger = createFastTriggerAdapter();

  registry.register('trigger', () => trigger.close()); // LIFO: trigger disposed first
  registry.register('memory', () => memory.close());   // LIFO: memory disposed second (slow)

  const result = await registry.disposeAll({
    timeoutMs: 150, // tight timeout — memory close will exceed this
    onTimeout: (name, ms) => console.log(`  [test] TIMEOUT name=${name} elapsed=${ms}ms — abandoning`),
    onError: (name, e) => console.log(`  [test] disposal error name=${name} err=${String(e)}`),
  });

  console.log('  [result] disposed:', result.disposed);
  console.log('  [result] errors (timeout entries):', result.errors.map(e => e.name));
  console.log('  [analysis] trigger disposed cleanly (fast).');
  console.log('  [analysis] memory disposal timed out — abandoned after 150ms.');
  console.log('  [analysis] pipeline process can still exit cleanly (no unresolved promises).');
  console.log('  [analysis] WARNING logged via onTimeout — monitoring can alert on slow cleanup.');
}

// =============================================================================
// AbortSignal-aware disposal — REJECTED option
// =============================================================================

async function scenarioAbortSignalAwareDisposal(): Promise<void> {
  console.log('\n--- REJECTED scenario: disposal respects pipeline AbortSignal ---');

  const controller = new AbortController();
  const registry = new DisposableRegistry();
  const memory = createSlowMemoryAdapter(200);
  const trigger = createFastTriggerAdapter();

  registry.register('trigger', () => trigger.close());
  registry.register('memory', () => memory.close());

  // Simulated: disposal that respects abort signal
  // (This is what we are REJECTING — here to document why)
  const disposeWithSignal = async (signal: AbortSignal): Promise<DisposeAllResult> => {
    const disposed: string[] = [];
    const errors: Array<{ name: string; error: unknown }> = [];
    for (const adapter of ['trigger-mock', 'memory-mock']) {
      if (signal.aborted) {
        // PROBLEM: abandoning disposal silently because signal fired
        console.log(`  [rejected-pattern] signal aborted — skipping disposal of ${adapter}`);
        errors.push({ name: adapter, error: new Error('aborted before disposal') });
        continue;
      }
      disposed.push(adapter);
    }
    return { disposed, errors };
  };

  controller.abort(); // abort immediately
  const result = await disposeWithSignal(controller.signal);

  console.log('  [result] disposed:', result.disposed);
  console.log('  [result] errors:', result.errors.map(e => e.name));
  console.log('  [WHY REJECTED]:');
  console.log('    1. Disposal skipped silently — resource leak (DB connection, interval handle).');
  console.log('    2. "Abort" means "stop processing inputs" — NOT "skip cleanup".');
  console.log('    3. In K8s: SIGTERM → graceful close, SIGKILL → hard kill.');
  console.log('       The pipeline signal is SIGTERM. SIGKILL is the disposal timeout.');
  console.log('    4. Industry consensus (Node server.close, Go defer) = cleanup runs always.');
}

// =============================================================================
// Design verdict
// =============================================================================

function printDesignVerdict(): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  Design Verdict — AbortSignal + disposal');
  console.log(`${'─'.repeat(60)}`);
  console.log(`
  TWO SEPARATE SIGNALS:
    1. Pipeline AbortSignal — "stop accepting new work, stop processing"
       Source: caller, timeout, or Composer run guard
       Scope: stages and atoms only

    2. Disposal timeout — "how long to wait for cleanup"
       Source: DisposalOptions.timeoutMs (default: 5000ms)
       Scope: disposeAll() only

  RULES:
    - Disposal ALWAYS runs after pipeline (happy path + error + abort)
    - Disposal IGNORES the pipeline AbortSignal
    - Disposal gets its own per-adapter timeout (default 5000ms)
    - After disposal timeout: log WARNING + abandon (non-throwing)
    - disposal errors do NOT re-throw (use onError callback for observability)

  PRACTICAL DEFAULTS:
    disposalTimeoutMs: 5000ms  (covers typical DB flush, HTTP/2 graceful close)
    K8s terminationGracePeriod: 30s  (disposal timeout << terminationGracePeriod)
    Lambda extension: 2s  (disposal timeout must be <= 2s in Lambda context)

  KIT CONTRACT (emerges from spike):
    composer.run(atoms, { deps, signal, disposal?: DisposalOptions })
    where DisposalOptions = { timeoutMs?: number; onTimeout?; onError? }
    The signal is NOT passed to disposeAll(). Composer owns the separation.
  `);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('### Cat VI spike #3 — probe-abort-during-cleanup ###\n');

  await scenarioMidRunAbort();
  await scenarioAbortDuringDisposal();
  await scenarioDisposalTimeout();
  await scenarioAbortSignalAwareDisposal();

  printDesignVerdict();
  console.log('\n[driver] abort-during-cleanup probe done. exit 0');
}

main().catch((e) => { console.error(e); process.exit(1); });
