import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface DiscoveredPipeline {
  id: string;
  filePath: string;
  pipeline: {
    run: (...args: unknown[]) => unknown;
    describe: () => unknown;
  };
}

/** Duck-type check: does the export look like a DefinedPipeline? */
function isDuckPipeline(
  value: unknown,
): value is { run: (...args: unknown[]) => unknown; describe: () => unknown } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.run === 'function' && typeof v.describe === 'function';
}

/**
 * Recursively find pipeline files under a directory.
 * Matches `*.pipeline.ts`, `*.pipeline.js`, `*.pipeline.mjs`.
 */
async function findPipelineFiles(dir: string): Promise<string[]> {
  let entries: Dirent<string>[];
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true, encoding: 'utf8' });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (
      name.endsWith('.pipeline.ts') ||
      name.endsWith('.pipeline.js') ||
      name.endsWith('.pipeline.mjs')
    ) {
      // entry.parentPath is available in Node 20+ when using recursive readdir
      const parentPath = entry.parentPath ?? dir;
      results.push(join(parentPath, name));
    }
  }
  return results;
}

/**
 * Discover all DefinedPipeline instances exported from `*.pipeline.{ts,js,mjs}`
 * files found under `<baseDir>/pipelines/`.
 *
 * @param baseDir  Root directory to search from (defaults to `process.cwd()`).
 * @param pattern  Override the glob subdirectory name (useful in tests).
 */
export async function discoverPipelines(
  baseDir?: string,
  pattern = 'pipelines',
): Promise<DiscoveredPipeline[]> {
  const root = resolve(baseDir ?? process.cwd(), pattern);
  const files = await findPipelineFiles(root);

  const discovered: DiscoveredPipeline[] = [];

  for (const filePath of files) {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(filePath)) as Record<string, unknown>;
    } catch {
      // skip files that fail to import
      continue;
    }

    for (const exportedValue of Object.values(mod)) {
      if (!isDuckPipeline(exportedValue)) continue;

      let description: unknown;
      try {
        description = exportedValue.describe();
      } catch {
        continue;
      }

      if (
        typeof description !== 'object' ||
        description === null ||
        typeof (description as Record<string, unknown>).id !== 'string'
      ) {
        continue;
      }

      const id = (description as { id: string }).id;
      discovered.push({ id, filePath, pipeline: exportedValue });
    }
  }

  return discovered;
}

/**
 * Find a single pipeline by its id.
 *
 * @param id       The pipeline id (e.g. `pk_pipe_my_pipeline`).
 * @param baseDir  Root directory to search from (defaults to `process.cwd()`).
 * @param pattern  Override the glob subdirectory name (useful in tests).
 */
export async function findPipelineById(
  id: string,
  baseDir?: string,
  pattern?: string,
): Promise<DiscoveredPipeline | undefined> {
  const pipelines = await discoverPipelines(baseDir, pattern);
  return pipelines.find((p) => p.id === id);
}
