/**
 * Thin wrapper over `uv run datamodel-codegen` for converting JSON Schema
 * documents into Pydantic v2 BaseModel classes.
 *
 * Runtime dependency: `uv` must be on PATH. The Python package
 * `datamodel-code-generator[http]==0.57.0` is fetched on-demand by `uv run`.
 *
 * Invoked via `child_process.execFile` (not exec/shell) to prevent injection
 * via user-supplied file paths; all user values are passed as separate argv
 * elements, never interpolated into a shell string.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CodegenOptions {
  /** JSON Schema document as a string — written to a temp file for codegen. */
  schemaJson: string;
  /**
   * Pydantic `.py` output path.
   * Pass `'-'` to capture output as a string without writing a file.
   */
  outputPath: string;
}

export interface CodegenResult {
  success: boolean;
  /** Captured stdout content, or the final file content when outputPath is '-'. */
  output: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Invoke `uv run --with 'datamodel-code-generator[http]>=0.25' datamodel-codegen`
 * and return the generated Pydantic v2 source.
 *
 * When `opts.outputPath === '-'`, the output is written to a temp file, read
 * back as a string, and then cleaned up. This allows the caller to capture the
 * generated code without touching the filesystem for the final output.
 */
export async function runDatamodelCodegen(opts: CodegenOptions): Promise<CodegenResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'pk-codegen-'));
  const schemaFile = join(tmpDir, 'schema.json');
  let outFile: string;
  const useStdout = opts.outputPath === '-';

  if (useStdout) {
    outFile = join(tmpDir, 'out.py');
  } else {
    outFile = opts.outputPath;
  }

  try {
    await writeFile(schemaFile, opts.schemaJson, 'utf8');

    // All args are separate argv elements — no shell interpolation, no injection risk.
    const args = [
      'run',
      '--with',
      'datamodel-code-generator[http]==0.57.0',
      'datamodel-codegen',
      '--input-file-type',
      'jsonschema',
      '--input',
      schemaFile,
      '--output',
      outFile,
      '--output-model-type',
      'pydantic_v2.BaseModel',
    ];

    const { stdout, stderr } = await execFileAsync('uv', args, {
      timeout: 120_000,
    });

    if (useStdout) {
      const content = await readFile(outFile, 'utf8');
      return { success: true, output: content, stderr: stderr };
    }

    return { success: true, output: stdout, stderr: stderr };
  } catch (err: unknown) {
    const e = err as { code?: number; stderr?: string; stdout?: string; message?: string };
    const stderr = e.stderr ?? e.message ?? String(err);
    return { success: false, output: e.stdout ?? '', stderr };
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
