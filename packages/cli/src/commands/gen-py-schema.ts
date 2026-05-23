/**
 * `pk gen-py-schema` — Zod → JSON Schema → Pydantic v2 codegen.
 *
 * ADR IX-2: Build-time codegen of Pydantic v2 models from Zod schemas via a
 * JSON Schema Draft 2020-12 intermediate. The TypeScript schema file is loaded
 * in a child process via `tsx` (available at `node_modules/.bin/tsx`), so plain
 * `.ts` source files are supported without a pre-build step.
 *
 * Requires on PATH: `uv` (https://astral.sh/uv). `tsx` is resolved from the
 * workspace node_modules; falls back to PATH if not found there.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { runDatamodelCodegen } from '../lib/datamodel-codegen.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenPySchemaArgs {
  /** Path to a TS file that exports named Zod schemas. */
  inFile: string;
  /** Output path for generated `.py`; `'-'` for stdout. */
  outFile: string;
  /**
   * In check mode, compare codegen output against the existing file and
   * exit non-zero on drift without writing. Default: false.
   */
  check: boolean;
  /**
   * Reject Zod features without JSON Schema equivalents
   * (.refine, .transform, z.preprocess, .pipe).
   * Default: true (strict).
   */
  strictFeatures: boolean;
}

// ---------------------------------------------------------------------------
// tsx binary resolution
// ---------------------------------------------------------------------------

function resolveTsx(): string {
  const fromModules = resolve(process.cwd(), 'node_modules/.bin/tsx');
  return existsSync(fromModules) ? fromModules : 'tsx';
}

// ---------------------------------------------------------------------------
// Loader — spawn tsx to extract Zod schemas as JSON Schemas from a TS file
// ---------------------------------------------------------------------------

type SchemaMap = Record<string, unknown>;

/**
 * Spawn `tsx --eval <loaderScript>` to import the user's TS file and extract
 * all exported Zod schema instances, returning their JSON Schemas as a map.
 *
 * tsx CJS interop note: ESM named exports sometimes appear under `mod.default`
 * when loaded from a CJS context (the tsx --eval context). We handle both
 * layouts — spreading `mod` and merging `mod.default` when it is a plain object.
 */
async function loadSchemasAsJsonSchema(tsFile: string): Promise<SchemaMap> {
  const absolutePath = resolve(tsFile);

  // Inline loader: imported inside the tsx subprocess — no CLI source import needed.
  const loaderScript = `
import { resolve } from 'node:path';
import { z } from 'zod';
const filePath = ${JSON.stringify(absolutePath)};
(async () => {
  const mod = await import(filePath);
  const allExports = { ...mod };
  if (mod.default && typeof mod.default === 'object' && !Array.isArray(mod.default)) {
    Object.assign(allExports, mod.default);
  }
  delete allExports.default;
  delete allExports['module.exports'];

  const result = {};
  for (const [k, v] of Object.entries(allExports)) {
    if (v && typeof v === 'object' && typeof v._zod?.def?.type === 'string') {
      try {
        result[k] = z.toJSONSchema(v, {
          target: 'draft-2020-12',
          unrepresentable: 'any',
          reused: 'ref',
          cycles: 'ref',
        });
      } catch (e) {
        process.stderr.write('pk gen-py-schema: warning: cannot convert ' + k + ': ' + String(e) + '\\n');
      }
    }
  }
  process.stdout.write(JSON.stringify(result));
})().catch((e) => { process.stderr.write(String(e) + '\\n'); process.exit(1); });
`;

  const { stdout, stderr } = await execFileAsync(resolveTsx(), ['--eval', loaderScript], {
    timeout: 60_000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });

  if (stderr.trim()) process.stderr.write(stderr);

  if (!stdout.trim()) {
    throw new Error(
      `no Zod schemas found in '${tsFile}'.\n` +
        'Ensure the file has named exports of Zod schema instances (e.g. export const Atom = z.object(…)).',
    );
  }

  return JSON.parse(stdout) as SchemaMap;
}

// ---------------------------------------------------------------------------
// Feature gap detection via tsx subprocess
// ---------------------------------------------------------------------------

interface GapResult {
  path: string;
  feature: string;
  hint: string;
}

/**
 * Load the TS file in a child process and detect Zod features without JSON
 * Schema equivalents by inspecting Zod's internal def structure directly.
 */
async function detectFeatureGapsFromFile(tsFile: string): Promise<GapResult[]> {
  const absolutePath = resolve(tsFile);

  // Inline gap-detection logic to avoid importing CLI source from child process.
  const loaderScript = `
import { resolve } from 'node:path';
const filePath = ${JSON.stringify(absolutePath)};
(async () => {
  const mod = await import(filePath);
  const allExports = { ...mod };
  if (mod.default && typeof mod.default === 'object' && !Array.isArray(mod.default)) {
    Object.assign(allExports, mod.default);
  }
  delete allExports.default;
  delete allExports['module.exports'];

  function getDef(s) { return s?._zod?.def ?? s?._def ?? {}; }
  function getType(s) { const d = getDef(s); return typeof d.type === 'string' ? d.type : ''; }

  function collect(schema, path, gaps) {
    const type = getType(schema);
    const def = getDef(schema);

    // refine: custom check entries in the checks array
    const checks = Array.isArray(def.checks) ? def.checks : [];
    for (const c of checks) {
      if ((c?.type ?? c?.def?.type) === 'custom') {
        gaps.push({ path, feature: 'refine', hint: 'Remove .refine() at \\'' + path + '\\' — use a built-in Zod check or validate in a Process stage.' });
      }
    }

    if (type === 'pipe') {
      const inType = getType(def.in);
      const outType = getType(def.out);
      if (inType === 'transform') {
        gaps.push({ path, feature: 'preprocess', hint: 'Remove z.preprocess() at \\'' + path + '\\' — coerce at the Process boundary instead.' });
        if (def.out) collect(def.out, path, gaps);
      } else if (outType === 'transform') {
        gaps.push({ path, feature: 'transform', hint: 'Remove .transform() at \\'' + path + '\\' — transformations are opaque to JSON Schema; move to Process.' });
        if (def.in) collect(def.in, path, gaps);
      } else {
        gaps.push({ path, feature: 'pipeline', hint: 'Remove .pipe() at \\'' + path + '\\' — use sequential Process stages.' });
        if (def.in) collect(def.in, path + '.(pipe.in)', gaps);
        if (def.out) collect(def.out, path + '.(pipe.out)', gaps);
      }
      return;
    }
    if (type === 'object' && def.shape) {
      for (const [f, fs] of Object.entries(def.shape)) collect(fs, path + '.' + f, gaps);
      return;
    }
    if (type === 'array' && def.element) { collect(def.element, path + '[]', gaps); return; }
    if ((type === 'union') && Array.isArray(def.options)) {
      def.options.forEach((o, i) => collect(o, path + '[' + i + ']', gaps)); return;
    }
    if (type === 'optional' || type === 'nullable' || type === 'nonoptional') {
      if (def.innerType) { collect(def.innerType, path, gaps); return; }
    }
    if ((type === 'default' || type === 'catch' || type === 'readonly' || type === 'prefault') && (def.innerType ?? def.schema)) {
      collect(def.innerType ?? def.schema, path, gaps); return;
    }
    if (type === 'intersection') {
      if (def.left) collect(def.left, path + '.(left)', gaps);
      if (def.right) collect(def.right, path + '.(right)', gaps);
      return;
    }
    if (type === 'tuple' && Array.isArray(def.items)) {
      def.items.forEach((it, i) => collect(it, path + '[' + i + ']', gaps)); return;
    }
    if (type === 'record' && def.valueSchema) { collect(def.valueSchema, path + '[*]', gaps); return; }
  }

  const gaps = [];
  for (const [name, schema] of Object.entries(allExports)) {
    if (schema && typeof schema === 'object' && typeof schema._zod?.def?.type === 'string') {
      collect(schema, name, gaps);
    }
  }
  process.stdout.write(JSON.stringify(gaps));
})().catch((e) => { process.stderr.write(String(e) + '\\n'); process.exit(1); });
`;

  try {
    const { stdout, stderr } = await execFileAsync(resolveTsx(), ['--eval', loaderScript], {
      timeout: 30_000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    if (stderr.trim()) process.stderr.write(stderr);
    if (!stdout.trim()) return [];
    return JSON.parse(stdout) as GapResult[];
  } catch {
    return []; // gap detection is best-effort; don't block codegen
  }
}

// ---------------------------------------------------------------------------
// Comparison normalisation
// ---------------------------------------------------------------------------

/**
 * Strip the datamodel-codegen timestamp comment line so that `--check`
 * comparisons are stable across runs. The timestamp is the only line that
 * changes between regenerations of the same schema.
 *
 * Strips lines matching:  `#   timestamp: <ISO-8601>`
 */
function normalizeForComparison(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^#\s+timestamp:\s+\S/.test(line))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * Execute `pk gen-py-schema`. Returns the process exit code (0 = success).
 */
export async function genPySchemaCommand(args: GenPySchemaArgs): Promise<number> {
  const { inFile, outFile, check, strictFeatures } = args;

  // 1. Feature-gap check (strict mode, runs before codegen)
  if (strictFeatures) {
    const gaps = await detectFeatureGapsFromFile(inFile);
    if (gaps.length > 0) {
      for (const gap of gaps) {
        process.stderr.write(
          `pk gen-py-schema [feature-gap] ${gap.feature} at '${gap.path}': ${gap.hint}\n`,
        );
      }
      process.stderr.write(
        `pk gen-py-schema: ${gaps.length} feature gap(s) detected. Use --no-strict-features to allow.\n`,
      );
      return 1;
    }
  }

  // 2. Load schemas and emit combined JSON Schema document
  let schemaMap: SchemaMap;
  try {
    schemaMap = await loadSchemasAsJsonSchema(inFile);
  } catch (err: unknown) {
    process.stderr.write(`pk gen-py-schema: failed to load '${inFile}': ${String(err)}\n`);
    return 1;
  }

  if (Object.keys(schemaMap).length === 0) {
    process.stderr.write(
      `pk gen-py-schema: no Zod schemas exported from '${inFile}'.\n` +
        'Ensure the file exports named Zod schema instances (e.g. export const Atom = z.object(…)).\n',
    );
    return 1;
  }

  const entries = Object.entries(schemaMap);
  const firstKey = entries[0]?.[0];
  const $defs: Record<string, unknown> = {};
  for (const [name, schema] of entries) {
    $defs[name] = schema;
  }
  const jsonSchemaDoc = JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $ref: `#/$defs/${firstKey}`,
      $defs,
    },
    null,
    2,
  );

  // 3. Check mode: generate to memory, compare against existing snapshot
  if (check) {
    const checkResult = await runDatamodelCodegen({
      schemaJson: jsonSchemaDoc,
      outputPath: '-',
    });
    if (!checkResult.success) {
      process.stderr.write(
        `pk gen-py-schema: codegen failed in check mode:\n${checkResult.stderr}\n`,
      );
      return 1;
    }
    let existing: string;
    try {
      existing = await readFile(outFile, 'utf8');
    } catch {
      process.stderr.write(
        `pk gen-py-schema --check: snapshot '${outFile}' does not exist. Run without --check first.\n`,
      );
      return 1;
    }
    if (normalizeForComparison(existing) === normalizeForComparison(checkResult.output)) {
      process.stdout.write(`pk gen-py-schema: snapshot '${outFile}' is up to date.\n`);
      return 0;
    }
    process.stderr.write(`pk gen-py-schema: snapshot drift detected in '${outFile}'.\n`);
    process.stderr.write("Run 'pk gen-py-schema --in <file> --out <snapshot>' to regenerate.\n");
    return 1;
  }

  // 4. Normal mode: generate and write (or stream to stdout)
  const result = await runDatamodelCodegen({
    schemaJson: jsonSchemaDoc,
    outputPath: outFile,
  });

  if (!result.success) {
    process.stderr.write(`pk gen-py-schema: datamodel-codegen failed:\n${result.stderr}\n`);
    return 1;
  }

  if (outFile === '-') {
    process.stdout.write(result.output);
  } else {
    process.stdout.write(`pk gen-py-schema: wrote '${outFile}'\n`);
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

export const GEN_PY_SCHEMA_HELP = `
Usage: pk gen-py-schema --in <ts-file> --out <py-file> [options]

Convert exported Zod schemas from a TypeScript file into Pydantic v2
BaseModel classes via a JSON Schema Draft 2020-12 intermediate.

Requires:
  tsx   — TypeScript runner; resolved from node_modules/.bin/tsx
  uv    — Python env manager (https://astral.sh/uv); fetches
          datamodel-code-generator on demand

Options:
  --in <ts-file>       Path to a .ts file exporting named Zod schemas  (required)
  --out <py-file>      Output path for the generated .py file           (required)
                       Use '-' to write to stdout
  --check              Compare output against existing --out; exit 1 on drift
  --strict-features    Reject .refine/.transform/.preprocess/.pipe      [default: on]
  --no-strict-features Opt out of feature-gap enforcement
  --help               Show this help message

Example:
  pk gen-py-schema --in src/schemas/atom.ts --out generated/atom.py
  pk gen-py-schema --in src/schemas/atom.ts --out generated/atom.py --check
`.trimStart();
