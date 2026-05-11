/**
 * Cat VI Spike #3 — probe-disposable-registry.ts
 *
 * Compare 3 lifecycle ownership models for a pipeline using 3 adapters:
 *   - memory (MemoryAdapter & Disposable — SQLite connection)
 *   - secrets (SecretsResolver — lifecycle-free, env lookup)
 *   - trigger (TriggerAdapter & Disposable — setInterval handle)
 *
 * Option A: DisposableRegistry (Composer owns all adapter lifetimes)
 * Option B: Composer-managed deps-aware (isDisposable walk over Object.values(deps))
 * Option C: Self-managed (user's own try/finally per adapter)
 *
 * Comparison axes: LOC, error safety, extensibility, abort interaction.
 */

import {
  type Disposable, type MemoryAdapter, type SecretsResolver,
  type TriggerAdapter, type MemoryError, type SecretsError,
  type DisposeAllResult, type DisposalOptions,
  ok, err, isDisposable,
} from './types.js';

// =============================================================================
// Mock adapters — minimal fakes, no external deps
// =============================================================================

/** MemoryAdapter + Disposable (has lifecycle — DB connection) */
function createMemoryAdapter(opts: { failOnClose?: boolean } = {}): MemoryAdapter & Disposable {
  const store = new Map<string, string>();
  let closed = false;
  return {
    async read(key: string) {
      if (closed) return err({ type: 'memory_error', code: 'adapter_closed', message: 'closed' });
      return ok(store.get(key) ?? null);
    },
    async write(key: string, value: string) {
      if (closed) return err({ type: 'memory_error', code: 'adapter_closed', message: 'closed' });
      store.set(key, value);
      return ok(undefined);
    },
    async close() {
      if (opts.failOnClose) throw new Error('memory close failed (simulated)');
      closed = true;
      console.log('  [memory.close] called closed=true');
    },
  };
}

/** SecretsResolver — lifecycle-free (no Disposable) */
function createSecretsResolver(): SecretsResolver {
  return {
    async resolve(name: string) {
      return ok(`secret-value-for-${name}`);
    },
  };
}

/** TriggerAdapter + Disposable (has lifecycle — interval handle) */
function createTriggerAdapter(opts: { failOnClose?: boolean } = {}): TriggerAdapter & Disposable {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let fired = 0;
  return {
    async start(handler) {
      intervalId = setInterval(async () => {
        fired++;
        await handler({ event: 'tick', count: fired });
      }, 50);
      console.log('  [trigger.start] interval started');
    },
    async close() {
      if (opts.failOnClose) throw new Error('trigger close failed (simulated)');
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
      console.log('  [trigger.close] called fired=' + fired);
    },
  };
}

// =============================================================================
// Option A — DisposableRegistry (Cat V spike #2 cell γ pattern)
// =============================================================================

class DisposableRegistry {
  private readonly entries: Array<{ name: string; teardown: () => Promise<void> }> = [];

  /** Sync registration — before factory Promise resolves (per Cat V spike #2 §4.5) */
  register(name: string, teardown: () => Promise<void>): void {
    this.entries.push({ name, teardown });
  }

  /** LIFO disposal with error isolation — each teardown runs regardless of prior failures */
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
            setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
          ),
        ]);
        disposed.push(name);
      } catch (e) {
        const elapsed = Date.now() - start;
        if (e instanceof Error && e.message.startsWith('timeout')) {
          onTimeout?.(name, elapsed);
          errors.push({ name, error: e });
        } else {
          onError?.(name, e);
          errors.push({ name, error: e });
        }
      }
    }
    return { disposed, errors };
  }
}

// =============================================================================
// Option B — Composer-managed deps-aware (Cat V ADR-v1-V-2 β lean)
// =============================================================================

/** Composer-side disposeAll — walks deps, calls close() on Disposable adapters only */
async function composerDisposeAll(
  deps: Record<string, unknown>,
  opts: DisposalOptions = {}
): Promise<DisposeAllResult> {
  const { timeoutMs = 5000, onError } = opts;
  const disposed: string[] = [];
  const errors: Array<{ name: string; error: unknown }> = [];
  for (const [name, dep] of Object.entries(deps)) {
    if (!isDisposable(dep)) continue;
    try {
      await Promise.race([
        dep.close(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      disposed.push(name);
    } catch (e) {
      onError?.(name, e);
      errors.push({ name, error: e });
    }
  }
  return { disposed, errors };
}

// =============================================================================
// Mock pipeline — shared across all 3 options
// =============================================================================

async function runPipeline(deps: {
  memory: MemoryAdapter;
  secrets: SecretsResolver;
  trigger: TriggerAdapter;
}): Promise<void> {
  await deps.trigger.start(async (payload) => {
    console.log('    [pipeline] trigger fired payload=', JSON.stringify(payload));
  });
  const secretResult = await deps.secrets.resolve('api-key');
  const secretValue = secretResult.error === null ? secretResult.data : 'fallback';
  await deps.memory.write('pipeline:api-key', secretValue);
  const readResult = await deps.memory.read('pipeline:api-key');
  if (readResult.error === null) {
    console.log('    [pipeline] read-back value=', readResult.data);
  }
  // Simulate 80ms of work (enough for trigger to fire once)
  await new Promise(resolve => setTimeout(resolve, 80));
}

// =============================================================================
// Scenario runner helpers
// =============================================================================

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
}

function metric(label: string, value: unknown): void {
  console.log(`  [metric] ${label} = ${JSON.stringify(value)}`);
}

// =============================================================================
// Option A probe — DisposableRegistry
// =============================================================================

async function probeOptionA(failOnClose = false): Promise<void> {
  section(`Option A — DisposableRegistry (failOnClose=${failOnClose})`);

  const registry = new DisposableRegistry();
  const memory = createMemoryAdapter({ failOnClose });
  const trigger = createTriggerAdapter({ failOnClose });
  const secrets = createSecretsResolver(); // lifecycle-free, NOT registered

  // Register at construction time (secrets NOT registered — it has no teardown)
  registry.register('memory', () => memory.close());
  registry.register('trigger', () => trigger.close());

  let result: DisposeAllResult | undefined;
  try {
    await runPipeline({ memory, secrets, trigger });
  } finally {
    result = await registry.disposeAll({
      onTimeout: (name, ms) => console.log(`  [registry] timeout name=${name} elapsed=${ms}ms`),
      onError: (name, e) => console.log(`  [registry] error name=${name} err=${String(e)}`),
    });
  }

  metric('disposed', result.disposed);
  metric('errors', result.errors.map(e => e.name));
  metric('extensibility', 'user can call registry.register() for custom adapters — no deps shape change');
  metric('secrets-impact', 'lifecycle-free adapter has zero cost — not registered');
  metric('error-safety', 'LIFO disposal; errors isolated per adapter; all run regardless of prior failure');

  // LOC accounting
  console.log('\n  [LOC] Option A breakdown:');
  console.log('    DisposableRegistry class: ~40 LOC (pay-once, kit primitive)');
  console.log('    Per-adapter factory: +2 LOC (registry.register at construction site)');
  console.log('    Call site: registry.disposeAll() in pipeline-level finally — 1 call');
  console.log('    User custom adapter: +2 LOC (registry.register) — extensible');
}

// =============================================================================
// Option B probe — Composer-managed deps-aware
// =============================================================================

async function probeOptionB(failOnClose = false): Promise<void> {
  section(`Option B — Composer deps-aware disposeAll (failOnClose=${failOnClose})`);

  const memory = createMemoryAdapter({ failOnClose });
  const trigger = createTriggerAdapter({ failOnClose });
  const secrets = createSecretsResolver(); // lifecycle-free

  const deps = { memory, secrets, trigger } as const;

  let result: DisposeAllResult | undefined;
  try {
    await runPipeline(deps);
  } finally {
    result = await composerDisposeAll(deps, {
      onError: (name, e) => console.log(`  [composer] error name=${name} err=${String(e)}`),
    });
  }

  metric('disposed', result.disposed); // secrets NOT in disposed — isDisposable returned false
  metric('errors', result.errors.map(e => e.name));
  metric('extensibility', 'user adapters must be in deps shape — no registry escape hatch');
  metric('secrets-impact', 'lifecycle-free adapter silently skipped — isDisposable returns false');
  metric('error-safety', 'errors isolated per adapter; all deps walked regardless of prior failure');

  console.log('\n  [LOC] Option B breakdown:');
  console.log('    isDisposable + composerDisposeAll: ~20 LOC (pay-once in Composer)');
  console.log('    Per-adapter factory: 0 extra LOC at construction site');
  console.log('    Call site: composerDisposeAll(deps) in pipeline-level finally — 1 call');
  console.log('    User custom adapter: MUST be in deps{} shape — NOT extensible to outside-deps adapters');
}

// =============================================================================
// Option C probe — Self-managed (user's own finally)
// =============================================================================

async function probeOptionC(failOnClose = false): Promise<void> {
  section(`Option C — Self-managed (user try/finally) (failOnClose=${failOnClose})`);

  const memory = createMemoryAdapter({ failOnClose });
  const trigger = createTriggerAdapter({ failOnClose });
  const secrets = createSecretsResolver();

  const closeErrors: Array<{ name: string; error: unknown }> = [];
  try {
    await runPipeline({ memory, secrets, trigger });
  } finally {
    // User must remember each adapter. Error isolation is manual.
    try { await memory.close(); } catch (e) {
      closeErrors.push({ name: 'memory', error: e });
      console.log(`  [user] memory.close() threw: ${String(e)}`);
    }
    try { await trigger.close(); } catch (e) {
      closeErrors.push({ name: 'trigger', error: e });
      console.log(`  [user] trigger.close() threw: ${String(e)}`);
    }
    // secrets: no close() — user must know
  }

  metric('close-errors', closeErrors.map(e => e.name));
  metric('extensibility', 'fully extensible — user adds each close() call explicitly');
  metric('error-safety', 'user is responsible for isolation; easy to forget try/catch per adapter');
  metric('kit-cost', 'zero — no kit primitive needed');

  console.log('\n  [LOC] Option C breakdown:');
  console.log('    Kit: 0 LOC');
  console.log('    Per-adapter call site: +3 LOC per adapter (try { await x.close() } catch { ... })');
  console.log('    At N=3 Disposable adapters: +9 LOC per pipeline — duplicated across all pipelines');
  console.log('    User custom adapter: +3 LOC per adapter — scales linearly, NOT pay-once');
}

// =============================================================================
// Comparison summary
// =============================================================================

function printComparison(): void {
  section('Comparison summary');
  console.log(`
  ┌─────────────────────┬──────────────────────────────────────────────────────┐
  │ Axis                │ A: Registry   │ B: Deps-aware    │ C: Self-managed    │
  ├─────────────────────┼───────────────┼──────────────────┼────────────────────┤
  │ Kit primitive LOC   │ ~40 (once)    │ ~20 (once)       │ 0                  │
  │ Per-adapter LOC     │ +2 (register) │ 0                │ +3 per adapter     │
  │ Lifecycle-free cost │ 0 (skip)      │ 0 (isDisposable) │ 0 (skip manually)  │
  │ Error isolation     │ YES (LIFO)    │ YES              │ MANUAL per adapter │
  │ User extensibility  │ YES (any obj) │ NO (deps only)   │ YES (explicit)     │
  │ Abort interaction   │ separate TO   │ separate TO      │ user owns          │
  │ Cat V compatibility │ additive refac│ CONFIRMED V-ADR  │ no Kit support     │
  │ Cat VI ADR needed?  │ YES — forces  │ NO — V-scope     │ NO                 │
  └─────────────────────┴───────────────┴──────────────────┴────────────────────┘

  VERDICT:
    B is the Cat V ADR-v1-V-2 confirmed shape — ship now.
    A is the Cat VI shape — additive on top of B (B.Disposable forwards-compatible).
    C is structurally unsafe at N>=2 (error isolation left to user; linearly expensive).

  KEY FINDING (extensibility gap of B):
    B cannot see adapters NOT in deps{} shape. Example: a user adds a custom
    WebSocket adapter as a local variable, not threaded through deps.
    B would silently skip it. A would catch it IF the user calls registry.register().
    This is the load-bearing difference: registry is an EXPLICIT escape hatch.
    Verdict: B first (Cat V), A as additive Cat VI ADR (registry as opt-in escape hatch).
  `);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('### Cat VI spike #3 — probe-disposable-registry ###\n');

  // Happy path
  await probeOptionA(false);
  await probeOptionB(false);
  await probeOptionC(false);

  // Error path (close throws)
  await probeOptionA(true);
  await probeOptionB(true);
  await probeOptionC(true);

  printComparison();
  console.log('\n[driver] all probes done. exit 0');
}

main().catch((e) => { console.error(e); process.exit(1); });
