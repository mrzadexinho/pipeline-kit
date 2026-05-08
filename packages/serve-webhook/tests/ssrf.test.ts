import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createWebhookServe } from '../src/webhook-serve.js';
import { makeCtx } from './helpers.js';

const eventSchema = z.object({ event: z.string() });

// ---------------------------------------------------------------------------
// SSRF Tests
// ---------------------------------------------------------------------------

describe('SSRF guard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('Case 1: private IP (192.168.x.x) is rejected with ssrf_blocked', async () => {
    const serve = createWebhookServe({
      url: 'http://192.168.1.100/hook',
      auth: 'none',
      schema: eventSchema,
      ssrf: { enabled: true },
    });

    const result = await serve.emit({ event: 'test' }, makeCtx('idem-ssrf-1'));

    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('ssrf_blocked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Case 2: loopback IP (127.0.0.1) is rejected with ssrf_blocked', async () => {
    const serve = createWebhookServe({
      url: 'http://127.0.0.1/hook',
      auth: 'none',
      schema: eventSchema,
      ssrf: { enabled: true },
    });

    const result = await serve.emit({ event: 'test' }, makeCtx('idem-ssrf-2'));

    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('ssrf_blocked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Case 3: public IP (93.184.216.34) proceeds — fetch is called', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const serve = createWebhookServe({
      url: 'http://93.184.216.34/hook',
      auth: 'none',
      schema: eventSchema,
      ssrf: { enabled: true },
    });

    const result = await serve.emit({ event: 'test' }, makeCtx('idem-ssrf-3'));

    expect(result.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
