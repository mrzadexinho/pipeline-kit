// Cat IX spike #3 — TS Source-equivalent for LSP-style Content-Length framing.
// Emits 3 atoms, each as its OWN framed message:
//
//   Content-Length: <byte-count>\r\n
//   \r\n
//   <raw JSON bytes — exactly that many bytes>
//
// Three frames are concatenated on stdout (no trailing newline). Reuses the
// in-memory atom construction from ts/atom-emit-stream.ts verbatim — only the
// wire output changes (LSP frame instead of NDJSON line). DO NOT modify
// ts/atom-emit-stream.ts; this file is the comparison baseline's twin.

// --- Result<T, E> (ADR4 mirror) ---
type Ok<T> = { data: T; error: null };
type Err<E> = { data: null; error: E };
type Result<T, E> = Ok<T> | Err<E>;
const ok = <T>(data: T): Ok<T> => ({ data, error: null });

// --- Atom<T> envelope (spec-api-surface.md line 86) ---
interface Atom<T> {
  id: string;
  object: 'atom';
  created_at: string;
  metadata: Record<string, unknown>;
  data: T;
  source_id?: string;
  stage_id?: string;
  run_id?: string;
}

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

type WireErr = { type: string; code: string; message: string };

// --- Crockford ULID helper (deterministic-ish, spike-only) ---
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function fakeUlid(): string {
  const ts = Date.now().toString(2).padStart(48, '0').slice(0, 50);
  let tsPart = '';
  for (let i = 0; i < 10; i++) {
    const slice = ts.slice(i * 5, i * 5 + 5).padEnd(5, '0');
    tsPart += ULID_ALPHABET[parseInt(slice, 2)];
  }
  let randPart = '';
  for (let i = 0; i < 16; i++) randPart += ULID_ALPHABET[Math.floor(Math.random() * 32)];
  return tsPart + randPart;
}

const RUN_ID = `pk_run_${fakeUlid()}`;
const NOW_ISO = new Date().toISOString();
const ADVERSARIAL_ISO = '2026-05-08T24:00:00.000Z';

function makeAtom(label: string, data: Job, createdAt: string): Atom<Job> {
  return {
    id: `pk_atom_${fakeUlid()}`,
    object: 'atom',
    created_at: createdAt,
    metadata: { spike: 'cat-ix-day-3', emitter: 'ts/atom-emit-rpc.ts', case: label },
    data,
    source_id: 'pk_src_spike_emitter',
    run_id: RUN_ID,
  };
}

const happy: Job = {
  title: 'Senior Backend Engineer',
  company: 'Acme Corp',
  location: 'Remote (EU)',
  posted_at: '2026-05-01T09:00:00.000Z',
  salary_min: 120000,
  salary_max: 160000,
  remote: 'remote',
  tags: ['typescript', 'distributed-systems', 'kafka'],
};
const adversarial: Job = { ...happy, title: 'Staff Backend Engineer', tags: ['python', 'apis'] };
const inverted: Job = {
  title: 'Principal Engineer',
  company: 'Beta Inc',
  location: null,
  posted_at: null,
  salary_min: 200000,
  salary_max: 100000,
  remote: 'hybrid',
  tags: ['leadership', 'platform'],
};

const atoms: Atom<Job>[] = [
  makeAtom('happy', happy, NOW_ISO),
  makeAtom('adversarial-ts', adversarial, ADVERSARIAL_ISO),
  makeAtom('salary-inverted', inverted, NOW_ISO),
];

// One framed Result<Atom, E> per atom. Byte-length, not character-length —
// JSON.stringify outputs UTF-8-safe ASCII here, but the framing rule must
// always be in bytes for multi-byte payloads.
for (const a of atoms) {
  const env: Result<Atom<Job>, WireErr> = ok(a);
  const body = Buffer.from(JSON.stringify(env), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8');
  process.stdout.write(header);
  process.stdout.write(body);
}
