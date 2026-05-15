import { findPipelineById } from '../discover.js';

/**
 * `pk inspect <pipelineId>` — print a pipeline's enriched definition as JSON.
 *
 * Exits with code 1 and a console.error message when the pipeline is not found.
 *
 * @param pipelineId  The pipeline id to look up (e.g. `pk_pipe_my_pipeline`).
 * @param baseDir     Root directory to search from (defaults to `process.cwd()`).
 * @param pattern     Override the glob subdirectory name (useful in tests).
 */
export async function inspectCommand(
  pipelineId: string,
  baseDir?: string,
  pattern?: string,
): Promise<void> {
  const found = await findPipelineById(pipelineId, baseDir, pattern);

  if (!found) {
    console.error(`Pipeline not found: ${pipelineId}`);
    process.exitCode = 1;
    return;
  }

  let description: unknown;
  try {
    description = found.pipeline.describe();
  } catch (err) {
    console.error(`Failed to describe pipeline "${pipelineId}": ${String(err)}`);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(description, null, 2));
}
