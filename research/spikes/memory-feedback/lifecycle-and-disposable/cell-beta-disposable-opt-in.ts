// Cat V spike #2 — Cell β: `Disposable` opt-in interface.
//
// MemoryAdapter stays at 2 verbs (read, write). Backends with real
// lifecycle ALSO implement a separate `Disposable { close(): ... }`.
// Composer detects via `'close' in adapter` runtime check + structural
// narrowing.
//
// Sibling-adapter composition: mock SecretsResolver stays UNTOUCHED.
// That's the discoverability win for β.
//
// Source(emit 1 atom) → Process(R+W) → Serve(print). 2 scenarios:
//   (1) happy path — Composer detects Disposable, calls close()
//   (2) abort scenario — controller.abort() races atom-A's write;
//       Composer's introspection still finds Disposable, calls close()
//       in pipeline-level finally.

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

// === Cell β: minimum 2-verb contract; Disposable is OPT-IN. ===========
interface MemoryAdapter {
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
}

// --- Disposable: separate, narrow opt-in interface. ---
interface Disposable {
  close(): Promise<Result<void, MemoryError>>;
}

// Type-guard mirrors what a Composer would do at run-time.
function isDisposable(x: unknown): x is Disposable {
  return (
    typeof x === 'object' &&
    x !== null &&
    'close' in x &&
    typeof (x as { close?: unknown }).close === 'function'
  );
}

// --- Adapter factory: orchestr8 wrap. Implements BOTH MemoryAdapter
//     and Disposable. ---
type OrchestrAdapter = MemoryAdapter & Disposable;

async function createOrchestr8MemoryAdapter(): Promise<
  Result<OrchestrAdapter, MemoryError>
> {
  try {
    const raw = await createRawBackend();
    const adapter: OrchestrAdapter = {
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

// --- Stages ---
async function* sourceIter(
  _ctx: PipelineContext,
): AsyncGenerator<Result<Atom<SourcePayload>, MemoryError>> {
  yield ok({
    id: 'pk_atom_v_1',
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: { stage: 'source' },
    data: { key: 'pk_atom_v_1', value: 'hello-from-source-beta' },
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
  // sibling adapter touch — UNTOUCHED resolver, no stub close required
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

// --- Composer-like driver: introspects deps for Disposable; calls close
//     on the ones that opted in. β discipline: lifecycle is invisible
//     to the adapter author who didn't need it. ---
type ScenarioName = 'happy' | 'abort';
interface ScenarioOutcome {
  scenario: ScenarioName;
  closeCalled: boolean;
  closeBoundary: 'pipeline' | 'atom' | 'process' | 'none';
  cleanClose: boolean;
  errorCode: string | null;
  introspectedDisposables: number;
}

async function disposeAll(deps: ReadonlyArray<unknown>): Promise<Result<void, MemoryError>> {
  let firstErr: MemoryError | null = null;
  for (const dep of deps) {
    if (isDisposable(dep)) {
      const r = await dep.close();
      if (r.error !== null && firstErr === null) firstErr = r.error;
    }
  }
  return firstErr === null ? ok(undefined) : err(firstErr);
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
      introspectedDisposables: 0,
    };
  }
  const memory = built.data;
  const secrets = mockSecretsResolver; // pristine, no Disposable

  const controller = new AbortController();
  const ctx: PipelineContext = { run_id: `pk_run_beta_${scenario}`, signal: controller.signal };

  if (scenario === 'abort') {
    controller.abort();
  }

  let closeCalled = false;
  let closeBoundary: ScenarioOutcome['closeBoundary'] = 'none';
  let cleanClose = false;
  let errorCode: string | null = null;
  // Introspection cost — Composer must scan all deps for `'close' in dep`.
  const allDeps: ReadonlyArray<unknown> = [memory, secrets];
  const introspectedDisposables = allDeps.filter(isDisposable).length;

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
    // PIPELINE-LEVEL DISPOSE — Composer-driven, introspection-based.
    closeCalled = true;
    closeBoundary = 'pipeline';
    const r = await disposeAll(allDeps);
    cleanClose = r.error === null;
  }
  return { scenario, closeCalled, closeBoundary, cleanClose, errorCode, introspectedDisposables };
}

async function main(): Promise<void> {
  console.log('### Cat V spike #2 — Cell β (Disposable opt-in) ###');

  const happy = await runScenario('happy');
  console.log(
    `[clean-close] cell=beta scenario=happy closed=${happy.cleanClose} introspected-disposables=${happy.introspectedDisposables}`,
  );
  console.log(
    `[abort-branch] cell=beta scenario=happy close-called=${happy.closeCalled} boundary=${happy.closeBoundary}`,
  );

  const abort = await runScenario('abort');
  console.log(
    `[clean-close] cell=beta scenario=abort closed=${abort.cleanClose} errorCode=${abort.errorCode ?? 'none'} introspected-disposables=${abort.introspectedDisposables}`,
  );
  console.log(
    `[abort-branch] cell=beta scenario=abort close-called=${abort.closeCalled} boundary=${abort.closeBoundary}`,
  );

  // Axis 3: sibling cost — β IMPOSES NOTHING on lifecycle-free sibling.
  // Composer pays the introspection cost ONCE.
  console.log(
    `[sibling-cost] cell=beta stub-close-required=false introspection-required=true`,
  );

  // Axis 4: LOC + greppable contract.
  // Construction site delta vs spike #1: +1 verb on adapter impl
  // (close, only on backends that need it), +1 separate `Disposable`
  // interface decl (kit-side, one-time), +0 on lifecycle-free siblings.
  // Composer-side: +1 type-guard helper + +1 disposeAll loop. Counted by hand.
  console.log(
    `[loc] cell=beta construction-site-loc-delta=4 grep-pattern='implements Disposable'`,
  );

  // Axis 5: async-factory composition.
  // β's adapter still flows through createOrchestr8MemoryAdapter() ->
  // Promise<Result<MemoryAdapter & Disposable, _>>. Same factory shape
  // as Cat VIII ADR-v1-VIII-1; intersection type is purely structural.
  console.log(
    `[async-factory] cell=beta compatible=true note='factory returns MemoryAdapter & Disposable; intersection cost-free at call-site'`,
  );

  if (!happy.cleanClose) {
    console.log('[driver] FAIL: cell-beta happy path did not close cleanly');
    process.exitCode = 1;
    return;
  }
  if (!abort.closeCalled) {
    console.log('[driver] FAIL: cell-beta abort scenario did not call close');
    process.exitCode = 1;
    return;
  }
  console.log('[driver] OK cell=beta');
}

await main();
