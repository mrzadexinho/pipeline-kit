/**
 * Cat VI Spike #3 — composer-lifecycle
 * types.ts: Lifecycle type exploration
 *
 * Inputs confirmed from prior spikes:
 *   - ADR-v1-V-2: Disposable opt-in marker (β pattern) — ship at Cat V scope
 *   - Cat V spike #2 §5: DisposableRegistry (γ) bumped to Cat VI
 *   - Cat VIII cf #8: non-re-readable resources (pre-signed URLs, HTTP/2 streams)
 *   - Cat IV ADR-v1-IV-4: TriggerAdapter seam = 3rd confirmation of adapter seam convention
 *
 * Questions this file explores:
 *   Q1 — Should Composer own a DisposableRegistry? (Options A / B / C)
 *   Q2 — How do multiple adapters compose structurally? (AdapterComposer shape)
 *   Q3 — Is there a base AdapterConvention type? (or docs-only)
 */

// =============================================================================
// Result<T,E> — minimal inline (no external deps)
// =============================================================================

export type Ok<T> = { data: T; error: null };
export type Err<E> = { data: null; error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(data: T): Ok<T> { return { data, error: null }; }
export function err<E>(error: E): Err<E> { return { data: null, error }; }

// =============================================================================
// From Cat V ADR-v1-V-2 (CONFIRMED — ships at Cat V scope)
// =============================================================================

/**
 * Disposable opt-in marker.
 * Adapters with stateful lifecycle (file handles, DB connections,
 * interval timers, HTTP/2 sessions) implement this interface.
 * Lifecycle-free adapters (env lookups, static configs) do not.
 */
export interface Disposable {
  close(): Promise<void>;
}

/**
 * Type-guard from Cat V spike #2 β — ~10 LOC kit-side cost.
 * Composer calls this at pipeline teardown; no adapter-author burden.
 */
export function isDisposable(dep: unknown): dep is Disposable {
  return dep != null &&
    typeof dep === 'object' &&
    'close' in dep &&
    typeof (dep as Record<string, unknown>)['close'] === 'function';
}

// =============================================================================
// Q1 — DisposableRegistry ownership models
// =============================================================================

/**
 * Option A: Composer owns a DisposableRegistry.
 * All adapter lifetimes register via the registry at construction time.
 * Composer.run() wraps: try { await pipeline() } finally { await lifecycle.disposeAll() }
 *
 * From Cat V spike #2 §4 (cell γ): strongest Composer guarantee; forces Cat VI ADR.
 * DisposableRegistry is a pipeline-lifetime primitive (not adapter-tier).
 * Every adapter factory accepts `{ registry? }` in opts.
 */
export interface ComposerLifecycle {
  /** Register a named teardown thunk. Sync by design: registered before factory Promise resolves. */
  register(name: string, teardown: () => Promise<void>): void;
  /** Dispose all registered resources in LIFO order. */
  disposeAll(): Promise<DisposeAllResult>;
}

export interface DisposeAllResult {
  disposed: string[];
  errors: Array<{ name: string; error: unknown }>;
}

/**
 * Option B: Composer-managed, deps-aware disposal.
 * Composer walks Object.values(deps), calls isDisposable(dep) + dep.close().
 * No registry primitive; Composer inspects declared deps only.
 *
 * From Cat V ADR-v1-V-2 β-lean: THIS is the confirmed Cat V shape.
 * Limited to declared deps — cannot see user-added adapters not in deps.
 */
export interface ComposerDepAware {
  /** Called in Composer's pipeline-level finally. deps = Object.values(pipeline deps). */
  disposeAll(deps: Record<string, unknown>): Promise<DisposeAllResult>;
}

/**
 * Option C: Self-managed (adapter owns its lifecycle).
 * Composer does nothing. Each adapter uses try/finally internally.
 * User code calls close() in their own finally.
 * Kit documents the pattern; no kit primitive.
 *
 * Structural cost: every consumer site must remember to call close().
 * Error aggregation (what if two adapters both throw on close?) left to user.
 */
// Option C has no kit type; it's absence of a type.

// =============================================================================
// Multi-adapter composition shape
// =============================================================================

/**
 * PipelineContext — minimal, from ADR-v1-VIII-1 discipline.
 * Secrets and memory are NOT on PipelineContext; they ride deps.
 */
export interface PipelineContext {
  run_id: string;
  signal: AbortSignal;
}

/**
 * Confirmed 3-adapter seam convention (Cat V + Cat VIII + Cat IV each
 * contribute one confirmed instance):
 *
 *   Cat V  → MemoryAdapter (dev=InMemoryMap, prod=orchestr8 SQLite)
 *   Cat VIII → SecretsResolver (dev=env, prod=sops/oidc)
 *   Cat IV  → TriggerAdapter (dev=setInterval, prod=Inngest)
 *
 * All three follow the SAME structural contract:
 *   - Kit defines an INTERFACE at Tier 1/2 (no concrete dep)
 *   - Kit ships 2+ IMPLEMENTATIONS at Tier 3 (dev + prod minimum)
 *   - User selects implementation at construction time
 *   - Pipeline handler receives INTERFACE — runtime-agnostic
 *   - Lifecycle via Disposable opt-in if stateful
 */
export interface MemoryAdapter {
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
}

export interface SecretsResolver {
  resolve(name: string): Promise<Result<string, SecretsError>>;
}

export interface TriggerAdapter {
  start(handler: (payload: unknown) => Promise<void>): Promise<void>;
}

export interface MemoryError { type: 'memory_error'; code: string; message: string; }
export interface SecretsError { type: 'secrets_error'; code: string; message: string; }
export interface TriggerError { type: 'trigger_error'; code: string; message: string; }

/**
 * The 3-seam pipeline deps shape.
 * All three adapters live here; all are optional at construction time
 * (dev pipeline may not use triggers; prod pipeline uses all three).
 */
export interface PipelineDeps {
  memory?: MemoryAdapter & Partial<Disposable>;
  secrets?: SecretsResolver;
  trigger?: TriggerAdapter & Partial<Disposable>;
}

// =============================================================================
// Q3 — Adapter seam convention: worth typing or docs-only?
// =============================================================================

/**
 * AdapterConvention<Config, Instance>
 * Candidate base type for the 3x-confirmed adapter factory pattern.
 *
 * The pattern:
 *   1. Kit defines INTERFACE (contract) at Tier 1 / Tier 2
 *   2. Kit ships 2+ IMPLEMENTATIONS at Tier 3 (dev + prod minimum)
 *   3. User selects implementation at construction time (factory or direct)
 *   4. Pipeline handler receives the INTERFACE — runtime-agnostic
 *   5. Lifecycle managed via Disposable opt-in (if stateful)
 *
 * Question: do the 3 adapters share enough structure to warrant this type,
 * or is the convention docs-only?
 */
export interface AdapterConvention<Config, Instance> {
  create(config: Config): Promise<Result<Instance, AdapterError>>;
}

export interface AdapterError { type: 'adapter_error'; code: string; message: string; }

/**
 * Concrete factory signatures for the 3 confirmed adapters:
 *
 *   createInMemoryMemoryAdapter(config)  → Promise<Result<MemoryAdapter & Disposable, AdapterError>>
 *   createEnvSecretsResolver(config)     → Promise<Result<SecretsResolver, AdapterError>>
 *   createIntervalTriggerAdapter(config) → Promise<Result<TriggerAdapter & Disposable, AdapterError>>
 *
 * All three FOLLOW AdapterConvention<Config, Instance> structurally,
 * but none inherits from it. The type is documentary until proven otherwise.
 */

// =============================================================================
// Q4 — Abort during cleanup
// =============================================================================

/**
 * DisposalOptions — passed to disposeAll().
 * Separate from the pipeline AbortSignal by design.
 *
 * Industry references:
 *   - Node.js server.close(): always completes (graceful shutdown)
 *   - Kubernetes: terminationGracePeriodSeconds → SIGKILL
 *   - Go context.Done(): cleanup should be bounded but not cancelled
 *
 * Proposal: disposal gets a SEPARATE timeout (not the pipeline signal).
 * After timeout: log warning + abandon (never throw on abandoned disposal).
 * Default: 5000 ms (covers typical DB flush, HTTP/2 graceful close).
 */
export interface DisposalOptions {
  /** Timeout in ms for each individual adapter close(). Default: 5000. */
  timeoutMs?: number;
  /** Called when an adapter's close() exceeds timeoutMs (non-throwing). */
  onTimeout?: (name: string, elapsedMs: number) => void;
  /** Called when an adapter's close() throws (non-throwing to caller). */
  onError?: (name: string, error: unknown) => void;
}

// Type-level runtime output for the probe files:
const _typeCheckPassed: true = true;
console.log('[types] compile-time type exploration complete; _typeCheckPassed =', _typeCheckPassed);
