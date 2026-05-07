import { sign } from '@pipeline-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createWebhookSource } from '../src/webhook-source.js';

const SECRET = 'test-secret-key';
const PATH = '/webhooks/test';
const EventSchema = z.object({ event: z.string(), payload: z.unknown() });

type TestEvent = z.infer<typeof EventSchema>;

function makeRequest(
  body: string,
  sigHeader: string | null,
  extraHeaders?: Record<string, string>,
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sigHeader !== null) {
    headers['X-Pipeline-Kit-Signature'] = sigHeader;
  }
  if (extraHeaders) {
    Object.assign(headers, extraHeaders);
  }
  return new Request(`http://localhost${PATH}`, {
    method: 'POST',
    body,
    headers,
  });
}

function validSignature(body: string): string {
  return sign(body, SECRET);
}

function expiredSignature(body: string): string {
  // Use a timestamp far in the past (> 5 min tolerance)
  const oldDate = new Date(Date.now() - 10 * 60 * 1000);
  return sign(body, SECRET, { timestamp: oldDate });
}

describe('createWebhookSource — HTTP handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('valid HMAC signature — atom buffered, 200 response', async () => {
    const source = createWebhookSource<TestEvent>({
      path: PATH,
      secret: SECRET,
      schema: EventSchema,
    });

    const body = JSON.stringify({ event: 'order.created', payload: { id: 1 } });
    const sig = validSignature(body);
    const req = makeRequest(body, sig);

    const res = await source.app.fetch(req);
    expect(res.status).toBe(200);

    // Verify atom is in buffer
    const fetchResult = await source.fetch(undefined, {
      runId: 'pk_run_test',
      pipelineId: 'pk_pipe_test',
      attempt: 1,
      metadata: {},
      signal: new AbortController().signal,
      trace: {} as never,
      attachMetadata: () => {},
    });
    expect(fetchResult.error).toBeNull();
    expect(fetchResult.data).toHaveLength(1);
    expect(fetchResult.data?.[0]?.object).toBe('atom');
    expect(fetchResult.data?.[0]?.data).toEqual({ event: 'order.created', payload: { id: 1 } });
  });

  it('invalid signature — 400, buffer unchanged', async () => {
    const source = createWebhookSource<TestEvent>({
      path: PATH,
      secret: SECRET,
      schema: EventSchema,
    });

    const body = JSON.stringify({ event: 'order.created', payload: {} });
    // Use wrong secret for signature
    const badSig = sign(body, 'wrong-secret');
    const req = makeRequest(body, badSig);

    const res = await source.app.fetch(req);
    expect(res.status).toBe(400);

    const resBody = (await res.json()) as { error: { code: string } };
    expect(resBody.error.code).toBe('sig_mismatch');

    // Buffer should be empty
    const fetchResult = await source.fetch(undefined, {
      runId: 'pk_run_test',
      pipelineId: 'pk_pipe_test',
      attempt: 1,
      metadata: {},
      signal: new AbortController().signal,
      trace: {} as never,
      attachMetadata: () => {},
    });
    expect(fetchResult.data).toHaveLength(0);
  });

  it('expired timestamp — 400 response', async () => {
    const source = createWebhookSource<TestEvent>({
      path: PATH,
      secret: SECRET,
      schema: EventSchema,
    });

    const body = JSON.stringify({ event: 'order.created', payload: {} });
    const expiredSig = expiredSignature(body);
    const req = makeRequest(body, expiredSig);

    const res = await source.app.fetch(req);
    expect(res.status).toBe(400);

    const resBody = (await res.json()) as { error: { code: string } };
    expect(resBody.error.code).toBe('tolerance_exceeded');
  });

  it('missing signature header — 400 response', async () => {
    const source = createWebhookSource<TestEvent>({
      path: PATH,
      secret: SECRET,
      schema: EventSchema,
    });

    const body = JSON.stringify({ event: 'order.created', payload: {} });
    const req = makeRequest(body, null);

    const res = await source.app.fetch(req);
    expect(res.status).toBe(400);

    const resBody = (await res.json()) as { error: { code: string } };
    expect(resBody.error.code).toBe('missing_signature');
  });

  it('valid signature + schema parse failure — 400 with validation error', async () => {
    const source = createWebhookSource<TestEvent>({
      path: PATH,
      secret: SECRET,
      schema: EventSchema,
    });

    // Body is valid JSON but does not match EventSchema (missing 'event' field)
    const body = JSON.stringify({ not_event: 'nope' });
    const sig = validSignature(body);
    const req = makeRequest(body, sig);

    const res = await source.app.fetch(req);
    expect(res.status).toBe(400);

    const resBody = (await res.json()) as { error: { code: string } };
    expect(resBody.error.code).toBe('schema_mismatch');

    // Buffer should be empty
    const fetchResult = await source.fetch(undefined, {
      runId: 'pk_run_test',
      pipelineId: 'pk_pipe_test',
      attempt: 1,
      metadata: {},
      signal: new AbortController().signal,
      trace: {} as never,
      attachMetadata: () => {},
    });
    expect(fetchResult.data).toHaveLength(0);
  });

  it('idempotency header — atom metadata contains idempotency_key', async () => {
    const source = createWebhookSource<TestEvent>({
      path: PATH,
      secret: SECRET,
      schema: EventSchema,
      idempotencyHeader: 'X-Webhook-Id',
    });

    const body = JSON.stringify({ event: 'order.created', payload: {} });
    const sig = validSignature(body);
    const req = makeRequest(body, sig, { 'X-Webhook-Id': 'wh_unique_123' });

    const res = await source.app.fetch(req);
    expect(res.status).toBe(200);

    const fetchResult = await source.fetch(undefined, {
      runId: 'pk_run_test',
      pipelineId: 'pk_pipe_test',
      attempt: 1,
      metadata: {},
      signal: new AbortController().signal,
      trace: {} as never,
      attachMetadata: () => {},
    });
    expect(fetchResult.data?.[0]?.metadata).toEqual({ idempotency_key: 'wh_unique_123' });
  });
});
