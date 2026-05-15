import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { devCommand, parseCronInterval } from '../src/commands/dev.js';

/** Fixtures */

function makeSuccessFixture(id: string): string {
  return `
export const pipeline = {
  run: async () => ({ data: { ok: true }, error: null }),
  describe: () => ({ id: '${id}', steps: [] }),
};
`;
}

function makeCronFixture(id: string, expr: string): string {
  return `
export const pipeline = {
  run: async () => ({ data: { fired: true }, error: null }),
  describe: () => ({ id: '${id}', steps: [], trigger: { kind: 'cron', expr: '${expr}' } }),
};
`;
}

/** Setup / teardown */

let tmpDir: string;
let pipelinesDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'pk-dev-test-'));
  pipelinesDir = join(tmpDir, 'pipelines');
  await mkdir(pipelinesDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  process.exitCode = undefined;
});

/** parseCronInterval unit tests */

describe('parseCronInterval', () => {
  it('parses "every 30s" to 30000ms', () => {
    expect(parseCronInterval('every 30s')).toBe(30_000);
  });

  it('parses "every 5m" to 300000ms', () => {
    expect(parseCronInterval('every 5m')).toBe(300_000);
  });

  it('parses "every 1h" to 3600000ms', () => {
    expect(parseCronInterval('every 1h')).toBe(3_600_000);
  });

  it('parses "every 2h" to 7200000ms', () => {
    expect(parseCronInterval('every 2h')).toBe(7_200_000);
  });

  it('parses "* * * * *" to 60000ms', () => {
    expect(parseCronInterval('* * * * *')).toBe(60_000);
  });

  it('is case-insensitive for unit suffix', () => {
    expect(parseCronInterval('every 10S')).toBe(10_000);
    expect(parseCronInterval('every 1M')).toBe(60_000);
    expect(parseCronInterval('every 1H')).toBe(3_600_000);
  });

  it('returns 0 for an empty string', () => {
    expect(parseCronInterval('')).toBe(0);
  });

  it('returns 0 for an unrecognised expression', () => {
    expect(parseCronInterval('0 9 * * 1-5')).toBe(0);
    expect(parseCronInterval('daily')).toBe(0);
    expect(parseCronInterval('every 10 seconds')).toBe(0);
  });
});

/** devCommand integration tests */

describe('devCommand', () => {
  it('prints discovered pipelines on initial start', async () => {
    await writeFile(
      join(pipelinesDir, 'alpha.pipeline.mjs'),
      makeSuccessFixture('pk_pipe_alpha'),
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const handle = await devCommand({ baseDir: tmpDir });
    handle.stop();

    const allLogs = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allLogs).toContain('Discovered 1 pipeline(s)');
    expect(allLogs).toContain('pk_pipe_alpha');

    logSpy.mockRestore();
  });

  it('reports 0 pipelines when directory is empty', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const handle = await devCommand({ baseDir: tmpDir });
    handle.stop();

    const allLogs = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allLogs).toContain('Discovered 0 pipeline(s)');

    logSpy.mockRestore();
  });

  it('runs in static mode when watch directory does not exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const handle = await devCommand({ baseDir: join(tmpDir, 'nonexistent') });
    handle.stop();

    const allLogs = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allLogs).toContain('static mode');

    logSpy.mockRestore();
  });

  it('schedules a cron interval for a pipeline with a cron trigger', async () => {
    await writeFile(
      join(pipelinesDir, 'cron.pipeline.mjs'),
      makeCronFixture('pk_pipe_cron', 'every 30s'),
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const handle = await devCommand({ baseDir: tmpDir });
    handle.stop();

    const allLogs = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allLogs).toContain('[cron] pk_pipe_cron scheduled every 30000ms');

    logSpy.mockRestore();
  });

  it('stop() cleans up intervals and watcher without throwing', async () => {
    await writeFile(
      join(pipelinesDir, 'cron.pipeline.mjs'),
      makeCronFixture('pk_pipe_cron', 'every 1s'),
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const handle = await devCommand({ baseDir: tmpDir });

    // Must not throw
    expect(() => handle.stop()).not.toThrow();
    // Second stop() is also safe (idempotent teardown)
    expect(() => handle.stop()).not.toThrow();

    logSpy.mockRestore();
  });

  it('does not schedule cron for a pipeline without a trigger', async () => {
    await writeFile(
      join(pipelinesDir, 'alpha.pipeline.mjs'),
      makeSuccessFixture('pk_pipe_alpha'),
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const handle = await devCommand({ baseDir: tmpDir });
    handle.stop();

    const allLogs = logSpy.mock.calls.map((c) => c[0] as string).join('\n');
    expect(allLogs).not.toContain('[cron]');

    logSpy.mockRestore();
  });
});
