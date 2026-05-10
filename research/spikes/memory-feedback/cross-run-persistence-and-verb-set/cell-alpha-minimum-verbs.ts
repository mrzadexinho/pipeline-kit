// Cat V spike #3 — Cell α: minimum-verbs-hold-across-runs.
//
// Probes whether the spike-2 β contract (`MemoryAdapter = { read, write }`
// + opt-in `Disposable`) survives the cross-run durability boundary.
// 3 atoms written in Run-1; same composed keys read back in Run-2;
// then α.2 probe — Run-2 attempts re-write of an existing key, and
// observes (a) what the contract says happens and (b) what orchestr8
// physically does.
//
// Two `bun run` invocations bracket a process exit. The DB lives at
// `./.spike-3-data/cell-alpha.sqlite`. Persistence is achieved via
// orchestr8's autoSave (sql.js .export() on every store).
//
// Driver dispatches by argv[2]: 'run-1' | 'run-2'.
//
// Composed-key convention: `<spike-3-namespace>::<atom-id>`.
//   namespace = `pk-spike-3-cat-v-cell-alpha`
//   atom-ids  = `pk_atom_v_alpha_1` ... `_2` ... `_3`

import {
  createOrchestr8DiskMemoryAdapter,
  isDisposable,
  isListable,
  type MemoryAdapter,
  type MemoryError,
  type Result,
  ok,
  err,
} from './mock-orchestr8-disk-backend.ts';
import { mockSecretsResolver, type SecretsResolver } from './mock-secrets-resolver.ts';

// --- Cell-α config ---
const CELL_ALPHA_NAMESPACE = 'pk-spike-3-cat-v-cell-alpha';
const CELL_ALPHA_DB_PATH = './.spike-3-data/cell-alpha.sqlite';
const COMPOSED_KEY_SEPARATOR = '::';
const ATOM_IDS = ['pk_atom_v_alpha_1', 'pk_atom_v_alpha_2', 'pk_atom_v_alpha_3'] as const;
const RUN_1_VALUES: Readonly<Record<string, string>> = Object.freeze({
  pk_atom_v_alpha_1: 'value-from-run-1-atom-1',
  pk_atom_v_alpha_2: 'value-from-run-1-atom-2',
  pk_atom_v_alpha_3: 'value-from-run-1-atom-3',
});
const RE_WRITE_VALUE = 'value-rewritten-in-run-2';

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
  atomId: string;
  value: string;
}

// --- Source iter (Run-1: yields 3 atoms with values) ---
async function* sourceIterRun1(
  _ctx: PipelineContext,
): AsyncGenerator<Result<Atom<SourcePayload>, MemoryError>> {
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
      id: atomId,
      object: 'atom',
      created_at: new Date().toISOString(),
      metadata: { stage: 'source', run: 'run-1' },
      data: { atomId, value },
    });
  }
}

// --- Source iter (Run-2: yields 3 atoms; Source pre-knows the keys
//     since cell-α is the minimum-verbs cell — namespace enumeration is
//     the cell-β probe, not cell-α's). ---
async function* sourceIterRun2(
  _ctx: PipelineContext,
): AsyncGenerator<Result<Atom<SourcePayload>, MemoryError>> {
  for (const atomId of ATOM_IDS) {
    yield ok({
      id: atomId,
      object: 'atom',
      created_at: new Date().toISOString(),
      metadata: { stage: 'source', run: 'run-2' },
      data: { atomId, value: '' /* unused; Run-2 reads */ },
    });
  }
}

// --- composedKey helper ---
function composedKey(atomId: string): string {
  return `${CELL_ALPHA_NAMESPACE}${COMPOSED_KEY_SEPARATOR}${atomId}`;
}

// --- Process: Run-1 writes; Run-2 reads ---
async function* processWrite(
  ctx: PipelineContext,
  input: Atom<SourcePayload>,
  deps: { memory: MemoryAdapter; secrets: SecretsResolver },
): AsyncGenerator<Result<Atom<{ writtenKey: string; writtenValue: string }>, MemoryError>> {
  if (ctx.signal.aborted) {
    yield err({ type: 'memory_error', code: 'aborted', message: 'aborted before write' });
    return;
  }
  const key = composedKey(input.data.atomId);
  const w = await deps.memory.write(key, input.data.value);
  if (w.error !== null) {
    yield err(w.error);
    return;
  }
  // Sibling-touch: lifecycle-free secrets resolver is consumed verbatim.
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
    id: `pk_atom_v_alpha_proc_W_${input.data.atomId}`,
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: { stage: 'process', verb: 'write', composedKey: key },
    data: { writtenKey: key, writtenValue: input.data.value },
  });
}

async function* processRead(
  ctx: PipelineContext,
  input: Atom<SourcePayload>,
  deps: { memory: MemoryAdapter; secrets: SecretsResolver },
): AsyncGenerator<
  Result<Atom<{ readKey: string; readValue: string | null }>, MemoryError>
> {
  if (ctx.signal.aborted) {
    yield err({ type: 'memory_error', code: 'aborted', message: 'aborted before read' });
    return;
  }
  const key = composedKey(input.data.atomId);
  const r = await deps.memory.read(key);
  if (r.error !== null) {
    yield err(r.error);
    return;
  }
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
    id: `pk_atom_v_alpha_proc_R_${input.data.atomId}`,
    object: 'atom',
    created_at: new Date().toISOString(),
    metadata: { stage: 'process', verb: 'read', composedKey: key },
    data: { readKey: key, readValue: r.data },
  });
}

// --- Drivers ---
async function runRun1(): Promise<void> {
  const built = await createOrchestr8DiskMemoryAdapter({
    namespace: CELL_ALPHA_NAMESPACE,
    databasePath: CELL_ALPHA_DB_PATH,
  });
  if (built.error !== null) {
    console.log(`[driver] FATAL: ${built.error.code}: ${built.error.message}`);
    process.exitCode = 1;
    return;
  }
  const memory = built.data;
  const secrets = mockSecretsResolver;

  const controller = new AbortController();
  const ctx: PipelineContext = { run_id: 'pk_run_alpha_run_1', signal: controller.signal };
  const allDeps: ReadonlyArray<unknown> = [memory, secrets];

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
  console.log(`[run-1 summary] writes=${writes} expected=3 db-path='${CELL_ALPHA_DB_PATH}'`);
}

async function runRun2(): Promise<void> {
  const built = await createOrchestr8DiskMemoryAdapter({
    namespace: CELL_ALPHA_NAMESPACE,
    databasePath: CELL_ALPHA_DB_PATH,
  });
  if (built.error !== null) {
    console.log(`[driver] FATAL: ${built.error.code}: ${built.error.message}`);
    process.exitCode = 1;
    return;
  }
  const memory = built.data;
  const secrets = mockSecretsResolver;

  const controller = new AbortController();
  const ctx: PipelineContext = { run_id: 'pk_run_alpha_run_2', signal: controller.signal };
  const allDeps: ReadonlyArray<unknown> = [memory, secrets];

  let reads = 0;
  let roundtripsHeld = 0;
  let firstReadKey: string | null = null;
  let firstReadValueRun1: string | null = null;
  try {
    for await (const sRes of sourceIterRun2(ctx)) {
      if (sRes.error !== null) {
        console.log(`[driver] source ERR: ${sRes.error.message}`);
        process.exitCode = 1;
        return;
      }
      for await (const pRes of processRead(ctx, sRes.data, { memory, secrets })) {
        if (pRes.error !== null) {
          console.log(`[driver] read ERR: ${pRes.error.message}`);
          process.exitCode = 1;
          return;
        }
        reads += 1;
        const expected = RUN_1_VALUES[sRes.data.data.atomId];
        const got = pRes.data.data.readValue;
        const heldStr = expected !== undefined && got === expected ? 'true' : 'false';
        if (heldStr === 'true') roundtripsHeld += 1;
        console.log(
          `[run-2 read] key='${pRes.data.data.readKey}' got=${got === null ? 'null' : `'${got}'`} expected='${expected ?? 'MISSING'}' held=${heldStr}`,
        );
        if (firstReadKey === null) {
          firstReadKey = pRes.data.data.readKey;
          firstReadValueRun1 = expected ?? null;
        }
      }
    }

    // === α.2 Key-reuse probe =================================================
    // Re-write the FIRST atom's existing key with a NEW value.
    // What does the 2-verb contract communicate? Empirically:
    //   - orchestr8 SQLiteBackend.store() raw-INSERTs a fresh PRIMARY KEY (id),
    //     so duplicate-(key,namespace) rows accumulate.
    //   - retrieve() does LIMIT 1 — observed value depends on row order,
    //     not last-write-wins.
    //   - query({prefix}) ORDER BY updated_at DESC sees N rows for one key.
    // Surface as friction; do NOT mutate the contract.
    if (firstReadKey !== null) {
      console.log(`[run-2 alpha.2 probe] re-writing key='${firstReadKey}' newValue='${RE_WRITE_VALUE}'`);
      const reWrite = await memory.write(firstReadKey, RE_WRITE_VALUE);
      console.log(
        `[run-2 alpha.2 result] write-error=${reWrite.error === null ? 'none' : reWrite.error.code}`,
      );
      const reRead = await memory.read(firstReadKey);
      const observedValue = reRead.error === null ? reRead.data : `<err:${reRead.error.code}>`;
      console.log(
        `[run-2 alpha.2 result] re-read-after-rewrite key='${firstReadKey}' observed=${observedValue === null ? 'null' : `'${observedValue}'`} run1Value='${firstReadValueRun1 ?? 'null'}'`,
      );
      // Probe Listable too — does query reveal duplicate-key rows?
      if (isListable(memory)) {
        const lst = await memory.list(CELL_ALPHA_NAMESPACE);
        if (lst.error === null) {
          const occurrences = lst.data.filter((k) => k === firstReadKey).length;
          console.log(
            `[run-2 alpha.2 listable-probe] unique-keys-after-rewrite=${lst.data.length} firstKeyOccurrencesInList=${occurrences} (list dedupes; raw-row count would be more)`,
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
    `[run-2 summary] reads=${reads} expected=3 roundtripsHeld=${roundtripsHeld} expected-held=3`,
  );
  if (roundtripsHeld !== 3) {
    console.log('[driver] FAIL: cross-run R+W did not hold for all 3 atoms');
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const phase = process.argv[2];
  console.log(`### Cat V spike #3 — Cell α (minimum-verbs) phase=${phase ?? 'UNKNOWN'} ###`);
  if (phase === 'run-1') {
    await runRun1();
    return;
  }
  if (phase === 'run-2') {
    await runRun2();
    return;
  }
  console.log("[driver] usage: bun run cell-alpha-minimum-verbs.ts <run-1|run-2>");
  process.exitCode = 1;
}

await main();
