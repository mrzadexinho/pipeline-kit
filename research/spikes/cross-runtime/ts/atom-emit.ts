// Cat IX spike #1 — TS Source-equivalent.
// Builds 1 fake Atom<Job>, wraps it in Result<Atom[], Error>, prints JSON to stdout.
// Self-contained: no @idriszade/* imports. Mirrors Atom<T> + Result<T,E> shapes inline.

// --- Result<T, E> (ADR4 mirror) ---
type Ok<T> = { data: T; error: null };
type Err<E> = { data: null; error: E };
type Result<T, E> = Ok<T> | Err<E>;

const ok = <T>(data: T): Ok<T> => ({ data, error: null });

// --- Atom<T> envelope (spec-api-surface.md line 86) ---
interface Atom<T> {
  id: string; // pk_atom_<ulid>
  object: 'atom';
  created_at: string; // ISO 8601
  metadata: Record<string, unknown>;
  data: T;
  source_id?: string;
  stage_id?: string;
  run_id?: string;
}

// --- Synthetic Job payload schema (spike-only) ---
type RemoteMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';
interface Job {
  title: string;
  company: string;
  location: string | null;
  posted_at: string | null;
  salary_min: number | null;
  salary_max: number | null;
  remote: RemoteMode;
  tags: string[];
}

// --- Crockford ULID helper (just enough for spike) ---
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function fakeUlid(): string {
  // Deterministic-ish: timestamp(10) + random(16). Crockford alphabet only.
  const ts = Date.now().toString(2).padStart(48, '0').slice(0, 50);
  // Pack 50 bits → 10 chars (5 bits each)
  let tsPart = '';
  for (let i = 0; i < 10; i++) {
    const slice = ts.slice(i * 5, i * 5 + 5).padEnd(5, '0');
    tsPart += ULID_ALPHABET[parseInt(slice, 2)];
  }
  let randPart = '';
  for (let i = 0; i < 16; i++) {
    randPart += ULID_ALPHABET[Math.floor(Math.random() * 32)];
  }
  return tsPart + randPart;
}

// --- Build the atom ---
const atom: Atom<Job> = {
  id: `pk_atom_${fakeUlid()}`,
  object: 'atom',
  created_at: new Date().toISOString(),
  metadata: { spike: 'cat-ix-day-1', emitter: 'ts/atom-emit.ts' },
  data: {
    title: 'Senior Backend Engineer',
    company: 'Acme Corp',
    location: 'Remote (EU)',
    posted_at: '2026-05-01T09:00:00.000Z',
    salary_min: 120000,
    salary_max: 160000,
    remote: 'remote',
    tags: ['typescript', 'distributed-systems', 'kafka'],
  },
  source_id: 'pk_src_spike_emitter',
  run_id: `pk_run_${fakeUlid()}`,
};

const result: Result<Atom<Job>[], { type: string; code: string; message: string }> = ok([atom]);

// Single-line JSON to stdout — pipe consumer reads one line.
process.stdout.write(`${JSON.stringify(result)}\n`);
