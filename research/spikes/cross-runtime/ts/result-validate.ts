// Cat IX spike #1 — TS sink: read JSON Result<Atom[], E> from stdin, validate, exit code.
import { type ValidationError, validateAtom } from './validate.ts';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

(async () => {
  const raw = (await readStdin()).trim();
  if (!raw) {
    process.stderr.write('result-validate: empty stdin\n');
    process.exit(2);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`result-validate: JSON parse error: ${(e as Error).message}\n`);
    process.exit(3);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    process.stderr.write('result-validate: top-level not object\n');
    process.exit(4);
  }
  const r = parsed as { data: unknown; error: unknown };
  if (!('data' in r) || !('error' in r)) {
    process.stderr.write('result-validate: missing Result discriminants {data,error}\n');
    process.exit(5);
  }
  if (r.error !== null) {
    process.stderr.write(`result-validate: pipeline returned error: ${JSON.stringify(r.error)}\n`);
    process.exit(6);
  }
  if (!Array.isArray(r.data)) {
    process.stderr.write('result-validate: data is not array\n');
    process.exit(7);
  }
  const allErrs: ValidationError[] = [];
  r.data.forEach((atom, i) => {
    const errs = validateAtom(atom, `$.data[${i}]`);
    allErrs.push(...errs);
  });
  if (allErrs.length > 0) {
    process.stderr.write(
      `result-validate: validation failed:\n${JSON.stringify(allErrs, null, 2)}\n`,
    );
    process.exit(8);
  }
  process.stdout.write(`result-validate: OK — ${r.data.length} atom(s) validated round-trip\n`);
  // Echo the validated atom IDs so run.sh can show the round-trip preserved them.
  for (const a of r.data as Array<{ id: string; data: { title: string } }>) {
    process.stdout.write(`  - ${a.id}  title="${a.data.title}"\n`);
  }
  process.exit(0);
})();
