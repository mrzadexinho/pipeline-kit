import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverPipelines, findPipelineById } from '../src/discover.js';

/** Helpers */

function makePipelineFixture(id: string): string {
  return `
export const pipeline = {
  run: async () => ({ ok: true }),
  describe: () => ({ id: '${id}', steps: [] }),
};
`;
}

function makeNonPipelineFixture(): string {
  return `
export const notAPipeline = { value: 42 };
export function helper() { return 'noop'; }
`;
}

/** Test suite */

let tmpDir: string;
let pipelinesDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'pk-discover-test-'));
  pipelinesDir = join(tmpDir, 'pipelines');
  await mkdir(pipelinesDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('discoverPipelines', () => {
  it('returns empty array for an empty pipelines directory', async () => {
    const result = await discoverPipelines(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns empty array when pipelines directory does not exist', async () => {
    const result = await discoverPipelines(join(tmpDir, 'nonexistent'));
    expect(result).toEqual([]);
  });

  it('discovers a single pipeline file', async () => {
    await writeFile(
      join(pipelinesDir, 'alpha.pipeline.mjs'),
      makePipelineFixture('pk_pipe_alpha'),
    );

    const result = await discoverPipelines(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('pk_pipe_alpha');
  });

  it('discovers multiple pipeline files', async () => {
    await writeFile(
      join(pipelinesDir, 'alpha.pipeline.mjs'),
      makePipelineFixture('pk_pipe_alpha'),
    );
    await writeFile(
      join(pipelinesDir, 'beta.pipeline.mjs'),
      makePipelineFixture('pk_pipe_beta'),
    );

    const result = await discoverPipelines(tmpDir);
    const ids = result.map((p) => p.id).sort();
    expect(ids).toEqual(['pk_pipe_alpha', 'pk_pipe_beta']);
    expect(result).toHaveLength(2);
  });

  it('ignores non-pipeline files', async () => {
    await writeFile(join(pipelinesDir, 'helper.mjs'), makeNonPipelineFixture());
    await writeFile(join(pipelinesDir, 'README.md'), '# docs');
    await writeFile(
      join(pipelinesDir, 'real.pipeline.mjs'),
      makePipelineFixture('pk_pipe_real'),
    );

    const result = await discoverPipelines(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('pk_pipe_real');
  });

  it('ignores exports without both run and describe', async () => {
    const fixture = `
export const missingDescribe = { run: async () => ({}) };
export const missingRun = { describe: () => ({ id: 'pk_pipe_x', steps: [] }) };
export const primitive = 42;
`;
    await writeFile(join(pipelinesDir, 'partial.pipeline.mjs'), fixture);

    const result = await discoverPipelines(tmpDir);
    expect(result).toEqual([]);
  });

  it('ignores exports where describe() does not return an id string', async () => {
    const fixture = `
export const noId = {
  run: async () => ({}),
  describe: () => ({ steps: [] }),
};
`;
    await writeFile(join(pipelinesDir, 'noid.pipeline.mjs'), fixture);

    const result = await discoverPipelines(tmpDir);
    expect(result).toEqual([]);
  });

  it('returns filePath and pipeline reference alongside id', async () => {
    await writeFile(
      join(pipelinesDir, 'gamma.pipeline.mjs'),
      makePipelineFixture('pk_pipe_gamma'),
    );

    const result = await discoverPipelines(tmpDir);
    expect(result[0]?.filePath).toContain('gamma.pipeline.mjs');
    expect(typeof result[0]?.pipeline.run).toBe('function');
    expect(typeof result[0]?.pipeline.describe).toBe('function');
  });

  it('discovers pipelines in nested subdirectories', async () => {
    const subDir = join(pipelinesDir, 'nested', 'deep');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(subDir, 'deep.pipeline.mjs'), makePipelineFixture('pk_pipe_deep'));
    await writeFile(
      join(pipelinesDir, 'top.pipeline.mjs'),
      makePipelineFixture('pk_pipe_top'),
    );

    const result = await discoverPipelines(tmpDir);
    const ids = result.map((p) => p.id).sort();
    expect(ids).toEqual(['pk_pipe_deep', 'pk_pipe_top']);
  });
});

describe('findPipelineById', () => {
  it('returns the pipeline when found by id', async () => {
    await writeFile(
      join(pipelinesDir, 'alpha.pipeline.mjs'),
      makePipelineFixture('pk_pipe_alpha'),
    );

    const found = await findPipelineById('pk_pipe_alpha', tmpDir);
    expect(found).toBeDefined();
    expect(found?.id).toBe('pk_pipe_alpha');
  });

  it('returns undefined when id does not match any pipeline', async () => {
    await writeFile(
      join(pipelinesDir, 'alpha.pipeline.mjs'),
      makePipelineFixture('pk_pipe_alpha'),
    );

    const found = await findPipelineById('pk_pipe_missing', tmpDir);
    expect(found).toBeUndefined();
  });

  it('returns undefined for empty directory', async () => {
    const found = await findPipelineById('pk_pipe_anything', tmpDir);
    expect(found).toBeUndefined();
  });

  it('returns correct pipeline when multiple exist', async () => {
    await writeFile(
      join(pipelinesDir, 'alpha.pipeline.mjs'),
      makePipelineFixture('pk_pipe_alpha'),
    );
    await writeFile(
      join(pipelinesDir, 'beta.pipeline.mjs'),
      makePipelineFixture('pk_pipe_beta'),
    );

    const found = await findPipelineById('pk_pipe_beta', tmpDir);
    expect(found?.id).toBe('pk_pipe_beta');
  });
});
