import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { KitSpanRecord } from '@idriszade/observe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { traceCommand } from '../src/commands/trace.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpan(overrides: Partial<KitSpanRecord> & { spanId: string }): KitSpanRecord {
  return {
    traceId: 'aaaa1111bbbb2222cccc3333dddd4444',
    spanId: overrides.spanId,
    name: overrides.name ?? 'process',
    kind: 0,
    startTimeNs: overrides.startTimeNs ?? 1_000_000_000,
    endTimeNs: overrides.endTimeNs ?? 2_000_000_000,
    status: overrides.status ?? { code: 0 },
    attributes: overrides.attributes ?? {},
    parentSpanId: overrides.parentSpanId,
  };
}

async function writeJSONL(dir: string, filename: string, spans: KitSpanRecord[]): Promise<string> {
  const path = join(dir, filename);
  const content = `${spans.map((s) => JSON.stringify(s)).join('\n')}\n`;
  await writeFile(path, content, 'utf8');
  return path;
}

function captureIO(fn: () => Promise<void>): Promise<{ stdout: string[]; stderr: string[] }> {
  return new Promise((resolve, reject) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (s: unknown) => {
      stdout.push(String(s));
    };
    console.error = (s: unknown) => {
      stderr.push(String(s));
    };
    fn()
      .then(() => {
        console.log = origLog;
        console.error = origErr;
        resolve({ stdout, stderr });
      })
      .catch((err: unknown) => {
        console.log = origLog;
        console.error = origErr;
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(async () => {
  process.exitCode = undefined;
  testDir = join(tmpdir(), `pk-trace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  process.exitCode = undefined;
  await rm(testDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('traceCommand — path resolution', () => {
  it('reads JSONL via --file and prints ASCII with span names', async () => {
    const spans = [makeSpan({ spanId: 'span001', name: 'process' })];
    const file = await writeJSONL(testDir, 'run.jsonl', spans);

    const { stdout, stderr } = await captureIO(() => traceCommand({ file }));

    expect(process.exitCode).toBeUndefined();
    expect(stderr).toHaveLength(0);
    expect(stdout.join('\n')).toContain('process');
  });

  it('resolves --run + --dir to <dir>/<id>.jsonl', async () => {
    const spans = [makeSpan({ spanId: 'span002', name: 'serve' })];
    await writeJSONL(testDir, 'run42.jsonl', spans);

    const { stdout } = await captureIO(() => traceCommand({ runId: 'run42', dir: testDir }));

    expect(process.exitCode).toBeUndefined();
    expect(stdout.join('\n')).toContain('serve');
  });

  it('resolves --run with PK_TRACE_DIR env var', async () => {
    const spans = [makeSpan({ spanId: 'span003', name: 'source' })];
    await writeJSONL(testDir, 'envrun.jsonl', spans);

    const prev = process.env.PK_TRACE_DIR;
    process.env.PK_TRACE_DIR = testDir;
    try {
      const { stdout } = await captureIO(() => traceCommand({ runId: 'envrun' }));
      expect(process.exitCode).toBeUndefined();
      expect(stdout.join('\n')).toContain('source');
    } finally {
      if (prev === undefined) delete process.env.PK_TRACE_DIR;
      else process.env.PK_TRACE_DIR = prev;
    }
  });

  it('sets exitCode=1 and emits usage when both --file and --run are absent', async () => {
    const { stderr } = await captureIO(() => traceCommand({}));

    expect(process.exitCode).toBe(1);
    expect(stderr.join('\n')).toContain('pk trace');
  });

  it('sets exitCode=1 with useful error when file does not exist', async () => {
    const { stderr } = await captureIO(() =>
      traceCommand({ file: join(testDir, 'nonexistent.jsonl') }),
    );

    expect(process.exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/cannot read|nonexistent/i);
  });
});

describe('traceCommand — empty file', () => {
  it('sets exitCode=1 and emits "No spans" for an empty file', async () => {
    const file = join(testDir, 'empty.jsonl');
    await writeFile(file, '', 'utf8');

    const { stderr } = await captureIO(() => traceCommand({ file }));

    expect(process.exitCode).toBe(1);
    expect(stderr.join('\n')).toMatch(/no spans/i);
  });
});

describe('traceCommand — malformed JSONL', () => {
  it('skips malformed lines, emits stderr warning, and renders valid spans', async () => {
    const good = makeSpan({ spanId: 'span004', name: 'process' });
    const file = join(testDir, 'partial.jsonl');
    await writeFile(file, `${JSON.stringify(good)}\n{INVALID_JSON}\n`, 'utf8');

    const { stdout, stderr } = await captureIO(() => traceCommand({ file }));

    expect(process.exitCode).toBeUndefined();
    expect(stderr.join('\n')).toContain('Malformed JSONL');
    expect(stdout.join('\n')).toContain('process');
  });
});

describe('traceCommand — JSON output', () => {
  it('emits valid JSON with spans array and usage rollup', async () => {
    const spans = [
      makeSpan({
        spanId: 'span010',
        name: 'llm-call',
        attributes: {
          'gen_ai.usage.input_tokens': 100,
          'gen_ai.usage.output_tokens': 50,
        },
      }),
    ];
    const file = await writeJSONL(testDir, 'json.jsonl', spans);

    const { stdout } = await captureIO(() => traceCommand({ file, json: true }));

    const parsed = JSON.parse(stdout.join('\n')) as {
      spans: KitSpanRecord[];
      usage: Record<string, number>;
    };
    expect(parsed.spans).toHaveLength(1);
    expect(parsed.usage['gen_ai.usage.input_tokens']).toBe(100);
    expect(parsed.usage['gen_ai.usage.output_tokens']).toBe(50);
  });

  it('excludes cache sub-fields from usage rollup totals', async () => {
    const spans = [
      makeSpan({
        spanId: 'span011',
        name: 'llm-call',
        attributes: {
          'gen_ai.usage.input_tokens': 200,
          'gen_ai.usage.input_tokens.cache_read': 80,
          'gen_ai.usage.input_tokens.cache_write': 40,
          'gen_ai.usage.input_tokens.no_cache': 80,
          'gen_ai.usage.output_tokens': 60,
          'gen_ai.usage.output_tokens.reasoning': 10,
          'gen_ai.usage.output_tokens.text': 50,
        },
      }),
    ];
    const file = await writeJSONL(testDir, 'cache.jsonl', spans);

    const { stdout } = await captureIO(() => traceCommand({ file, json: true }));

    const parsed = JSON.parse(stdout.join('\n')) as {
      usage: Record<string, number>;
    };
    // Only additive top-level keys should appear in rollup
    expect(parsed.usage['gen_ai.usage.input_tokens']).toBe(200);
    expect(parsed.usage['gen_ai.usage.output_tokens']).toBe(60);
    // Cache + reasoning sub-fields must NOT be in rollup
    expect(parsed.usage['gen_ai.usage.input_tokens.cache_read']).toBeUndefined();
    expect(parsed.usage['gen_ai.usage.input_tokens.cache_write']).toBeUndefined();
    expect(parsed.usage['gen_ai.usage.input_tokens.no_cache']).toBeUndefined();
    expect(parsed.usage['gen_ai.usage.output_tokens.reasoning']).toBeUndefined();
    expect(parsed.usage['gen_ai.usage.output_tokens.text']).toBeUndefined();
  });
});

describe('traceCommand — ASCII tree structure', () => {
  it('renders parent→child indented structure', async () => {
    const root = makeSpan({
      spanId: 'rootspan',
      name: 'root-stage',
      startTimeNs: 1_000_000_000,
      endTimeNs: 4_000_000_000,
    });
    const child = makeSpan({
      spanId: 'childspan',
      name: 'child-stage',
      parentSpanId: 'rootspan',
      startTimeNs: 1_500_000_000,
      endTimeNs: 3_000_000_000,
    });
    const file = await writeJSONL(testDir, 'tree.jsonl', [root, child]);

    const { stdout } = await captureIO(() => traceCommand({ file }));

    const out = stdout.join('\n');
    expect(out).toContain('root-stage');
    expect(out).toContain('child-stage');
    // child indented with tree characters
    const childLine = stdout.find((l) => l.includes('child-stage')) ?? '';
    expect(childLine).toMatch(/[│├└]/);
  });
});

describe('traceCommand — integration (3-span tree + JSON)', () => {
  it('renders 3-span tree and returns correct usage aggregation', async () => {
    const root = makeSpan({
      spanId: 'r000001',
      name: 'pipeline',
      startTimeNs: 1_000_000_000,
      endTimeNs: 10_000_000_000,
      attributes: { 'gen_ai.usage.input_tokens': 50, 'gen_ai.usage.output_tokens': 20 },
    });
    const child1 = makeSpan({
      spanId: 'c100001',
      name: 'classify',
      parentSpanId: 'r000001',
      startTimeNs: 2_000_000_000,
      endTimeNs: 5_000_000_000,
      attributes: { 'gen_ai.usage.input_tokens': 150, 'gen_ai.usage.output_tokens': 30 },
    });
    const child2 = makeSpan({
      spanId: 'c200001',
      name: 'extract',
      parentSpanId: 'c100001',
      startTimeNs: 5_000_000_000,
      endTimeNs: 9_000_000_000,
      attributes: {
        'gen_ai.usage.input_tokens': 200,
        'gen_ai.usage.output_tokens': 40,
        'gen_ai.usage.input_tokens.cache_read': 100,
      },
    });

    const file = await writeJSONL(testDir, 'integration.jsonl', [root, child1, child2]);

    const { stdout } = await captureIO(() => traceCommand({ file, json: true }));

    const parsed = JSON.parse(stdout.join('\n')) as {
      spans: KitSpanRecord[];
      usage: Record<string, number>;
    };

    expect(parsed.spans).toHaveLength(3);
    // Additive totals: 50+150+200=400 input, 20+30+40=90 output
    expect(parsed.usage['gen_ai.usage.input_tokens']).toBe(400);
    expect(parsed.usage['gen_ai.usage.output_tokens']).toBe(90);
    // cache_read sub-field excluded from rollup
    expect(parsed.usage['gen_ai.usage.input_tokens.cache_read']).toBeUndefined();
  });
});
