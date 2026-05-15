import { findPipelineById } from '../discover.js';

export interface RunCommandOptions {
  input?: string;   // JSON string from --input flag
  baseDir?: string; // override CWD
  pattern?: string; // override pipelines subdir (for tests)
}

/**
 * `pk run <pipelineId>` — load a pipeline by id, parse optional JSON input,
 * execute it, and print the result.
 *
 * Exits with code 1 when:
 *   - the pipeline is not found
 *   - the --input value is not valid JSON
 *   - the pipeline returns an error result
 */
export async function runCommand(
  pipelineId: string,
  opts: RunCommandOptions = {},
): Promise<void> {
  const found = await findPipelineById(pipelineId, opts.baseDir, opts.pattern);
  if (!found) {
    console.error(`Pipeline not found: ${pipelineId}`);
    process.exitCode = 1;
    return;
  }

  let input: unknown;
  if (opts.input) {
    try {
      input = JSON.parse(opts.input);
    } catch {
      console.error('Invalid JSON input');
      process.exitCode = 1;
      return;
    }
  }

  const result = await found.pipeline.run(input);
  // Result<T, E> shape: { data: T; error: null } | { data: null; error: E }
  const r = result as { data: unknown; error: unknown };
  if (r.error !== null && r.error !== undefined) {
    console.error(`Pipeline failed: ${JSON.stringify(r.error)}`);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(r.data, null, 2));
}
