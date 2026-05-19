import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSinkExporter } from '../src/file-sink.js';
import type { KitSpanRecord } from '../src/exporter.js';

function makeRecord(overrides: Partial<KitSpanRecord> = {}): KitSpanRecord {
  return {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    name: 'test-span',
    kind: 1,
    startTimeNs: 0,
    endTimeNs: 1000,
    status: { code: 0 },
    attributes: {},
    ...overrides,
  };
}

describe('FileSinkExporter', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `pk-file-sink-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    delete process.env['PK_TRACE_DIR'];
  });

  afterEach(async () => {
    delete process.env['PK_TRACE_DIR'];
    await rm(testDir, { recursive: true, force: true });
  });

  it('writes JSONL to <dir>/<runId>.jsonl', async () => {
    const sink = new FileSinkExporter({ runId: 'run-001', dir: testDir });
    const record = makeRecord();
    await sink.write([record]);

    const content = await readFile(join(testDir, 'run-001.jsonl'), 'utf8');
    const parsed = JSON.parse(content.trim()) as KitSpanRecord;
    expect(parsed.traceId).toBe(record.traceId);
    expect(parsed.name).toBe('test-span');
  });

  it('appends multiple writes as separate JSONL lines', async () => {
    const sink = new FileSinkExporter({ runId: 'run-multi', dir: testDir });
    await sink.write([makeRecord({ name: 'first' })]);
    await sink.write([makeRecord({ name: 'second' })]);

    const content = await readFile(join(testDir, 'run-multi.jsonl'), 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0]!) as KitSpanRecord).name).toBe('first');
    expect((JSON.parse(lines[1]!) as KitSpanRecord).name).toBe('second');
  });

  it('respects PK_TRACE_DIR env var when no constructor dir provided', async () => {
    process.env['PK_TRACE_DIR'] = testDir;
    const sink = new FileSinkExporter({ runId: 'env-run' });
    await sink.write([makeRecord()]);

    const content = await readFile(join(testDir, 'env-run.jsonl'), 'utf8');
    expect(content.trim()).toBeTruthy();
  });

  it('constructor dir wins over PK_TRACE_DIR env var', async () => {
    const otherDir = join(tmpdir(), `pk-other-${Date.now()}`);
    process.env['PK_TRACE_DIR'] = otherDir;

    const sink = new FileSinkExporter({ runId: 'priority-run', dir: testDir });
    await sink.write([makeRecord()]);

    // File should exist in constructor dir, not env var dir.
    const content = await readFile(join(testDir, 'priority-run.jsonl'), 'utf8');
    expect(content.trim()).toBeTruthy();

    // Env dir should NOT have the file.
    await expect(readFile(join(otherDir, 'priority-run.jsonl'), 'utf8')).rejects.toThrow();

    await rm(otherDir, { recursive: true, force: true });
  });
});
