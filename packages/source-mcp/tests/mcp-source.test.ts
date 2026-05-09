import type { PipelineContext, TraceContext } from '@idriszade/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOOP_TRACE = {} as unknown as TraceContext;

function makeCtx(signal?: AbortSignal): PipelineContext {
  const meta: Record<string, unknown> = {};
  return {
    runId: 'pk_run_test',
    pipelineId: 'pk_pipe_test',
    attempt: 1,
    metadata: meta,
    signal: signal ?? new AbortController().signal,
    trace: NOOP_TRACE,
    attachMetadata(k: string, v: unknown) {
      meta[k] = v;
    },
  };
}

/**
 * Build a mock callTool response with text content.
 */
function makeTextContent(value: unknown): { type: 'text'; text: string } {
  return { type: 'text', text: JSON.stringify(value) };
}

function buildMockClient(opts: {
  callToolResult?: unknown;
  callToolThrows?: Error;
  isError?: boolean;
  listToolsResult?: { tools: unknown[] };
  connectThrows?: Error;
}) {
  const {
    callToolResult,
    callToolThrows,
    isError = false,
    listToolsResult = { tools: [] },
    connectThrows,
  } = opts;

  const closeMock = vi.fn().mockResolvedValue(undefined);
  const callToolMock = callToolThrows
    ? vi.fn().mockRejectedValue(callToolThrows)
    : vi.fn().mockResolvedValue({
        content: callToolResult !== undefined ? [makeTextContent(callToolResult)] : [],
        isError,
      });
  const listToolsMock = vi.fn().mockResolvedValue(listToolsResult);
  const connectMock = connectThrows
    ? vi.fn().mockRejectedValue(connectThrows)
    : vi.fn().mockResolvedValue(undefined);

  const instance = {
    connect: connectMock,
    callTool: callToolMock,
    listTools: listToolsMock,
    close: closeMock,
  };

  // biome-ignore lint/complexity/useArrowFunction: required for new-able mock
  const MockClient = vi.fn().mockImplementation(function () {
    return instance;
  });

  // biome-ignore lint/complexity/useArrowFunction: required for new-able mock
  const MockTransport = vi.fn().mockImplementation(function () {
    return {};
  });

  return { MockClient, MockTransport, instance, callToolMock, connectMock, closeMock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMcpToolSource', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tool call success single-atom: expectArray false → 1 atom yielded by iter()', async () => {
    const payload = { id: 1, name: 'hello' };
    const { MockClient, MockTransport } = buildMockClient({ callToolResult: payload });

    vi.doMock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }));
    vi.doMock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
      StreamableHTTPClientTransport: MockTransport,
    }));

    const { createMcpToolSource } = await import('../src/mcp-source.js');

    const schema = z.object({ id: z.number(), name: z.string() });
    const source = createMcpToolSource({
      serverUrl: 'http://localhost:3000/mcp',
      toolName: 'my-tool',
      args: {},
      schema,
      expectArray: false,
    });

    const atoms = [];
    for await (const a of source.iter(undefined, makeCtx())) {
      atoms.push(a);
    }

    expect(atoms).toHaveLength(1);
    expect(atoms[0]?.object).toBe('atom');
    expect(atoms[0]?.data).toEqual(payload);
  });

  it('tool call success multi-atom: expectArray true, result [3 items] → 3 atoms', async () => {
    const items = [{ v: 1 }, { v: 2 }, { v: 3 }];
    const { MockClient, MockTransport } = buildMockClient({ callToolResult: items });

    vi.doMock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }));
    vi.doMock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
      StreamableHTTPClientTransport: MockTransport,
    }));

    const { createMcpToolSource } = await import('../src/mcp-source.js');

    const schema = z.object({ v: z.number() });
    const source = createMcpToolSource({
      serverUrl: 'http://localhost:3000/mcp',
      toolName: 'list-tool',
      args: {},
      schema,
      expectArray: true,
    });

    const atoms = [];
    for await (const a of source.iter(undefined, makeCtx())) {
      atoms.push(a);
    }

    expect(atoms).toHaveLength(3);
    expect(atoms[0]?.data).toEqual({ v: 1 });
    expect(atoms[2]?.data).toEqual({ v: 3 });
  });

  it('result.isError === true → SourceError { type: validation }', async () => {
    const { MockClient, MockTransport } = buildMockClient({ isError: true });

    vi.doMock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }));
    vi.doMock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
      StreamableHTTPClientTransport: MockTransport,
    }));

    const { createMcpToolSource } = await import('../src/mcp-source.js');

    const source = createMcpToolSource({
      serverUrl: 'http://localhost:3000/mcp',
      toolName: 'error-tool',
      args: {},
      schema: z.unknown(),
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('validation');
  });

  it('transport failure (connect throws) → SourceError { type: transient }', async () => {
    const { MockClient, MockTransport } = buildMockClient({
      connectThrows: new Error('ECONNREFUSED'),
    });

    vi.doMock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }));
    vi.doMock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
      StreamableHTTPClientTransport: MockTransport,
    }));

    const { createMcpToolSource } = await import('../src/mcp-source.js');

    const source = createMcpToolSource({
      serverUrl: 'http://localhost:3000/mcp',
      toolName: 'any-tool',
      args: {},
      schema: z.unknown(),
    });

    const result = await source.fetch(undefined, makeCtx());
    expect(result.data).toBeNull();
    expect(result.error?.type).toBe('transient');
  });

  it('fetch() collects all atoms from multi-atom call into array', async () => {
    const items = [{ x: 10 }, { x: 20 }, { x: 30 }, { x: 40 }];
    const { MockClient, MockTransport } = buildMockClient({ callToolResult: items });

    vi.doMock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }));
    vi.doMock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
      StreamableHTTPClientTransport: MockTransport,
    }));

    const { createMcpToolSource } = await import('../src/mcp-source.js');

    const schema = z.object({ x: z.number() });
    const source = createMcpToolSource({
      serverUrl: 'http://localhost:3000/mcp',
      toolName: 'multi-tool',
      args: { filter: 'active' },
      schema,
      expectArray: true,
    });

    const result = await source.fetch({ extra: 'param' }, makeCtx());
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(4);
    expect(result.data?.[3]?.data).toEqual({ x: 40 });
  });

  it('cancellation: ctx.signal.abort() before call → iter exits without calling tool', async () => {
    const { MockClient, MockTransport, instance } = buildMockClient({
      callToolResult: { id: 1 },
    });

    vi.doMock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }));
    vi.doMock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
      StreamableHTTPClientTransport: MockTransport,
    }));

    const { createMcpToolSource } = await import('../src/mcp-source.js');

    const source = createMcpToolSource({
      serverUrl: 'http://localhost:3000/mcp',
      toolName: 'any-tool',
      args: {},
      schema: z.unknown(),
    });

    const ac = new AbortController();
    ac.abort(); // abort immediately before iter starts

    const atoms: unknown[] = [];
    for await (const a of source.iter(undefined, makeCtx(ac.signal))) {
      atoms.push(a);
    }

    expect(atoms).toHaveLength(0);
    expect(instance.callTool).not.toHaveBeenCalled();
  });
});
