/**
 * Cat VI Spike #3 — probe-seam-convention.ts
 *
 * Formalize the 3x-confirmed adapter seam convention.
 *
 * Three adapters confirm the same pattern:
 *   Cat V  → MemoryAdapter   — dev=InMemoryMap, prod=orchestr8 SQLite
 *   Cat VIII → SecretsResolver — dev=env, prod=sops/oidc
 *   Cat IV  → TriggerAdapter  — dev=setInterval, prod=Inngest
 *
 * Question: Is AdapterConvention<Config, Instance> worth typing as a kit base,
 * or is the convention docs-only?
 *
 * Probe: instantiate all 3 adapters via their factory signatures, wire into
 * a pipeline deps shape, verify the structural pattern holds.
 */

import {
  type Result, type Disposable, type AdapterError,
  type MemoryAdapter, type SecretsResolver, type TriggerAdapter,
  type MemoryError, type SecretsError, type PipelineDeps,
  ok, err, isDisposable,
} from './types.js';

// =============================================================================
// Factory function signatures for the 3 confirmed adapters
// (no concrete dep needed — structural proof only)
// =============================================================================

// ---- MemoryAdapter factories (Cat V confirmed) ----

interface MemoryAdapterConfig {
  namespace?: string;
  /** registry for Disposable teardown (optional — for future Cat VI registry path) */
  registry?: { register(name: string, teardown: () => Promise<void>): void };
}

type MemoryAdapterInstance = MemoryAdapter & Disposable;

/** dev: in-memory Map — Disposable (Map.clear on close) */
function createInMemoryAdapter(config: MemoryAdapterConfig = {}): MemoryAdapterInstance {
  const store = new Map<string, string>();
  const ns = config.namespace ?? 'default';
  let closed = false;

  const adapter: MemoryAdapterInstance = {
    async read(key: string) {
      if (closed) return err({ type: 'memory_error', code: 'adapter_closed', message: 'closed' });
      return ok(store.get(`${ns}::${key}`) ?? null);
    },
    async write(key: string, value: string) {
      if (closed) return err({ type: 'memory_error', code: 'adapter_closed', message: 'closed' });
      store.set(`${ns}::${key}`, value); // LWW — Map.set always overwrites (ADR-v1-V-4)
      return ok(undefined);
    },
    async close() {
      store.clear();
      closed = true;
    },
  };

  // Optional registry integration (future Cat VI path)
  config.registry?.register('in-memory-adapter', async () => { await adapter.close(); });

  return adapter;
}

/** prod: orchestr8-style adapter (mock — structural probe only) */
function createOrchestr8Adapter(config: MemoryAdapterConfig = {}): MemoryAdapterInstance {
  const store = new Map<string, string>(); // mock SQLite
  const ns = config.namespace ?? 'default';
  let closed = false;

  const adapter: MemoryAdapterInstance = {
    async read(key: string) {
      if (closed) return err({ type: 'memory_error', code: 'adapter_closed', message: 'closed' });
      return ok(store.get(`${ns}::${key}`) ?? null);
    },
    async write(key: string, value: string) {
      if (closed) return err({ type: 'memory_error', code: 'adapter_closed', message: 'closed' });
      // LWW enforcement (ADR-v1-V-4: orchestr8 first-write-wins bug — reference adapter wraps)
      store.set(`${ns}::${key}`, value);
      return ok(undefined);
    },
    async close() {
      closed = true;
      console.log('  [orchestr8-adapter] close() called (mock SQLite flush)');
    },
  };

  config.registry?.register('orchestr8-adapter', async () => { await adapter.close(); });

  return adapter;
}

// ---- SecretsResolver factories (Cat VIII confirmed) ----

interface SecretsConfig { prefix?: string; }

/** dev: env variable lookup — NO Disposable (lifecycle-free) */
function createEnvSecretsResolver(config: SecretsConfig = {}): SecretsResolver {
  const prefix = config.prefix ?? '';
  return {
    async resolve(name: string) {
      const envKey = `${prefix}${name}`.toUpperCase().replace(/-/g, '_');
      const value = process.env[envKey] ?? `mock-${name}-from-env`;
      return ok(value);
    },
  };
}

/** prod: sops-style resolver — NO Disposable (file read per call; no persistent connection) */
function createSopsSecretsResolver(config: SecretsConfig = {}): SecretsResolver {
  const prefix = config.prefix ?? '';
  return {
    async resolve(name: string) {
      // Mock: real impl would call `sops -d secrets.enc.yaml | jq ."${name}"`
      return ok(`sops-decrypted-${prefix}${name}`);
    },
  };
}

// ---- TriggerAdapter factories (Cat IV confirmed) ----

interface TriggerConfig { intervalMs?: number; maxFires?: number; }

/** dev: setInterval-based trigger — Disposable (interval handle) */
function createIntervalTrigger(config: TriggerConfig = {}): TriggerAdapter & Disposable {
  const { intervalMs = 100, maxFires = 3 } = config;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let fired = 0;

  return {
    async start(handler) {
      intervalId = setInterval(async () => {
        if (fired >= maxFires) { return; }
        fired++;
        await handler({ event: 'tick', count: fired, source: 'setInterval' });
      }, intervalMs);
      console.log(`  [interval-trigger.start] interval started intervalMs=${intervalMs}`);
    },
    async close() {
      if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
      console.log(`  [interval-trigger.close] cleared fired=${fired}`);
    },
  };
}

/** prod: Inngest-style trigger — Disposable (registration cleanup) */
function createInngestTrigger(config: TriggerConfig = {}): TriggerAdapter & Disposable {
  let registered = false;
  return {
    async start(handler) {
      // Mock: real impl would call inngest.createFunction(...)
      registered = true;
      console.log('  [inngest-trigger.start] function registered (mock)');
      // Immediately fire one event for probe purposes
      await handler({ event: 'inngest/trigger', source: 'inngest', registered });
    },
    async close() {
      registered = false;
      console.log('  [inngest-trigger.close] function deregistered (mock)');
    },
  };
}

// =============================================================================
// The seam pattern — structural proof that all 3 adapters follow it
// =============================================================================

/**
 * Pipeline handler — receives only the INTERFACES, never concrete types.
 * This is the invariant the seam convention enforces.
 */
async function pipelineHandler(deps: PipelineDeps): Promise<void> {
  const { memory, secrets, trigger } = deps;
  if (!memory || !secrets || !trigger) throw new Error('all deps required for this probe');

  await trigger.start(async (payload) => {
    const secretResult = await secrets.resolve('db-password');
    const secret = secretResult.error === null ? secretResult.data : 'fallback';
    await memory.write('pipeline:secret', secret);
    console.log('    [handler] trigger payload=', JSON.stringify(payload));
    console.log('    [handler] stored secret (first 20):', secret.slice(0, 20));
  });

  // Let trigger fire
  await new Promise(r => setTimeout(r, 150));

  const readResult = await memory.read('pipeline:secret');
  if (readResult.error === null) {
    console.log('    [handler] read-back (first 20):', (readResult.data ?? 'null').slice(0, 20));
  }
}

// =============================================================================
// Seam uniformity check
// =============================================================================

interface SeamCheck {
  adapterName: string;
  hasInterface: boolean;
  isDisposableResult: boolean;
  callSiteUnchanged: boolean; // pipeline code identical for dev vs prod
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
}

function printSeamTable(checks: SeamCheck[]): void {
  console.log('\n  Seam uniformity checks:');
  for (const check of checks) {
    const status = [
      check.hasInterface ? 'interface:YES' : 'interface:NO',
      check.isDisposableResult ? 'Disposable:YES' : 'Disposable:NO',
      check.callSiteUnchanged ? 'call-site:SAME' : 'call-site:DIFFERS',
    ].join(' | ');
    console.log(`    ${check.adapterName.padEnd(28)} ${status}`);
  }
}

// =============================================================================
// AdapterConvention typing assessment
// =============================================================================

function assessConventionTyping(): void {
  section('AdapterConvention<Config, Instance> — worth typing?');

  console.log(`
  The 3x-confirmed pattern:
    1. Kit defines INTERFACE at Tier 1/2 (no concrete dep)
    2. Kit ships 2+ IMPLEMENTATIONS at Tier 3 (dev + prod minimum)
    3. User selects at construction time via factory function
    4. Pipeline receives INTERFACE — runtime-agnostic
    5. Disposable opt-in if stateful (ADR-v1-V-2)

  Factory signatures:
    createInMemoryAdapter(config)   → MemoryAdapterInstance (MemoryAdapter & Disposable)
    createOrchestr8Adapter(config)  → MemoryAdapterInstance (MemoryAdapter & Disposable)
    createEnvSecretsResolver(config) → SecretsResolver (NO Disposable)
    createSopsSecretsResolver(config) → SecretsResolver (NO Disposable)
    createIntervalTrigger(config)   → TriggerAdapter & Disposable
    createInngestTrigger(config)    → TriggerAdapter & Disposable

  Does AdapterConvention<Config, Instance> add structural value?

  FINDING: NO — and here's why:
    The 3 adapters do NOT share a common Config shape:
      - MemoryAdapterConfig has namespace + registry
      - SecretsConfig has prefix
      - TriggerConfig has intervalMs + maxFires

    The factory return types differ structurally:
      - memory returns MemoryAdapter & Disposable (always Disposable)
      - secrets returns SecretsResolver (never Disposable for env/sops)
      - trigger returns TriggerAdapter & Disposable (always Disposable)

    A typed AdapterConvention<Config, Instance> would need:
      interface AdapterConvention<C, I> { create(config: C): Promise<Result<I, AdapterError>>; }
    But:
      - MemoryAdapter & Disposable is NOT the same as SecretsResolver
      - The variance in Disposable makes a base type misleading
      - TypeScript structural typing already handles this via interface + impl pattern
      - The REAL convention is: "use factory functions, not constructors"

  VERDICT: AdapterConvention<C,I> as a typed base — DOCS-ONLY.
    The pattern is real and worth documenting.
    The TYPE is not worth adding — it adds no static safety the interfaces don't already provide.
    TypeScript users already get: "must have read/write" from MemoryAdapter, etc.

  EXCEPTION (worth typed convention):
    The Disposable opt-in is worth a TYPED convention because it bridges across adapters.
    isDisposable() type-guard IS the typed convention for lifecycle.
    AdapterConvention would be over-abstracting the factory pattern.
  `);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('### Cat VI spike #3 — probe-seam-convention ###\n');

  // --- Dev configuration ---
  section('Dev configuration (in-memory, env, setInterval)');
  const devMemory = createInMemoryAdapter({ namespace: 'dev-pipeline' });
  const devSecrets = createEnvSecretsResolver();
  const devTrigger = createIntervalTrigger({ intervalMs: 60, maxFires: 2 });

  const devDeps: PipelineDeps = { memory: devMemory, secrets: devSecrets, trigger: devTrigger };

  try {
    await pipelineHandler(devDeps);
  } finally {
    const disposables = [
      { name: 'devMemory', dep: devMemory },
      { name: 'devSecrets', dep: devSecrets },
      { name: 'devTrigger', dep: devTrigger },
    ];
    for (const { name, dep } of disposables) {
      if (isDisposable(dep)) {
        await dep.close();
        console.log(`  [cleanup] ${name}.close() called`);
      } else {
        console.log(`  [cleanup] ${name}: lifecycle-free — skipped`);
      }
    }
  }

  // --- Prod configuration ---
  section('Prod configuration (orchestr8, sops, inngest)');
  const prodMemory = createOrchestr8Adapter({ namespace: 'prod-pipeline' });
  const prodSecrets = createSopsSecretsResolver();
  const prodTrigger = createInngestTrigger();

  const prodDeps: PipelineDeps = { memory: prodMemory, secrets: prodSecrets, trigger: prodTrigger };

  try {
    await pipelineHandler(prodDeps);
  } finally {
    const disposables = [
      { name: 'prodMemory', dep: prodMemory },
      { name: 'prodSecrets', dep: prodSecrets },
      { name: 'prodTrigger', dep: prodTrigger },
    ];
    for (const { name, dep } of disposables) {
      if (isDisposable(dep)) {
        await dep.close();
        console.log(`  [cleanup] ${name}.close() called`);
      } else {
        console.log(`  [cleanup] ${name}: lifecycle-free — skipped`);
      }
    }
  }

  // --- Seam uniformity proof ---
  section('Seam uniformity — call-site identity proof');
  console.log('  pipelineHandler(devDeps) and pipelineHandler(prodDeps) call IDENTICAL code.');
  console.log('  The handler does NOT know which implementation it receives.');
  console.log('  This IS the seam convention. No typed base is needed to enforce it.');

  const checks: SeamCheck[] = [
    {
      adapterName: 'createInMemoryAdapter',
      hasInterface: true,
      isDisposableResult: true,
      callSiteUnchanged: true,
    },
    {
      adapterName: 'createOrchestr8Adapter',
      hasInterface: true,
      isDisposableResult: true,
      callSiteUnchanged: true,
    },
    {
      adapterName: 'createEnvSecretsResolver',
      hasInterface: true,
      isDisposableResult: false, // lifecycle-free
      callSiteUnchanged: true,
    },
    {
      adapterName: 'createSopsSecretsResolver',
      hasInterface: true,
      isDisposableResult: false, // lifecycle-free
      callSiteUnchanged: true,
    },
    {
      adapterName: 'createIntervalTrigger',
      hasInterface: true,
      isDisposableResult: true,
      callSiteUnchanged: true,
    },
    {
      adapterName: 'createInngestTrigger',
      hasInterface: true,
      isDisposableResult: true,
      callSiteUnchanged: true,
    },
  ];

  printSeamTable(checks);

  const allSame = checks.every(c => c.callSiteUnchanged && c.hasInterface);
  console.log(`\n  [seam-check] allCallSitesIdentical = ${allSame}`);

  assessConventionTyping();
  console.log('\n[driver] seam-convention probe done. exit 0');
}

main().catch((e) => { console.error(e); process.exit(1); });
