import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createMcpToolServe } from '../src/mcp-tool-serve.js';
import { makeMockPipeline } from './helpers.js';

describe('McpToolServe — toolRegistration', () => {
  it('case 1: tool registration shape', () => {
    const inputSchema = z.object({ name: z.string() });
    const outputSchema = z.object({ greeting: z.string() });
    const pipeline = makeMockPipeline<{ greeting: string }>({
      output: { greeting: 'hello world' },
    });

    const serve = createMcpToolServe({
      toolName: 'echo_tool',
      description: 'Echo a name back as a greeting',
      inputSchema,
      outputSchema,
      pipeline,
    });

    expect(serve.toolRegistration.name).toBe('echo_tool');
    expect(serve.toolRegistration.description).toBe('Echo a name back as a greeting');
    expect(typeof serve.toolRegistration.inputSchema).toBe('object');
    expect(typeof serve.toolRegistration.handler).toBe('function');
    expect(serve.idempotencySupport).toBe('unsupported');
  });

  it('case 2: tool invocation success returns serialized output', async () => {
    const inputSchema = z.object({ name: z.string() });
    const outputSchema = z.object({ greeting: z.string() });
    const pipeline = makeMockPipeline<{ greeting: string }>({
      output: { greeting: 'hello' },
    });

    const serve = createMcpToolServe({
      toolName: 'echo',
      description: 'Echo tool',
      inputSchema,
      outputSchema,
      pipeline,
    });

    const response = await serve.toolRegistration.handler({ name: 'world' });

    expect(response.isError).toBeFalsy();
    expect(response.content).toHaveLength(1);
    expect(response.content[0]?.type).toBe('text');
    expect(response.content[0]?.text).toContain('hello');
    expect(response.content[0]?.text).toContain('greeting');
  });

  it('case 3: tool invocation with pipeline error reports isError', async () => {
    const inputSchema = z.object({ name: z.string() });
    const outputSchema = z.object({ greeting: z.string() });
    const pipeline = makeMockPipeline<{ greeting: string }>({
      error: { message: 'pipeline failed', code: 'unknown' },
    });

    const serve = createMcpToolServe({
      toolName: 'echo',
      description: 'Echo tool',
      inputSchema,
      outputSchema,
      pipeline,
    });

    const response = await serve.toolRegistration.handler({ name: 'world' });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toMatch(/pipeline failed/i);
  });

  it('case 4: schema validation rejects bad input', async () => {
    const inputSchema = z.object({ name: z.string() });
    const outputSchema = z.object({ greeting: z.string() });
    const pipeline = makeMockPipeline<{ greeting: string }>({
      output: { greeting: 'unused' },
    });

    const serve = createMcpToolServe({
      toolName: 'echo',
      description: 'Echo tool',
      inputSchema,
      outputSchema,
      pipeline,
    });

    const response = await serve.toolRegistration.handler({ name: 123 });

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toMatch(/Invalid input/);
  });

  it('case 5: auto-derived JSON schema reflects zod input shape', () => {
    const inputSchema = z.object({
      name: z.string(),
      age: z.number().optional(),
    });
    const outputSchema = z.object({ ok: z.boolean() });
    const pipeline = makeMockPipeline<{ ok: boolean }>({ output: { ok: true } });

    const serve = createMcpToolServe({
      toolName: 'demo',
      description: 'Demo tool',
      inputSchema,
      outputSchema,
      pipeline,
    });

    const jsonSchema = serve.toolRegistration.inputSchema;
    expect(jsonSchema['type']).toBe('object');
    expect('properties' in jsonSchema).toBe(true);
    const props = jsonSchema['properties'] as Record<string, unknown>;
    expect(props['name']).toBeDefined();
    expect(props['age']).toBeDefined();
  });
});
