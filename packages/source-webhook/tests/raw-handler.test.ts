import { sign } from '@idriszade/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRawHandler } from '../src/handler.js';

const SECRET = 'raw-handler-secret';
const PayloadSchema = z.object({ name: z.string(), amount: z.number() });

type Payload = z.infer<typeof PayloadSchema>;

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
  return new Request('http://localhost/webhooks/raw', {
    method: 'POST',
    body,
    headers,
  });
}

describe('createRawHandler', () => {
  it('valid request — onAtom called with parsed data, 200 returned', async () => {
    const received: Payload[] = [];
    const body = JSON.stringify({ name: 'test', amount: 42 });
    const sig = sign(body, SECRET);

    const res = await createRawHandler(makeRequest(body, sig), {
      secret: SECRET,
      schema: PayloadSchema,
      onAtom: (data) => received.push(data),
    });

    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ name: 'test', amount: 42 });
  });

  it('missing signature header — 400', async () => {
    const body = JSON.stringify({ name: 'test', amount: 1 });
    const res = await createRawHandler(makeRequest(body, null), {
      secret: SECRET,
      schema: PayloadSchema,
      onAtom: () => {},
    });
    expect(res.status).toBe(400);
  });

  it('invalid signature — 400 sig_mismatch', async () => {
    const body = JSON.stringify({ name: 'bad', amount: 0 });
    const badSig = sign(body, 'wrong-secret');
    const res = await createRawHandler(makeRequest(body, badSig), {
      secret: SECRET,
      schema: PayloadSchema,
      onAtom: () => {},
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('sig_mismatch');
  });

  it('schema mismatch — 400 schema_mismatch', async () => {
    const body = JSON.stringify({ unexpected: true });
    const sig = sign(body, SECRET);
    const res = await createRawHandler(makeRequest(body, sig), {
      secret: SECRET,
      schema: PayloadSchema,
      onAtom: () => {},
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('schema_mismatch');
  });

  it('idempotency header — passed to onAtom callback', async () => {
    const keys: Array<string | undefined> = [];
    const body = JSON.stringify({ name: 'idem', amount: 99 });
    const sig = sign(body, SECRET);

    const res = await createRawHandler(makeRequest(body, sig, { 'X-Webhook-Id': 'wh_abc123' }), {
      secret: SECRET,
      schema: PayloadSchema,
      idempotencyHeader: 'X-Webhook-Id',
      onAtom: (_data, key) => keys.push(key),
    });

    expect(res.status).toBe(200);
    expect(keys).toEqual(['wh_abc123']);
  });
});
