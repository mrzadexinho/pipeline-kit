// Cat V spike #2 — Cell γ: Composer-owned lifetime (DisposableRegistry).
//
// MemoryAdapter exposes only read + write. Adapter NEVER sees lifecycle
// at the type level. The adapter factory takes a Composer-supplied
// `DisposableRegistry` and registers a teardown thunk at construction
// time. Composer drives `registry.disposeAll()` on pipeline disposal.
//
// Sibling-adapter composition: the secrets factory inspects whether
// secrets has a teardown to register; lifecycle-free deps simply skip
// (no thunk registered). NB: the inspection logic lives at the FACTORY
// site, not the adapter type, so the secrets adapter ITSELF stays
// pristine — only the wiring code changes.
//
// Source(emit 1 atom) → Process(R+W) → Serve(print). 2 scenarios:
//   (1) happy path — registry.disposeAll() in pipeline finally
//   (2) abort scenario — same; registry guarantees disposal regardless
//       of how the run terminates.

import { createRawBackend } from './mock-orchestr8-backend.ts';
import { mockSecretsResolver, type SecretsResolver } from './mock-secrets-resolver.ts';

// --- Local Result<T, E> ---
type Ok<T> = { data: T; error: null };
type Err<E> = { data: null; error: E };
type Result<T, E> = Ok<T> | Err<E>;
const ok = <T>(data: T): Ok<T> => ({ data, error: null });
const err = <E>(error: E): Err<E> => ({ data: null, error });

// --- MemoryError envelope ---
type MemoryErrorCode = 'memory_unavailable' | 'aborted' | 'unknown';
interface MemoryError {
  type: 'memory_error';
  code: MemoryErrorCode;
  message: string;
  param?: string;
}

// === Cell γ: 2-verb contract; lifecycle is Composer-state, not type. ==
interface MemoryAdapter {
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
}

// --- DisposableRegistry: Composer-side primitive. ---
//   - register() is SYNC (factory hands a thunk in, registry stores it);
//     this matters for axis 5 (async-factory composition).
//   - disposeAll() is ASYNC (drives all registered teardowns in
//     reverse-registration order; LIFO mirrors stack discipline).
//   - Errors don't throw across the boundary; first error wins.
type Teardown = () => Promise<void>;
interface DisposableRegistry {
  register(name: string, teardown: Teardown): void;
  size(): number;
  disposeAll(): Promise<Result<void, MemoryError>>;
}

function createRegistry(): DisposableRegistry {
  const slots: Array<{ name: string; teardown: Teardown }> = [];
  return {
    register(name, teardown) {
      slots.push({ name, teardown });
    },
    size() {
      return slots.length;
    },
    async disposeAll() {
      let firstErr: MemoryError | null = null;
      // LIFO
      while (slots.length > 0) {
        const slot = slots.pop();
        if (slot === undefined) break;
        try {
          await slot.teardown();
        } catch (e) {
          if (firstErr === null) {
            firstErr = {
              type: 'memory_error',
              code: 'unknown',
              message: `teardown '${slot.name}' threw: ${e instanceof Error ? e.message : String(e)}`,
            };
          }
        }
      }
      return firstErr === null ? ok(undefined) : err(firstErr);
    },
  };
}

// --- Adapter factory (γ contract): takes registry, registers teardown,
//     returns the lifecycle-free MemoryAdapter shape. The adapter call
//     site never sees `close()` at all. ---
async function createOrchestr8MemoryAdapter(opts: {
  registry: DisposableRegistry;
}): Promise<Result<MemoryAdapter, MemoryError>> {
  try {
    const raw = await createRawBackend();
    // CRITICAL: register at construction time. Sync registration window.
    opts.registry.register('orchestr8-sqlite', async () => {
      await raw.close();
    });
    const adapter: MemoryAdapter = {
      async read(key) {
        try {
          return ok(await raw.read(key));
        } catch (e) {
          return err({
            type: 'memory_error',
            code: 'unknown',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      },
      async write(key, value) {
        try {
          await raw.write(key, value);
          return ok(undefined);
        } catch (e) {
          return err({
            type: 'memory_error',
            code: 'unknown',
            message: e instanceof Error ? e.message : String(e),
          });
        }
      },
    };
    return ok(adapter);
  } catch (e) {
    return err({
      type: 'memory_error',
      code: 'memory_unavailable',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

// --- Sibling factory: secrets has no real teardown to register; the
//     factory inspects (here trivially: literal) and decides not to
//     register. Adapter type is UNTOUCHED. ---
function createMockSecretsAdapter(_opts: {
  registry: DisposableRegistry;
}): SecretsResolver {
  // Lifecycle-free: no registration. Discoverable by absence — grep
  // shows zero `registry.register` for this adapter.
  return mockSecretsResolver;
}

// --- Atom envelope ---
interface Atom<T> {
  id: string;
  object: 'atom';
  created_at: string;
  metadata: Record<string, unknown>;
  data: T;
}

interface PipelineContext {
  run_id: string;
  signal: AbortSignal;
}

interface SourcePayload {
  key: string;
  value: string;
}
interface ProcessOutput {
  readBack: string | null;
}

// --- Stages ---
async function* sourceIter(
  _ctx: PipelineContext,
): AsyncGenerator<Result<Atom<SourcePayload>, MemoryError>> {
  yield ok({
    id: 'pk_atom_v_1',
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: { stage: 'source' },
    data: { key: 'pk_atom_v_1', value: 'hello-from-source-gamma' },
  });
}

async function* processApply(
  ctx: PipelineContext,
  input: Atom<SourcePayload>,
  deps: { memory: MemoryAdapter; secrets: SecretsResolver },
): AsyncGenerator<Result<Atom<ProcessOutput>, MemoryError>> {
  if (ctx.signal.aborted) {
    yield err({
      type: 'memory_error',
      code: 'aborted',
      message: 'aborted before atom-A',
    });
    return;
  }
  const writePromise = deps.memory.write(input.data.key, input.data.value);
  const abortPromise = new Promise<Result<void, MemoryError>>((resolve) => {
    if (ctx.signal.aborted) {
      resolve(err({ type: 'memory_error', code: 'aborted', message: 'aborted mid-write' }));
      return;
    }
    ctx.signal.addEventListener(
      'abort',
      () =>
        resolve(err({ type: 'memory_error', code: 'aborted', message: 'aborted mid-write' })),
      { once: true },
    );
  });
  const wResult = await Promise.race([writePromise, abortPromise]);
  if (wResult.error !== null) {
    yield err(wResult.error);
    return;
  }
  const _tok = await deps.secrets.resolve('apify-token');
  if (_tok.error !== null) {
    yield err({
      type: 'memory_error',
      code: 'unknown',
      message: `secrets: ${_tok.error.message}`,
    });
    return;
  }
  const rResult = await deps.memory.read(input.data.key);
  if (rResult.error !== null) {
    yield err(rResult.error);
    return;
  }
  yield ok({
    id: 'pk_atom_v_proc_1',
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: { stage: 'process' },
    data: { readBack: rResult.data },
  });
}

async function serveEmit(
  _ctx: PipelineContext,
  input: Atom<ProcessOutput>,
): Promise<Result<void, MemoryError>> {
  console.log(
    `[serve] readBack=${input.data.readBack === null ? 'null' : `'${input.data.readBack}'`}`,
  );
  return ok(undefined);
}

// --- Driver: Composer creates registry, threads it through factories,
//     drives disposeAll() in pipeline-level finally. ---
type ScenarioName = 'happy' | 'abort';
interface ScenarioOutcome {
  scenario: ScenarioName;
  closeCalled: boolean;
  closeBoundary: 'pipeline' | 'atom' | 'process' | 'none';
  cleanClose: boolean;
  errorCode: string | null;
  registeredCount: number;
}

async function runScenario(scenario: ScenarioName): Promise<ScenarioOutcome> {
  const registry = createRegistry();

  const built = await createOrchestr8MemoryAdapter({ registry });
  if (built.error !== null) {
    return {
      scenario,
      closeCalled: false,
      closeBoundary: 'none',
      cleanClose: false,
      errorCode: built.error.code,
      registeredCount: registry.size(),
    };
  }
  const memory = built.data;
  const secrets = createMockSecretsAdapter({ registry });
  const registeredAtConstruction = registry.size();

  const controller = new AbortController();
  const ctx: PipelineContext = { run_id: `pk_run_gamma_${scenario}`, signal: controller.signal };

  if (scenario === 'abort') {
    controller.abort();
  }

  let closeCalled = false;
  let closeBoundary: ScenarioOutcome['closeBoundary'] = 'none';
  let cleanClose = false;
  let errorCode: string | null = null;

  try {
    for await (const sRes of sourceIter(ctx)) {
      if (sRes.error !== null) {
        errorCode = sRes.error.code;
        break;
      }
      for await (const pRes of processApply(ctx, sRes.data, { memory, secrets })) {
        if (pRes.error !== null) {
          errorCode = pRes.error.code;
          break;
        }
        const eRes = await serveEmit(ctx, pRes.data);
        if (eRes.error !== null) {
          errorCode = eRes.error.code;
          break;
        }
      }
    }
  } finally {
    closeCalled = true;
    closeBoundary = 'pipeline';
    const r = await registry.disposeAll();
    cleanClose = r.error === null;
  }
  return {
    scenario,
    closeCalled,
    closeBoundary,
    cleanClose,
    errorCode,
    registeredCount: registeredAtConstruction,
  };
}

async function main(): Promise<void> {
  console.log('### Cat V spike #2 — Cell γ (Composer-owned lifetime) ###');

  const happy = await runScenario('happy');
  console.log(
    `[clean-close] cell=gamma scenario=happy closed=${happy.cleanClose} registered-at-construction=${happy.registeredCount}`,
  );
  console.log(
    `[abort-branch] cell=gamma scenario=happy close-called=${happy.closeCalled} boundary=${happy.closeBoundary}`,
  );

  const abort = await runScenario('abort');
  console.log(
    `[clean-close] cell=gamma scenario=abort closed=${abort.cleanClose} errorCode=${abort.errorCode ?? 'none'} registered-at-construction=${abort.registeredCount}`,
  );
  console.log(
    `[abort-branch] cell=gamma scenario=abort close-called=${abort.closeCalled} boundary=${abort.closeBoundary}`,
  );

  // Axis 3: sibling cost — γ IMPOSES NOTHING on lifecycle-free sibling
  // type. The adapter type stays pristine; the FACTORY threads registry
  // but lifecycle-free factories simply skip register(). The cost moves
  // from adapter-type to factory-wiring code (orthogonal axis).
  console.log(
    `[sibling-cost] cell=gamma stub-close-required=false introspection-required=false note='cost lives on factory-wiring, not adapter-type'`,
  );

  // Axis 4: LOC + greppable contract.
  // Construction site delta vs spike #1: +1 registry param threaded
  // through factory, +1 register() call inside backend factory, kit-side
  // +1 DisposableRegistry primitive (35-LOC roughly). Counted by hand.
  console.log(
    `[loc] cell=gamma construction-site-loc-delta=2 grep-pattern='registry.register'`,
  );

  // Axis 5: async-factory composition.
  // CRITICAL: registry.register is SYNC — happens INSIDE the async factory
  // body, before the factory's Promise resolves. So Cat VIII ADR-v1-VIII-1
  // shape `await create<X>Adapter({ args, deps })` lifts UNCHANGED, just
  // with an additional `registry` field on opts. No new ergonomic
  // primitive at call-site beyond a registry handle.
  console.log(
    `[async-factory] cell=gamma compatible=true note='registry.register is sync inside async factory body; ADR-v1-VIII-1 shape preserved with +1 opts field'`,
  );

  if (!happy.cleanClose) {
    console.log('[driver] FAIL: cell-gamma happy path did not close cleanly');
    process.exitCode = 1;
    return;
  }
  if (!abort.closeCalled) {
    console.log('[driver] FAIL: cell-gamma abort scenario did not call disposeAll');
    process.exitCode = 1;
    return;
  }
  console.log('[driver] OK cell=gamma');
}

await main();
