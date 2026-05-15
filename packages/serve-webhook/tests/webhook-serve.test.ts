import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { makeCtx } from './helpers.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createWebhookServe', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('Case 1: HMAC sign + POST success — signature header present with v1=', async () => {
    const { createWebhookServe } = await import('../src/webhook-serve.js');
    const serve = createWebhookServe({
      url: 'https://hook.example.com/',
      auth: 'hmac',
      secret: 'shh',
      schema: z.object({ event: z.string() }),
    });

    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const result = await serve.emit({ event: 'user.created' }, makeCtx('idem-key-1'));

    expect(result.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();

    const [, callOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = callOpts.headers as Record<string, string>;
    const sigHeader = headers['X-Pipeline-Kit-Signature'];
    expect(sigHeader).toBeDefined();
    expect(sigHeader).toContain('v1=');
  });

  it('Case 2: bearer auth — Authorization header set correctly', async () => {
    const { createWebhookServe } = await import('../src/webhook-serve.js');
    const serve = createWebhookServe({
      url: 'https://hook.example.com/',
      auth: 'bearer',
      authValue: 'token123',
      schema: z.object({ event: z.string() }),
    });

    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await serve.emit({ event: 'test' }, makeCtx('idem-2'));

    const [, callOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = callOpts.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token123');
  });

  it('Case 3: basic auth — Authorization header base64 encoded', async () => {
    const { createWebhookServe } = await import('../src/webhook-serve.js');
    const serve = createWebhookServe({
      url: 'https://hook.example.com/',
      auth: 'basic',
      authValue: 'user:pass',
      schema: z.object({ event: z.string() }),
    });

    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await serve.emit({ event: 'test' }, makeCtx('idem-3'));

    const [, callOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = callOpts.headers as Record<string, string>;
    // btoa('user:pass') === 'dXNlcjpwYXNz'
    expect(headers.Authorization).toBe('Basic dXNlcjpwYXNz');
  });

  it('Case 4: 5xx response → transient error', async () => {
    const { createWebhookServe } = await import('../src/webhook-serve.js');
    const serve = createWebhookServe({
      url: 'https://hook.example.com/',
      auth: 'none',
      schema: z.object({ event: z.string() }),
    });

    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const result = await serve.emit({ event: 'test' }, makeCtx('idem-4'));

    expect(result.error?.type).toBe('transient');
  });

  it('Case 5: 401 response → auth error', async () => {
    const { createWebhookServe } = await import('../src/webhook-serve.js');
    const serve = createWebhookServe({
      url: 'https://hook.example.com/',
      auth: 'none',
      schema: z.object({ event: z.string() }),
    });

    fetchMock.mockResolvedValue({ ok: false, status: 401 });

    const result = await serve.emit({ event: 'test' }, makeCtx('idem-5'));

    expect(result.error?.type).toBe('auth');
  });

  it('Case 6: 429 response → rate_limited error', async () => {
    const { createWebhookServe } = await import('../src/webhook-serve.js');
    const serve = createWebhookServe({
      url: 'https://hook.example.com/',
      auth: 'none',
      schema: z.object({ event: z.string() }),
    });

    fetchMock.mockResolvedValue({ ok: false, status: 429 });

    const result = await serve.emit({ event: 'test' }, makeCtx('idem-6'));

    expect(result.error?.type).toBe('rate_limited');
  });

  it('Case 7: apiKey auth — custom header set correctly', async () => {
    const { createWebhookServe } = await import('../src/webhook-serve.js');
    const serve = createWebhookServe({
      url: 'https://hook.example.com/',
      auth: 'apiKey',
      authValue: 'my-api-key',
      schema: z.object({ event: z.string() }),
    });

    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await serve.emit({ event: 'test' }, makeCtx('idem-7'));

    const [, callOpts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = callOpts.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('my-api-key');
  });

  it('Case 8: 403 response → auth error', async () => {
    const { createWebhookServe } = await import('../src/webhook-serve.js');
    const serve = createWebhookServe({
      url: 'https://hook.example.com/',
      auth: 'none',
      schema: z.object({ event: z.string() }),
    });

    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    const result = await serve.emit({ event: 'test' }, makeCtx('idem-8'));

    expect(result.error?.type).toBe('auth');
  });

  it('Case 9: 422 response → validation (4xx client) error', async () => {
    const { createWebhookServe } = await import('../src/webhook-serve.js');
    const serve = createWebhookServe({
      url: 'https://hook.example.com/',
      auth: 'none',
      schema: z.object({ event: z.string() }),
    });

    fetchMock.mockResolvedValue({ ok: false, status: 422 });

    const result = await serve.emit({ event: 'test' }, makeCtx('idem-9'));

    expect(result.error?.type).toBe('validation');
    expect(result.error?.code).toBe('webhook_client_error');
  });

  it('Case 10: network error (fetch throws) → network error', async () => {
    const { createWebhookServe } = await import('../src/webhook-serve.js');
    const serve = createWebhookServe({
      url: 'https://hook.example.com/',
      auth: 'none',
      schema: z.object({ event: z.string() }),
    });

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await serve.emit({ event: 'test' }, makeCtx('idem-10'));

    expect(result.error?.type).toBe('network');
    expect(result.error?.code).toBe('webhook_network_error');
  });

  it('Case 11: returns validation error when ctx.idempotencyKey is missing', async () => {
    const { createWebhookServe } = await import('../src/webhook-serve.js');
    const serve = createWebhookServe({
      url: 'https://hook.example.com/',
      auth: 'hmac',
      secret: 's',
      schema: z.object({ event: z.string() }),
    });

    const result = await serve.emit({ event: 'x' }, makeCtx()); // no idempotencyKey

    expect(result.error?.code).toBe('idempotency_key_required');
    expect(result.error?.type).toBe('validation');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
