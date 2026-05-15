import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../src/commands/run.js';

/** Fixtures */

function makeSuccessFixture(id: string): string {
  return `
export const pipeline = {
  run: async (input) => ({ data: { processed: input ?? 'default' }, error: null }),
  describe: () => ({ id: '${id}', steps: [] }),
};
`;
}

function makeFailureFixture(id: string): string {
  return `
export const pipeline = {
  run: async () => ({ data: null, error: { code: 'process_failed', message: 'boom' } }),
  describe: () => ({ id: '${id}', steps: [] }),
};
`;
}

/** Setup / teardown */

let tmpDir: string;
let pipelinesDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'pk-run-test-'));
  pipelinesDir = join(tmpDir, 'pipelines');
  await mkdir(pipelinesDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  process.exitCode = undefined;
});

/** Tests */

describe('runCommand', () => {
  it('prints JSON result when pipeline succeeds', async () => {
    await writeFile(join(pipelinesDir, 'alpha.pipeline.mjs'), makeSuccessFixture('pk_pipe_alpha'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runCommand('pk_pipe_alpha', { baseDir: tmpDir });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.processed).toBe('default');
    expect(process.exitCode).toBeUndefined();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('passes parsed JSON input to the pipeline', async () => {
    await writeFile(join(pipelinesDir, 'alpha.pipeline.mjs'), makeSuccessFixture('pk_pipe_alpha'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runCommand('pk_pipe_alpha', { baseDir: tmpDir, input: '{"key":"value"}' });

    const output = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.processed).toEqual({ key: 'value' });

    logSpy.mockRestore();
  });

  it('runs with undefined input when no --input flag is supplied', async () => {
    await writeFile(join(pipelinesDir, 'alpha.pipeline.mjs'), makeSuccessFixture('pk_pipe_alpha'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runCommand('pk_pipe_alpha', { baseDir: tmpDir });

    const output = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    // No input → fixture returns 'default'
    expect(parsed.processed).toBe('default');

    logSpy.mockRestore();
  });

  it('prints error and sets exitCode=1 when pipeline returns an error result', async () => {
    await writeFile(join(pipelinesDir, 'fail.pipeline.mjs'), makeFailureFixture('pk_pipe_fail'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runCommand('pk_pipe_fail', { baseDir: tmpDir });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain('Pipeline failed');
    expect(msg).toContain('boom');
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints error and sets exitCode=1 when pipeline is not found', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runCommand('pk_pipe_nonexistent', { baseDir: tmpDir });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain('pk_pipe_nonexistent');
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints error and sets exitCode=1 for invalid JSON input', async () => {
    await writeFile(join(pipelinesDir, 'alpha.pipeline.mjs'), makeSuccessFixture('pk_pipe_alpha'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runCommand('pk_pipe_alpha', { baseDir: tmpDir, input: '{not valid json' });

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledOnce();
    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain('Invalid JSON input');
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('outputs formatted JSON (2-space indent) on success', async () => {
    await writeFile(join(pipelinesDir, 'alpha.pipeline.mjs'), makeSuccessFixture('pk_pipe_alpha'));

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runCommand('pk_pipe_alpha', { baseDir: tmpDir });

    const output = logSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('\n');
    expect(output).toContain('  ');

    logSpy.mockRestore();
  });
});
