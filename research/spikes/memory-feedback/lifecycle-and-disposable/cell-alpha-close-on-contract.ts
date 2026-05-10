// Cat V spike #2 — Cell α: `close()` on the contract.
//
// MemoryAdapter = { read, write, close }. EVERY backend (lifecycle-free
// or not) must stub close. Mirror of Cat VIII variant A discipline:
// ambient-cost pattern at adapter scope.
//
// Sibling-adapter composition: mock SecretsResolver MUST also gain a
// stub close (verb-cost imposed on the lifecycle-free dep — that's the
// whole point of α).
//
// Source(emit 1 atom) → Process(R+W) → Serve(print). 2 scenarios:
//   (1) happy path — close() called on success
//   (2) abort scenario — controller.abort() races atom-A's write;
//       observe whether close() still gets called.
//
// 5 axes printed: clean-close / abort-branch / sibling-cost / loc /
// async-factory.

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

// === Cell α: MemoryAdapter forces close() on the contract. ============
interface MemoryAdapter {
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
  close(): Promise<Result<void, MemoryError>>;
}

// --- Cost imposed on lifecycle-free sibling: SecretsResolver ALSO must
//     gain a stub close. Variant A discipline: ambient cost at adapter
//     scope. Below is what α forces every adapter author to write. ---
interface ClosableSecretsResolver extends SecretsResolver {
  close(): Promise<Result<void, MemoryError>>;
}

const closableMockSecrets: ClosableSecretsResolver = {
  resolve: mockSecretsResolver.resolve.bind(mockSecretsResolver),
  // STUB CLOSE — required by the contract; does nothing for a memory-only resolver.
  async close() {
    return ok(undefined);
  },
};

// --- Adapter factory: orchestr8 wrap. Real lifecycle. ---
async function createOrchestr8MemoryAdapter(): Promise<
  Result<MemoryAdapter, MemoryError>
> {
  try {
    const raw = await createRawBackend();
    const adapter: MemoryAdapter = {
      async read(key) {
        try {
          const v = await raw.read(key);
          return ok(v);
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
      async close() {
        try {
          await raw.close();
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

// --- Stages (kept minimal — same shape across α/β/γ) ---
async function* sourceIter(
  _ctx: PipelineContext,
): AsyncGenerator<Result<Atom<SourcePayload>, MemoryError>> {
  yield ok({
    id: 'pk_atom_v_1',
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: { stage: 'source' },
    data: { key: 'pk_atom_v_1', value: 'hello-from-source-alpha' },
  });
}

async function* processApply(
  ctx: PipelineContext,
  input: Atom<SourcePayload>,
  deps: { memory: MemoryAdapter; secrets: ClosableSecretsResolver },
): AsyncGenerator<Result<Atom<ProcessOutput>, MemoryError>> {
  if (ctx.signal.aborted) {
    yield err({
      type: 'memory_error',
      code: 'aborted',
      message: 'aborted before atom-A',
    });
    return;
  }
  // atom-A: write — race with abort signal
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
  // sibling adapter touch (just so deps.secrets is exercised once)
  const _tok = await deps.secrets.resolve('apify-token');
  if (_tok.error !== null) {
    yield err({
      type: 'memory_error',
      code: 'unknown',
      message: `secrets: ${_tok.error.message}`,
    });
    return;
  }
  // atom-B: read
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

// --- Driver: runs ONE scenario; α calls .close() at end of run. ---
type ScenarioName = 'happy' | 'abort';
interface ScenarioOutcome {
  scenario: ScenarioName;
  closeCalled: boolean;
  closeBoundary: 'pipeline' | 'atom' | 'process' | 'none';
  cleanClose: boolean;
  errorCode: string | null;
}

async function runScenario(scenario: ScenarioName): Promise<ScenarioOutcome> {
  const built = await createOrchestr8MemoryAdapter();
  if (built.error !== null) {
    return {
      scenario,
      closeCalled: false,
      closeBoundary: 'none',
      cleanClose: false,
      errorCode: built.error.code,
    };
  }
  const memory = built.data;

  const controller = new AbortController();
  const ctx: PipelineContext = { run_id: `pk_run_alpha_${scenario}`, signal: controller.signal };

  if (scenario === 'abort') {
    // Abort *during* atom-A's write window. Orchestr8 SQLite (`:memory:`)
    // resolves writes synchronously inside the microtask queue; per brief
    // §axis-2 a Promise.race against an immediately-aborted signal is the
    // accepted simulation. Fire the abort *before* the iterator yields its
    // first tick so the race resolves on the abort branch deterministically.
    controller.abort();
  }

  let closeCalled = false;
  let closeBoundary: ScenarioOutcome['closeBoundary'] = 'none';
  let cleanClose = false;
  let errorCode: string | null = null;

  // α discipline: pipeline-level finally OWNS close. Adapter never closes itself.
  try {
    for await (const sRes of sourceIter(ctx)) {
      if (sRes.error !== null) {
        errorCode = sRes.error.code;
        break;
      }
      for await (const pRes of processApply(ctx, sRes.data, {
        memory,
        secrets: closableMockSecrets,
      })) {
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
    // PIPELINE-LEVEL CLOSE (α's discipline: contract verb, called by driver).
    closeCalled = true;
    closeBoundary = 'pipeline';
    const closeRes = await memory.close();
    cleanClose = closeRes.error === null;
    // sibling close (verb-cost imposed by α's contract)
    await closableMockSecrets.close();
  }
  return { scenario, closeCalled, closeBoundary, cleanClose, errorCode };
}

async function main(): Promise<void> {
  console.log('### Cat V spike #2 — Cell α (close on contract) ###');

  const happy = await runScenario('happy');
  console.log(
    `[clean-close] cell=alpha scenario=happy closed=${happy.cleanClose}`,
  );
  console.log(
    `[abort-branch] cell=alpha scenario=happy close-called=${happy.closeCalled} boundary=${happy.closeBoundary}`,
  );

  const abort = await runScenario('abort');
  console.log(
    `[clean-close] cell=alpha scenario=abort closed=${abort.cleanClose} errorCode=${abort.errorCode ?? 'none'}`,
  );
  console.log(
    `[abort-branch] cell=alpha scenario=abort close-called=${abort.closeCalled} boundary=${abort.closeBoundary}`,
  );

  // Axis 3: sibling cost — α IMPOSES stub close on lifecycle-free sibling.
  console.log(
    `[sibling-cost] cell=alpha stub-close-required=true introspection-required=false`,
  );

  // Axis 4: LOC + greppable contract.
  // Construction-site delta vs spike #1 baseline: +1 verb on adapter
  // interface (close), +1 method per adapter impl, +1 verb on EVERY
  // sibling adapter (closableMockSecrets's stub close), +1 finally-block
  // close call at driver. Counted by hand (see findings §3.1).
  console.log(
    `[loc] cell=alpha construction-site-loc-delta=12 grep-pattern='close: '`,
  );

  // Axis 5: async-factory composition.
  // α's contract is method-on-shape; factories return Promise<Result<MemoryAdapter,_>>
  // exactly as spike #1 (Cat VIII ADR-v1-VIII-1) — no mismatch.
  console.log(
    `[async-factory] cell=alpha compatible=true note='close is just another async method on the adapter shape; no factory-shape change'`,
  );

  if (!happy.cleanClose) {
    console.log('[driver] FAIL: cell-alpha happy path did not close cleanly');
    process.exitCode = 1;
    return;
  }
  if (!abort.closeCalled) {
    console.log('[driver] FAIL: cell-alpha abort scenario did not call close');
    process.exitCode = 1;
    return;
  }
  console.log('[driver] OK cell=alpha');
}

await main();
