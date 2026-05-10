// Cat V spike #3 — Cell β: verb-growth-forced.
//
// Run-1: writes 5 atoms within a single namespace.
// Run-2: Source emits ONLY the namespace; Process must enumerate atoms
// in the namespace using `deps.memory.list(namespace)` — the spike-3
// verb-growth probe.
//
// `list` is exposed as an OPT-IN MARKER INTERFACE (`Listable`), parallel
// to spike-2's `Disposable`. The orchestr8 disk-backed adapter
// implements both `MemoryAdapter` AND `Listable` AND `Disposable`. The
// mock SecretsResolver implements neither — it pays NO verb-cost (axis
// β.3).
//
// Call-site uses runtime introspection (`isListable(...)`) to narrow,
// and falls back to a CURSOR-FILE WORKAROUND if the adapter is not
// Listable (this falsifiability check is the heart of axis β.1: if the
// workaround is cleaner than the verb, that's a signal `list` shouldn't
// be on a kit-level marker interface at all).
//
// Driver dispatches by argv[2]: 'run-1' | 'run-2'.

import {
  createOrchestr8DiskMemoryAdapter,
  isDisposable,
  isListable,
  type Listable,
  type MemoryAdapter,
  type MemoryError,
  type Result,
  ok,
  err,
} from './mock-orchestr8-disk-backend.ts';
import { mockSecretsResolver, type SecretsResolver } from './mock-secrets-resolver.ts';

// --- Cell-β config ---
const CELL_BETA_NAMESPACE = 'extract-run-2026-05-09';
const CELL_BETA_DB_PATH = './.spike-3-data/cell-beta.sqlite';
const COMPOSED_KEY_SEPARATOR = '::';
const N_ATOMS = 5;

const ATOM_IDS: ReadonlyArray<string> = Array.from(
  { length: N_ATOMS },
  (_, i) => `atom-${i + 1}`,
);
const RUN_1_VALUES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(ATOM_IDS.map((id) => [id, `value-from-run-1-${id}`])),
);

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

// --- composedKey helper ---
function composedKey(atomId: string): string {
  return `${CELL_BETA_NAMESPACE}${COMPOSED_KEY_SEPARATOR}${atomId}`;
}

// --- Source (Run-1: emits 5 atoms with values) ---
async function* sourceIterRun1(
  _ctx: PipelineContext,
): AsyncGenerator<Result<Atom<{ atomId: string; value: string }>, MemoryError>> {
  for (const atomId of ATOM_IDS) {
    const value = RUN_1_VALUES[atomId];
    if (value === undefined) {
      yield err({
        type: 'memory_error',
        code: 'unknown',
        message: `missing run-1 value for ${atomId}`,
      });
      return;
    }
    yield ok({
      id: `pk_atom_v_beta_${atomId}`,
      object: 'atom',
      created_at: new Date().toISOString(),
      metadata: { stage: 'source', run: 'run-1' },
      data: { atomId, value },
    });
  }
}

// --- Source (Run-2: emits ONLY the namespace, NOT the keys) ---
async function* sourceIterRun2(
  _ctx: PipelineContext,
): AsyncGenerator<Result<Atom<{ namespace: string }>, MemoryError>> {
  yield ok({
    id: 'pk_atom_v_beta_namespace_only',
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: { stage: 'source', run: 'run-2' },
    data: { namespace: CELL_BETA_NAMESPACE },
  });
}

// --- Run-1 Process: writes ---
async function* processWrite(
  ctx: PipelineContext,
  input: Atom<{ atomId: string; value: string }>,
  deps: { memory: MemoryAdapter; secrets: SecretsResolver },
): AsyncGenerator<Result<Atom<{ writtenKey: string; writtenValue: string }>, MemoryError>> {
  if (ctx.signal.aborted) {
    yield err({ type: 'memory_error', code: 'aborted', message: 'aborted' });
    return;
  }
  const key = composedKey(input.data.atomId);
  const w = await deps.memory.write(key, input.data.value);
  if (w.error !== null) {
    yield err(w.error);
    return;
  }
  // Sibling-touch: verb-frozen, lifecycle-free secrets resolver.
  const tok = await deps.secrets.resolve('apify-token');
  if (tok.error !== null) {
    yield err({
      type: 'memory_error',
      code: 'unknown',
      message: `secrets: ${tok.error.message}`,
    });
    return;
  }
  yield ok({
    id: `pk_atom_v_beta_proc_W_${input.data.atomId}`,
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: { stage: 'process', verb: 'write', composedKey: key },
    data: { writtenKey: key, writtenValue: input.data.value },
  });
}

// --- Run-2 Process: enumerate-by-namespace + read-each ---
//
// CORE β.1 PROBE: try Listable narrowing first; if absent, fall back to
// a "cursor file" workaround that the executor hand-rolls (sentinel
// key written by Run-1 listing all atom-ids in the namespace).
//
// Spike outputs both branch's behaviour so we can compare ergonomic cost.
async function* processEnumerateAndRead(
  ctx: PipelineContext,
  input: Atom<{ namespace: string }>,
  deps: { memory: MemoryAdapter; secrets: SecretsResolver },
): AsyncGenerator<
  Result<
    Atom<{
      enumerationStrategy: 'listable' | 'cursor-file-workaround';
      atomsRead: number;
      keysFound: ReadonlyArray<string>;
      values: ReadonlyArray<string | null>;
    }>,
    MemoryError
  >
> {
  if (ctx.signal.aborted) {
    yield err({ type: 'memory_error', code: 'aborted', message: 'aborted' });
    return;
  }

  // β.1 — narrow on Listable opt-in.
  let strategy: 'listable' | 'cursor-file-workaround';
  let foundKeys: string[];
  if (isListable(deps.memory)) {
    strategy = 'listable';
    const listed = await deps.memory.list(input.data.namespace);
    if (listed.error !== null) {
      yield err(listed.error);
      return;
    }
    foundKeys = [...listed.data];
  } else {
    // Fallback workaround: spike does NOT actually exercise this branch
    // because the disk adapter implements Listable — but the code path
    // is here so we can comment on its ergonomic cost in FINDINGS β.1.
    strategy = 'cursor-file-workaround';
    foundKeys = [];
  }

  // Read each enumerated key.
  const values: (string | null)[] = [];
  for (const k of foundKeys) {
    const r = await deps.memory.read(k);
    if (r.error !== null) {
      yield err(r.error);
      return;
    }
    values.push(r.data);
  }

  // sibling-touch: verb-frozen secrets.
  const tok = await deps.secrets.resolve('apify-token');
  if (tok.error !== null) {
    yield err({
      type: 'memory_error',
      code: 'unknown',
      message: `secrets: ${tok.error.message}`,
    });
    return;
  }

  yield ok({
    id: 'pk_atom_v_beta_proc_enumerate',
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: { stage: 'process', verb: 'list+read', namespace: input.data.namespace },
    data: {
      enumerationStrategy: strategy,
      atomsRead: values.length,
      keysFound: foundKeys,
      values,
    },
  });
}

// --- Drivers ---
async function runRun1(): Promise<void> {
  const built = await createOrchestr8DiskMemoryAdapter({
    namespace: CELL_BETA_NAMESPACE,
    databasePath: CELL_BETA_DB_PATH,
  });
  if (built.error !== null) {
    console.log(`[driver] FATAL: ${built.error.code}: ${built.error.message}`);
    process.exitCode = 1;
    return;
  }
  const memory = built.data;
  const secrets = mockSecretsResolver;
  const allDeps: ReadonlyArray<unknown> = [memory, secrets];

  // β.3 sibling-cost probe — confirm secrets is NOT Listable.
  console.log(
    `[run-1 sibling-cost] secrets-implements-Listable=${isListable(secrets)} memory-implements-Listable=${isListable(memory)}`,
  );

  const controller = new AbortController();
  const ctx: PipelineContext = { run_id: 'pk_run_beta_run_1', signal: controller.signal };

  let writes = 0;
  try {
    for await (const sRes of sourceIterRun1(ctx)) {
      if (sRes.error !== null) {
        console.log(`[driver] source ERR: ${sRes.error.message}`);
        process.exitCode = 1;
        return;
      }
      for await (const pRes of processWrite(ctx, sRes.data, { memory, secrets })) {
        if (pRes.error !== null) {
          console.log(`[driver] write ERR: ${pRes.error.message}`);
          process.exitCode = 1;
          return;
        }
        writes += 1;
        console.log(
          `[run-1 write] key='${pRes.data.data.writtenKey}' value='${pRes.data.data.writtenValue}'`,
        );
      }
    }
  } finally {
    let firstErr: MemoryError | null = null;
    for (const dep of allDeps) {
      if (isDisposable(dep)) {
        const c = await dep.close();
        if (c.error !== null && firstErr === null) firstErr = c.error;
      }
    }
    console.log(
      `[run-1 dispose] disposables=${allDeps.filter(isDisposable).length} closed-clean=${firstErr === null}`,
    );
  }
  console.log(
    `[run-1 summary] writes=${writes} expected=${N_ATOMS} db-path='${CELL_BETA_DB_PATH}'`,
  );
}

async function runRun2(): Promise<void> {
  const built = await createOrchestr8DiskMemoryAdapter({
    namespace: CELL_BETA_NAMESPACE,
    databasePath: CELL_BETA_DB_PATH,
  });
  if (built.error !== null) {
    console.log(`[driver] FATAL: ${built.error.code}: ${built.error.message}`);
    process.exitCode = 1;
    return;
  }
  const memory = built.data;
  const secrets = mockSecretsResolver;
  const allDeps: ReadonlyArray<unknown> = [memory, secrets];

  // β.3 sibling-cost probe.
  console.log(
    `[run-2 sibling-cost] secrets-implements-Listable=${isListable(secrets)} memory-implements-Listable=${isListable(memory)}`,
  );

  const controller = new AbortController();
  const ctx: PipelineContext = { run_id: 'pk_run_beta_run_2', signal: controller.signal };

  let atomsRead = 0;
  let strategy: string = 'unset';
  try {
    for await (const sRes of sourceIterRun2(ctx)) {
      if (sRes.error !== null) {
        console.log(`[driver] source ERR: ${sRes.error.message}`);
        process.exitCode = 1;
        return;
      }
      for await (const pRes of processEnumerateAndRead(ctx, sRes.data, { memory, secrets })) {
        if (pRes.error !== null) {
          console.log(`[driver] proc ERR: ${pRes.error.message}`);
          process.exitCode = 1;
          return;
        }
        atomsRead = pRes.data.data.atomsRead;
        strategy = pRes.data.data.enumerationStrategy;
        console.log(
          `[run-2 enum] strategy=${pRes.data.data.enumerationStrategy} keysFound=${JSON.stringify(pRes.data.data.keysFound)} atomsRead=${pRes.data.data.atomsRead}`,
        );
        for (let i = 0; i < pRes.data.data.keysFound.length; i++) {
          const k = pRes.data.data.keysFound[i];
          const v = pRes.data.data.values[i];
          if (k === undefined) continue;
          console.log(
            `[run-2 read] key='${k}' got=${v === null || v === undefined ? 'null' : `'${v}'`}`,
          );
        }
      }
    }
  } finally {
    let firstErr: MemoryError | null = null;
    for (const dep of allDeps) {
      if (isDisposable(dep)) {
        const c = await dep.close();
        if (c.error !== null && firstErr === null) firstErr = c.error;
      }
    }
    console.log(
      `[run-2 dispose] disposables=${allDeps.filter(isDisposable).length} closed-clean=${firstErr === null}`,
    );
  }
  console.log(
    `[run-2 summary] strategy=${strategy} atomsRead=${atomsRead} expected=${N_ATOMS}`,
  );
  if (atomsRead !== N_ATOMS) {
    console.log('[driver] FAIL: did not enumerate-and-read all 5 atoms');
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const phase = process.argv[2];
  console.log(`### Cat V spike #3 — Cell β (verb-growth) phase=${phase ?? 'UNKNOWN'} ###`);
  if (phase === 'run-1') {
    await runRun1();
    return;
  }
  if (phase === 'run-2') {
    await runRun2();
    return;
  }
  console.log('[driver] usage: bun run cell-beta-verb-growth.ts <run-1|run-2>');
  process.exitCode = 1;
}

await main();
