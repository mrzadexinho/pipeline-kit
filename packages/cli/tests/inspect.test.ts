import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectCommand } from '../src/commands/inspect.js';

function makePipelineFixture(id: string, extra?: Record<string, unknown>): string {
  const extraJson = extra ? JSON.stringify(extra) : '{}';
  return `
export const pipeline = {
  run: async () => ({ ok: true }),
  describe: () => Object.assign({ id: '${id}', steps: [] }, ${extraJson}),
};
`;
}

let tmpDir: string;
let pipelinesDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'pk-inspect-test-'));
  pipelinesDir = join(tmpDir, 'pipelines');
  await mkdir(pipelinesDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  // Reset process.exitCode after each test
  process.exitCode = undefined;
});

describe('inspectCommand', () => {
  it('prints JSON of the pipeline description on success', async () => {
    await writeFile(
      join(pipelinesDir, 'alpha.pipeline.mjs'),
      makePipelineFixture('pk_pipe_alpha', { version: '1.0.0' }),
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await inspectCommand('pk_pipe_alpha', tmpDir);

    expect(logSpy).toHaveBeenCalledOnce();
    const output = logSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed['id']).toBe('pk_pipe_alpha');
    expect(parsed['version']).toBe('1.0.0');
    expect(parsed['steps']).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints formatted JSON (2-space indent)', async () => {
    await writeFile(
      join(pipelinesDir, 'beta.pipeline.mjs'),
      makePipelineFixture('pk_pipe_beta'),
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await inspectCommand('pk_pipe_beta', tmpDir);

    const output = logSpy.mock.calls[0]?.[0] as string;
    // Formatted JSON contains newlines and spaces
    expect(output).toContain('\n');
    expect(output).toContain('  ');

    logSpy.mockRestore();
  });

  it('prints error and sets exitCode=1 when pipeline not found', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await inspectCommand('pk_pipe_nonexistent', tmpDir);

    expect(errorSpy).toHaveBeenCalledOnce();
    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain('pk_pipe_nonexistent');
    expect(logSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('prints error and sets exitCode=1 for empty pipelines directory', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await inspectCommand('pk_pipe_any', tmpDir);

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);

    errorSpy.mockRestore();
  });

  it('does not print error when pipeline is found', async () => {
    await writeFile(
      join(pipelinesDir, 'gamma.pipeline.mjs'),
      makePipelineFixture('pk_pipe_gamma'),
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await inspectCommand('pk_pipe_gamma', tmpDir);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledOnce();

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
