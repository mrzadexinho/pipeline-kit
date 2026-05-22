/**
 * Tests for `pk gen-py-schema` (Unit 2 / ADR IX-2).
 *
 * Tests requiring `uv` + `datamodel-code-generator` are gated by HAS_UV env var
 * or runtime detection. Skipped gracefully when uv is absent.
 */

// execSync is used ONLY for `uv --version` detection (fixed string, no user input).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { genPySchemaCommand } from '../src/commands/gen-py-schema.js';

// ---------------------------------------------------------------------------
// Environment detection — must run at module load time so it.skipIf() sees it
// ---------------------------------------------------------------------------

/** Candidate uv binary paths — vitest workers may have a stripped PATH. */
const UV_CANDIDATES = [
  'uv',
  // Real uv installed by `astral.sh/uv` install script
  `${process.env.HOME ?? '/root'}/.local/bin/uv`,
  // Homebrew
  '/opt/homebrew/bin/uv',
  '/usr/local/bin/uv',
];

function detectUv(): boolean {
  for (const bin of UV_CANDIDATES) {
    try {
      // Fixed args — constant binary, no user input.
      execFileSync(bin, ['--version'], { stdio: 'pipe' });
      return true;
    } catch {
      // try next
    }
  }
  return false;
}

// Evaluated synchronously at module load — before it.skipIf() checks the value
const uvAvailable: boolean = !!process.env.HAS_UV || detectUv();

const FIXTURE_DIR = resolve(__dirname, '..', 'fixtures', 'wire-schemas');
const SNAPSHOT_PATH = join(FIXTURE_DIR, '__snapshot__', 'sample-atom.py');
const SAMPLE_ATOM_TS = join(FIXTURE_DIR, 'sample-atom.ts');

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  process.exitCode = undefined;
  tmpDir = await mkdtemp(join(tmpdir(), 'pk-gen-py-test-'));
});

afterEach(async () => {
  process.exitCode = undefined;
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a temporary .ts schema file and return its path. */
async function writeTsSchema(content: string, name = 'schema.ts'): Promise<string> {
  const path = join(tmpDir, name);
  await writeFile(path, content, 'utf8');
  return path;
}

// ---------------------------------------------------------------------------
// AC#1 — produces a .py file that is importable (uv-gated)
// ---------------------------------------------------------------------------

describe('gen-py-schema — AC#1: produces a valid .py file', () => {
  it.skipIf(!uvAvailable)(
    'generates a .py that compiles via python -m py_compile',
    async () => {
      const outFile = join(tmpDir, 'out.py');

      const code = await genPySchemaCommand({
        inFile: SAMPLE_ATOM_TS,
        outFile,
        check: false,
        strictFeatures: true,
      });

      expect(code).toBe(0);
      expect(existsSync(outFile)).toBe(true);

      const content = await readFile(outFile, 'utf8');
      expect(content.length).toBeGreaterThan(0);
      // Should contain Pydantic BaseModel
      expect(content).toContain('BaseModel');
      // Should contain the Atom class
      expect(content).toMatch(/class Atom/);

      // Compile check via uv run python -m py_compile (fixed args, no user input)
      execFileSync('uv', ['run', 'python', '-m', 'py_compile', outFile], { stdio: 'pipe' });
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// AC#2 — --check exits 0 against committed snapshot (uv-gated)
// ---------------------------------------------------------------------------

describe('gen-py-schema — AC#2: --check passes on committed snapshot', () => {
  it.skipIf(!uvAvailable || !existsSync(SNAPSHOT_PATH))(
    '--check exits 0 when snapshot matches',
    async () => {
      const code = await genPySchemaCommand({
        inFile: SAMPLE_ATOM_TS,
        outFile: SNAPSHOT_PATH,
        check: true,
        strictFeatures: true,
      });

      expect(code).toBe(0);
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// AC#3 — --check exits non-zero on drift (uv-gated)
// ---------------------------------------------------------------------------

describe('gen-py-schema — AC#3: --check detects drift', () => {
  it.skipIf(!uvAvailable || !existsSync(SNAPSHOT_PATH))(
    '--check exits 1 when snapshot has been mutated',
    async () => {
      // Copy snapshot to tmp dir and mutate it
      const originalContent = await readFile(SNAPSHOT_PATH, 'utf8');
      const driftPath = join(tmpDir, 'drifted.py');
      await writeFile(driftPath, `${originalContent}\n# drift injected by test\n`, 'utf8');

      const code = await genPySchemaCommand({
        inFile: SAMPLE_ATOM_TS,
        outFile: driftPath,
        check: true,
        strictFeatures: true,
      });

      expect(code).toBe(1);

      // Verify original snapshot is untouched
      const afterContent = await readFile(SNAPSHOT_PATH, 'utf8');
      expect(afterContent).toBe(originalContent);
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// AC#4 — feature-gap-check: .refine triggers exit 1 (no uv required)
// ---------------------------------------------------------------------------

describe('gen-py-schema — AC#4: feature-gap-check rejects .refine', () => {
  it('exits 1 when schema has .refine and strictFeatures=true', async () => {
    const tsFile = await writeTsSchema(`
import { z } from 'zod';
export const Strict = z.object({
  name: z.string().refine((v) => v.length > 0, { message: 'must be non-empty' }),
});
`);

    const stderrLines: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      stderrLines.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    const code = await genPySchemaCommand({
      inFile: tsFile,
      outFile: join(tmpDir, 'should-not-create.py'),
      check: false,
      strictFeatures: true,
    });

    process.stderr.write = origStderr;

    // Must exit non-zero (rule: .refine triggers feature-gap in strict mode)
    expect(code).toBe(1);
    // Stderr must mention 'refine' feature gap
    const allStderr = stderrLines.join('');
    expect(allStderr).toMatch(/feature.gap|refine/i);
    // Output file must NOT have been created
    expect(existsSync(join(tmpDir, 'should-not-create.py'))).toBe(false);
  }, 30_000);

  it('--no-strict-features skips gap check (does not reject on .refine)', async () => {
    const tsFile = await writeTsSchema(`
import { z } from 'zod';
export const Lenient = z.object({
  name: z.string().refine((v) => v.length > 0),
});
`);

    const stderrLines: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      stderrLines.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    const code = await genPySchemaCommand({
      inFile: tsFile,
      outFile: join(tmpDir, 'lenient.py'),
      check: false,
      strictFeatures: false,
    });

    process.stderr.write = origStderr;

    // Should NOT emit feature-gap error (gap check was skipped)
    const allStderr = stderrLines.join('');
    expect(allStderr).not.toMatch(/feature.gap/i);
    // Code may be 0 (codegen ran) or non-zero (uv unavailable) — either is acceptable
    // as long as we didn't reject on the feature-gap specifically
    expect(typeof code).toBe('number');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// AC#5 — --out - writes to stdout (uv-gated)
// ---------------------------------------------------------------------------

describe('gen-py-schema — AC#5: --out - writes to stdout', () => {
  it.skipIf(!uvAvailable)(
    '--out - streams Pydantic source to stdout',
    async () => {
      const stdoutChunks: string[] = [];
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = ((chunk: string) => {
        stdoutChunks.push(chunk);
        return true;
      }) as typeof process.stdout.write;

      const code = await genPySchemaCommand({
        inFile: SAMPLE_ATOM_TS,
        outFile: '-',
        check: false,
        strictFeatures: true,
      });

      process.stdout.write = origWrite;

      expect(code).toBe(0);
      const captured = stdoutChunks.join('');
      // datamodel-codegen header comment
      expect(captured).toMatch(/# generated by datamodel-codegen/i);
      // Pydantic BaseModel import
      expect(captured).toContain('BaseModel');
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// AC#6 — CLI --help includes gen-py-schema entry
// ---------------------------------------------------------------------------

describe('gen-py-schema — AC#6: --help includes gen-py-schema', () => {
  it('main() USAGE string contains gen-py-schema', async () => {
    const { main } = await import('../src/cli.js');

    const logLines: string[] = [];
    const origLog = console.log;
    console.log = (s: unknown) => {
      logLines.push(String(s));
    };

    await main(['--help']);

    console.log = origLog;

    const output = logLines.join('\n');
    expect(output).toContain('gen-py-schema');
  });

  it('gen-py-schema --help flag prints command-specific help', async () => {
    const { main } = await import('../src/cli.js');

    const logLines: string[] = [];
    const origLog = console.log;
    console.log = (s: unknown) => {
      logLines.push(String(s));
    };

    await main(['gen-py-schema', '--help']);

    console.log = origLog;

    const output = logLines.join('\n');
    expect(output).toContain('--in');
    expect(output).toContain('--out');
    expect(output).toContain('--check');
  });

  it('gen-py-schema errors when --in or --out is missing', async () => {
    const { main } = await import('../src/cli.js');

    const errLines: string[] = [];
    const origErr = console.error;
    console.error = (s: unknown) => {
      errLines.push(String(s));
    };

    process.exitCode = undefined;
    await main(['gen-py-schema', '--in', 'foo.ts']); // missing --out

    console.error = origErr;

    expect(process.exitCode).toBe(1);
    expect(errLines.join('\n')).toContain('gen-py-schema');
    process.exitCode = undefined;
  });
});

// ---------------------------------------------------------------------------
// Snapshot file existence check (always runs, no uv needed)
// ---------------------------------------------------------------------------

describe('gen-py-schema — snapshot file', () => {
  it('committed snapshot file exists at the expected path', () => {
    expect(existsSync(SNAPSHOT_PATH)).toBe(true);
  });

  it('committed snapshot begins with the datamodel-codegen header', async () => {
    if (!existsSync(SNAPSHOT_PATH)) return;
    const content = await readFile(SNAPSHOT_PATH, 'utf8');
    expect(content.startsWith('# generated by datamodel-codegen')).toBe(true);
  });
});
