// Cat IX spike #2 — TS sink for NDJSON streaming Result<Atom, E>.
// Reads N lines, classifies each OK/ERR, verifies the expected pattern is
// exactly 1 OK + 2 ERR with type codes ["schema", "business_rule"] across
// the two ERR lines. Exit 0 only on exact match — spike fails loud.
//
// We deliberately re-derive the validator inline (a thin shape check) rather
// than importing day-1's ts/validate.ts: the comparison baseline is the
// hand-walk gap between TS and Python, and importing day-1's validator would
// muddy that. The shape check below is intentionally minimal.

interface ResultLine {
  data: unknown;
  error: { type: string; code: string; message: string } | null;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

interface Classified {
  index: number;
  kind: 'ok' | 'err' | 'malformed';
  errType?: string;
  errCode?: string;
  atomId?: string;
  raw: string;
}

function classify(line: string, index: number): Classified {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { index, kind: 'malformed', raw: line };
  }
  if (typeof parsed !== 'object' || parsed === null) return { index, kind: 'malformed', raw: line };
  const r = parsed as Partial<ResultLine>;
  if (!('data' in r) || !('error' in r)) return { index, kind: 'malformed', raw: line };
  if (r.error !== null && r.error !== undefined) {
    return { index, kind: 'err', errType: r.error.type, errCode: r.error.code, raw: line };
  }
  const d = r.data as { id?: string } | null;
  return { index, kind: 'ok', atomId: d?.id, raw: line };
}

(async () => {
  const raw = (await readStdin()).trim();
  if (!raw) {
    process.stderr.write('result-validate-stream: empty stdin\n');
    process.exit(2);
  }
  const lines = raw.split('\n').filter((l) => l.length > 0);
  const classified = lines.map((l, i) => classify(l, i + 1));

  // Diagnostics first — always print, even on success, to make findings reproducible.
  process.stdout.write(`result-validate-stream: read ${classified.length} line(s)\n`);
  for (const c of classified) {
    if (c.kind === 'ok') {
      process.stdout.write(`  line ${c.index}: OK   atom=${c.atomId ?? '<no id>'}\n`);
    } else if (c.kind === 'err') {
      process.stdout.write(`  line ${c.index}: ERR  type=${c.errType} code=${c.errCode}\n`);
    } else {
      process.stdout.write(`  line ${c.index}: MALFORMED  raw=${c.raw.slice(0, 80)}...\n`);
    }
  }

  const malformed = classified.filter((c) => c.kind === 'malformed');
  if (malformed.length > 0) {
    process.stderr.write(`result-validate-stream: ${malformed.length} malformed line(s) — framing broken\n`);
    process.exit(3);
  }

  const oks = classified.filter((c) => c.kind === 'ok');
  const errs = classified.filter((c) => c.kind === 'err');

  // Expected pattern: 1 OK + 2 ERR. Order: ok, err(schema), err(business_rule).
  const expectedTotal = 3;
  if (classified.length !== expectedTotal) {
    process.stderr.write(
      `result-validate-stream: expected ${expectedTotal} lines, got ${classified.length}\n`,
    );
    process.exit(4);
  }
  if (oks.length !== 1 || errs.length !== 2) {
    process.stderr.write(
      `result-validate-stream: expected 1 OK + 2 ERR, got ${oks.length} OK + ${errs.length} ERR\n`,
    );
    process.exit(5);
  }

  // Position check: line 1 OK, line 2 ERR(schema), line 3 ERR(business_rule).
  // This proves mid-stream errors do NOT halt downstream processing
  // (spike question D).
  if (classified[0].kind !== 'ok') {
    process.stderr.write(`result-validate-stream: line 1 must be OK (was ${classified[0].kind})\n`);
    process.exit(6);
  }
  if (classified[1].kind !== 'err' || classified[1].errType !== 'schema') {
    process.stderr.write(
      `result-validate-stream: line 2 must be ERR(schema), got ${classified[1].kind}/${classified[1].errType}\n`,
    );
    process.exit(7);
  }
  if (classified[2].kind !== 'err' || classified[2].errType !== 'business_rule') {
    process.stderr.write(
      `result-validate-stream: line 3 must be ERR(business_rule), got ${classified[2].kind}/${classified[2].errType}\n`,
    );
    process.exit(8);
  }

  process.stdout.write('result-validate-stream: PATTERN OK — 1 OK + 2 ERR(schema, business_rule)\n');
  process.exit(0);
})();
