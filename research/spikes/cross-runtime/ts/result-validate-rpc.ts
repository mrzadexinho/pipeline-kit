// Cat IX spike #3 — TS sink for LSP-style framed Result<Atom, E>.
// Reads stdin to a single buffer, parses Content-Length-framed messages
// one at a time, classifies each OK/ERR/MALFORMED, and verifies the exact
// pattern is [OK, ERR(schema), ERR(business_rule)] across 3 frames.
// Exit 0 only on exact match — spike fails loud.

interface ResultMsg {
  data: unknown;
  error: { type: string; code: string; message: string } | null;
}

async function readStdinBytes(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

interface Classified {
  index: number;
  kind: 'ok' | 'err' | 'malformed';
  errType?: string;
  errCode?: string;
  atomId?: string;
  raw: string;
}

const HEADER_TERMINATOR = Buffer.from('\r\n\r\n', 'ascii');

interface Frame {
  body: Buffer;
  advance: number;
  headerText: string;
}

function nextFrame(buf: Buffer, offset: number): Frame | { error: string } | null {
  if (offset >= buf.length) return null;
  const term = buf.indexOf(HEADER_TERMINATOR, offset);
  if (term === -1) return { error: `no header terminator after offset ${offset}` };
  const headerText = buf.slice(offset, term).toString('ascii');
  const m = /content-length\s*:\s*(\d+)/i.exec(headerText);
  if (!m) return { error: `missing Content-Length in header block: ${JSON.stringify(headerText)}` };
  const n = parseInt(m[1], 10);
  const bodyStart = term + HEADER_TERMINATOR.length;
  const bodyEnd = bodyStart + n;
  if (bodyEnd > buf.length)
    return { error: `truncated body (need ${n} bytes, have ${buf.length - bodyStart})` };
  const body = buf.slice(bodyStart, bodyEnd);
  return { body, advance: bodyEnd - offset, headerText };
}

function classify(body: Buffer, index: number): Classified {
  const text = body.toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { index, kind: 'malformed', raw: text };
  }
  if (typeof parsed !== 'object' || parsed === null) return { index, kind: 'malformed', raw: text };
  const r = parsed as Partial<ResultMsg>;
  if (!('data' in r) || !('error' in r)) return { index, kind: 'malformed', raw: text };
  if (r.error !== null && r.error !== undefined) {
    return { index, kind: 'err', errType: r.error.type, errCode: r.error.code, raw: text };
  }
  const d = r.data as { id?: string } | null;
  return { index, kind: 'ok', atomId: d?.id, raw: text };
}

(async () => {
  const buf = await readStdinBytes();
  if (buf.length === 0) {
    process.stderr.write('result-validate-rpc: empty stdin\n');
    process.exit(2);
  }

  const classified: Classified[] = [];
  let offset = 0;
  let frameIdx = 0;
  while (offset < buf.length) {
    const f = nextFrame(buf, offset);
    if (f === null) break;
    if ('error' in f) {
      process.stderr.write(
        `result-validate-rpc: frame parse error at offset ${offset}: ${f.error}\n`,
      );
      for (const c of classified) process.stderr.write(`  prior frame ${c.index}: ${c.kind}\n`);
      process.exit(3);
    }
    frameIdx += 1;
    classified.push(classify(f.body, frameIdx));
    offset += f.advance;
  }

  process.stdout.write(`result-validate-rpc: read ${classified.length} frame(s)\n`);
  for (const c of classified) {
    if (c.kind === 'ok')
      process.stdout.write(`  frame ${c.index}: OK   atom=${c.atomId ?? '<no id>'}\n`);
    else if (c.kind === 'err')
      process.stdout.write(`  frame ${c.index}: ERR  type=${c.errType} code=${c.errCode}\n`);
    else process.stdout.write(`  frame ${c.index}: MALFORMED  raw=${c.raw.slice(0, 80)}...\n`);
  }

  const oks = classified.filter((c) => c.kind === 'ok');
  const errs = classified.filter((c) => c.kind === 'err');
  const expectedTotal = 3;
  if (classified.length !== expectedTotal) {
    process.stderr.write(
      `result-validate-rpc: expected ${expectedTotal} frames, got ${classified.length}\n`,
    );
    process.exit(4);
  }
  if (oks.length !== 1 || errs.length !== 2) {
    process.stderr.write(
      `result-validate-rpc: expected 1 OK + 2 ERR, got ${oks.length} OK + ${errs.length} ERR\n`,
    );
    process.exit(5);
  }
  if (classified[0].kind !== 'ok') {
    process.stderr.write(`result-validate-rpc: frame 1 must be OK\n`);
    process.exit(6);
  }
  if (classified[1].kind !== 'err' || classified[1].errType !== 'schema') {
    process.stderr.write(
      `result-validate-rpc: frame 2 must be ERR(schema), got ${classified[1].kind}/${classified[1].errType}\n`,
    );
    process.exit(7);
  }
  if (classified[2].kind !== 'err' || classified[2].errType !== 'business_rule') {
    process.stderr.write(
      `result-validate-rpc: frame 3 must be ERR(business_rule), got ${classified[2].kind}/${classified[2].errType}\n`,
    );
    process.exit(8);
  }

  process.stdout.write('result-validate-rpc: PATTERN OK — 1 OK + 2 ERR(schema, business_rule)\n');
  process.exit(0);
})();
