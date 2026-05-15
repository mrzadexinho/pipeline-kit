import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectCommand } from '../src/commands/inspect.js';
import { runCommand } from '../src/commands/run.js';
import { discoverPipelines } from '../src/discover.js';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function makeSuccessPipeline(id: string, version = '1.0.0'): string {
  return `
export const pipeline = {
  run: async (input) => ({
    data: { result: 'ok', input: input ?? null },
    error: null,
  }),
  describe: () => ({
    id: '${id}',
    version: '${version}',
    steps: ['step-a', 'step-b'],
  }),
};
`;
}

function makeFailurePipeline(id: string): string {
  return `
export const pipeline = {
  run: async () => ({
    data: null,
    error: { code: 'process_failed', message: 'pipeline failed' },
  }),
  describe: () => ({ id: '${id}', steps: [] }),
};
`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ──────────────────────────────────────────────────────────────────────────────

let tmpDir: string;
let pipelinesDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'pk-integration-test-'));
  pipelinesDir = join(tmpDir, 'pipelines');
  await mkdir(pipelinesDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  process.exitCode = undefined;
});

// ──────────────────────────────────────────────────────────────────────────────
// discover → inspect → run flow
// ──────────────────────────────────────────────────────────────────────────────

describe('integration: discover → inspect → run', () => {
  it('discovers pipeline files and returns their ids', async () => {
    await writeFile(join(pipelinesDir, 'alpha.pipeline.mjs'), makeSuccessPipeline('pk_pipe_alpha'));
    await writeFile(join(pipelinesDir, 'beta.pipeline.mjs'), makeSuccessPipeline('pk_pipe_beta'));

    const pipelines = await discoverPipelines(tmpDir);
    const ids = pipelines.map((p) => p.id).sort();

    expect(ids).toEqual(['pk_pipe_alpha', 'pk_pipe_beta']);
    expect(pipelines).toHaveLength(2);
  });

  it('inspectCommand prints correct JSON including id, version, steps', async () => {
    await writeFile(
      join(pipelinesDir, 'alpha.pipeline.mjs'),
      makeSuccessPipeline('pk_pipe_alpha', '2.0.0'),
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await inspectCommand('pk_pipe_alpha', tmpDir);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();

    const output = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed.id).toBe('pk_pipe_alpha');
    expect(parsed.version).toBe('2.0.0');
    expect(parsed.steps).toEqual(['step-a', 'step-b']);
    expect(process.exitCode).toBeUndefined();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('runCommand executes pipeline and prints result', async () => {
    await writeFile(join(pipelinesDir, 'alpha.pipeline.mjs'), makeSuccessPipeline('pk_pipe_alpha'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runCommand('pk_pipe_alpha', { baseDir: tmpDir });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();

    const output = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.result).toBe('ok');
    expect(parsed.input).toBeNull();
    expect(process.exitCode).toBeUndefined();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('runCommand passes JSON input to pipeline', async () => {
    await writeFile(join(pipelinesDir, 'alpha.pipeline.mjs'), makeSuccessPipeline('pk_pipe_alpha'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runCommand('pk_pipe_alpha', {
      baseDir: tmpDir,
      input: '{"key":"value"}',
    });

    const output = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.input).toEqual({ key: 'value' });

    logSpy.mockRestore();
  });

  it('full flow: discover, inspect, and run the same pipeline', async () => {
    await writeFile(
      join(pipelinesDir, 'gamma.pipeline.mjs'),
      makeSuccessPipeline('pk_pipe_gamma', '3.1.0'),
    );

    // Step 1 — discover
    const pipelines = await discoverPipelines(tmpDir);
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]?.id).toBe('pk_pipe_gamma');

    // Step 2 — inspect
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await inspectCommand('pk_pipe_gamma', tmpDir);
    const inspectOutput = logSpy.mock.calls[0]?.[0] as string;
    const description = JSON.parse(inspectOutput) as Record<string, unknown>;
    expect(description.version).toBe('3.1.0');

    logSpy.mockClear();

    // Step 3 — run
    await runCommand('pk_pipe_gamma', { baseDir: tmpDir, input: '{"x":1}' });
    const runOutput = logSpy.mock.calls[0]?.[0] as string;
    const runResult = JSON.parse(runOutput) as Record<string, unknown>;
    expect(runResult.result).toBe('ok');
    expect(runResult.input).toEqual({ x: 1 });

    logSpy.mockRestore();
  });

  it('runCommand sets exitCode=1 when pipeline returns error', async () => {
    await writeFile(join(pipelinesDir, 'fail.pipeline.mjs'), makeFailurePipeline('pk_pipe_fail'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runCommand('pk_pipe_fail', { baseDir: tmpDir });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('inspectCommand sets exitCode=1 when pipeline not found', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await inspectCommand('pk_pipe_missing', tmpDir);

    expect(errorSpy).toHaveBeenCalledOnce();
    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain('pk_pipe_missing');
    expect(process.exitCode).toBe(1);

    errorSpy.mockRestore();
  });
});
