// Cat V spike #1 — deps-shape-lift.
// Single-cell, single-run TS spike. Throwaway quality.
//
// Question: does the Cat VIII deps-shape default
// (`deps: { secrets: SecretsResolver }`, ADR-v1-VIII-1) lift to memory's
// R+W contract — does `deps: { memory: MemoryAdapter }` survive when
// atoms must both READ and WRITE in a single run?
//
// Pipeline shape (1 Source atom → 1 Process splitting into 2 internal
// atoms (A=write, B=read) → 1 Serve emission):
//
//   Source<{key,value}>  emits 1 atom: {key:'pk_atom_v_1', value:'hello-from-source'}
//   Process<{key,value}, {readBack:string|null}>  splits into 2 atoms in one run:
//       atom-A: deps.memory.write(key, value)  → Result<void, MemoryError>
//       atom-B: deps.memory.read(key)          → Result<string|null, MemoryError>
//   Serve receives {readBack} and prints it. Atom B must observe atom A's write.
//
// Adapter wiring path: orchestr8-mcp npm direct import (option (b) per
// brief). Reasons logged in findings §1 and §5. Uses SQLiteBackend at
// `:memory:` so the spike is hermetic + repeatable.
//
// Constraints honoured:
//   - TS strict / no `any` / ESM / Result<T,E> for stage outputs.
//   - No kit core imports — minimal local Result type.
//   - No throwing across stage boundary.

import { SQLiteBackend, createMemoryEntry } from 'orchestr8-mcp/dist/memory/index.js';

// --- Local Result<T, E> (no kit dep; mirrors ADR4 shape) ---
type Ok<T> = { data: T; error: null };
type Err<E> = { data: null; error: E };
type Result<T, E> = Ok<T> | Err<E>;
const ok = <T>(data: T): Ok<T> => ({ data, error: null });
const err = <E>(error: E): Err<E> => ({ data: null, error });

// --- MemoryError envelope (kit conventions: type/code/message/param) ---
type MemoryErrorCode = 'memory_unavailable' | 'unknown';
interface MemoryError {
  type: 'memory_error';
  code: MemoryErrorCode;
  message: string;
  param?: string;
}

// --- MemoryAdapter (parallel to Cat VIII SecretsResolver — minimum 2 verbs) ---
// Deliberate non-features (deferred to later spikes per brief):
//   - search/forget/list — defer to outline § Cat V Q1 (full verb-set).
//   - scope() façade — defer to outline § Cat V Q2 (scoping unit).
//   - version-aware wrapper — defer (memory rotation semantics out of day-1).
interface MemoryAdapter {
  read(key: string): Promise<Result<string | null, MemoryError>>;
  write(key: string, value: string): Promise<Result<void, MemoryError>>;
}

// --- Adapter impl: orchestr8 SQLiteBackend wrapped in MemoryAdapter shape ---
// Empirically validates Phase 0 finding "orchestr8 already kit-shaped".
const SPIKE_NAMESPACE = 'pk-spike-cat-v-deps-shape-lift';

async function createOrchestr8MemoryAdapter(): Promise<
  Result<{ memory: MemoryAdapter; close: () => Promise<void> }, MemoryError>
> {
  try {
    const backend = new SQLiteBackend({ databasePath: ':memory:' });
    await backend.initialize();
    const memory: MemoryAdapter = {
      async read(key) {
        const entry = await backend.retrieve(key, SPIKE_NAMESPACE);
        if (entry === undefined) return ok(null);
        return ok(entry.content);
      },
      async write(key, value) {
        const entry = createMemoryEntry({
          key,
          content: value,
          namespace: SPIKE_NAMESPACE,
          type: 'working',
        });
        await backend.store(entry);
        return ok(undefined);
      },
    };
    return ok({
      memory,
      close: async () => {
        await backend.close();
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({
      type: 'memory_error',
      code: 'memory_unavailable',
      message: `orchestr8 SQLiteBackend init failed: ${message}`,
    });
  }
}

// --- Atom envelope (kit-shape: id / object / created_at / metadata + payload) ---
interface Atom<T> {
  id: string;
  object: 'atom';
  created_at: string;
  metadata: Record<string, unknown>;
  data: T;
}

// --- PipelineContext (run-scope only; ADR-v1-VIII-1: secrets/memory NOT here) ---
interface PipelineContext {
  run_id: string;
  signal: AbortSignal;
}

// --- Source<O> emits 1 atom ---
interface SourcePayload {
  key: string;
  value: string;
}
interface Source<O> {
  id: string;
  iter(ctx: PipelineContext): AsyncGenerator<Result<Atom<O>, MemoryError>>;
}
function createSeedSource(): Source<SourcePayload> {
  return {
    id: 'pk_src_seed_v',
    async *iter(_ctx) {
      yield ok({
        id: 'pk_atom_v_1',
        object: 'atom',
        created_at: new Date().toISOString(),
        metadata: { stage: 'source' },
        data: { key: 'pk_atom_v_1', value: 'hello-from-source' },
      });
    },
  };
}

// --- Process<I, O> with R+W memory dep — splits 1 input → 2 internal atoms ---
// Construction-site contract mirrors Cat VIII ADR-v1-VIII-1:
//   `await createMemProcess({ args: { keyPrefix }, deps: { memory } })`
// Async factory ergonomics same as Cat VIII (Promise<Result<...>> if any
// factory-time read needed; this spike's factory is sync-safe but kept
// async to honour the lifted shape).
interface ProcessOutput {
  readBack: string | null;
  wroteAtomId: string;
  readAtomId: string;
}
interface Process<I, O> {
  id: string;
  apply(
    ctx: PipelineContext,
    input: Atom<I>,
  ): AsyncGenerator<Result<Atom<O>, MemoryError>>;
}
async function createMemProcess(opts: {
  args: { keyPrefix: string };
  deps: { memory: MemoryAdapter };
}): Promise<Result<Process<SourcePayload, ProcessOutput>, MemoryError>> {
  const { args, deps } = opts;
  const { memory } = deps;

  return ok({
    id: 'pk_proc_mem_rw',
    async *apply(_ctx, input) {
      const composedKey = `${args.keyPrefix}-${input.data.key}`;

      // --- internal atom A: WRITE ---
      const wResult = await memory.write(composedKey, input.data.value);
      if (wResult.error !== null) {
        yield err(wResult.error);
        return;
      }
      const wroteAtomId = `pk_atom_v_proc_W_${input.data.key}`;
      console.log(
        `[proc] atom-A WROTE key='${composedKey}' value='${input.data.value}'`,
      );

      // --- internal atom B: READ (must observe atom A's write) ---
      const rResult = await memory.read(composedKey);
      if (rResult.error !== null) {
        yield err(rResult.error);
        return;
      }
      const readAtomId = `pk_atom_v_proc_R_${input.data.key}`;
      console.log(
        `[proc] atom-B READ  key='${composedKey}' got=${
          rResult.data === null ? 'null' : `'${rResult.data}'`
        }`,
      );

      yield ok({
        id: `pk_atom_v_proc_${input.data.key}`,
        object: 'atom',
        created_at: new Date().toISOString(),
        metadata: {
          stage: 'process',
          wroteAtomId,
          readAtomId,
          composedKey,
        },
        data: { readBack: rResult.data, wroteAtomId, readAtomId },
      });
    },
  });
}

// --- Serve<I> emits to stdout ---
interface Serve<I> {
  id: string;
  emit(ctx: PipelineContext, input: Atom<I>): Promise<Result<void, MemoryError>>;
}
function createStdoutServe(): Serve<ProcessOutput> {
  return {
    id: 'pk_serve_stdout',
    async emit(_ctx, input) {
      console.log(
        `[serve] readBack=${
          input.data.readBack === null ? 'null' : `'${input.data.readBack}'`
        } (from atom-B observing atom-A's write)`,
      );
      return ok(undefined);
    },
  };
}

// --- Driver: Source.iter → Process.apply → Serve.emit, single run, 1 atom ---
async function main(): Promise<void> {
  console.log('### Cat V spike #1 — deps-shape-lift (single cell, single run) ###');

  const adapterBuilt = await createOrchestr8MemoryAdapter();
  if (adapterBuilt.error !== null) {
    console.log(
      `[driver] FATAL: adapter build failed: ${adapterBuilt.error.code}: ${adapterBuilt.error.message}`,
    );
    process.exitCode = 1;
    return;
  }
  const { memory, close } = adapterBuilt.data;
  console.log('[driver] orchestr8 SQLiteBackend (:memory:) wired as MemoryAdapter');

  // Construction site — Cat VIII ADR-v1-VIII-1 lifted to memory.
  const procBuilt = await createMemProcess({
    args: { keyPrefix: 'spike-1' },
    deps: { memory },
  });
  if (procBuilt.error !== null) {
    console.log(
      `[driver] FATAL: process factory failed: ${procBuilt.error.code}: ${procBuilt.error.message}`,
    );
    await close();
    process.exitCode = 1;
    return;
  }
  const proc = procBuilt.data;

  const source = createSeedSource();
  const serve = createStdoutServe();

  const ctx: PipelineContext = {
    run_id: 'pk_run_CAT_V_SPIKE_1_DEMO',
    signal: new AbortController().signal,
  };

  let atomCount = 0;
  let observedReadBack = false;
  for await (const sourceResult of source.iter(ctx)) {
    if (sourceResult.error !== null) {
      console.log(`[driver] source ERR ${sourceResult.error.code}`);
      process.exitCode = 1;
      break;
    }
    for await (const procResult of proc.apply(ctx, sourceResult.data)) {
      if (procResult.error !== null) {
        console.log(
          `[driver] process ERR ${procResult.error.code}: ${procResult.error.message}`,
        );
        process.exitCode = 1;
        break;
      }
      atomCount += 1;
      const emitResult = await serve.emit(ctx, procResult.data);
      if (emitResult.error !== null) {
        console.log(`[driver] serve ERR ${emitResult.error.code}`);
        process.exitCode = 1;
        break;
      }
      // Empirical assertion: atom B observed atom A's write.
      if (procResult.data.data.readBack === sourceResult.data.data.value) {
        observedReadBack = true;
      }
    }
  }

  console.log(`[driver] atomsEmitted=${atomCount} observedReadBack=${observedReadBack}`);
  await close();

  if (!observedReadBack) {
    console.log('[driver] FAIL: atom-B did not observe atom-A write');
    process.exitCode = 1;
  } else {
    console.log('[driver] OK: R+W round-trip held in single run');
  }
}

await main();
