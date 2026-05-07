import { sign } from '@pipeline-kit/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createWebhookSource } from '../src/webhook-source.js';

const SECRET = 'integration-test-secret';
const PATH = '/webhooks/integration';
const PayloadSchema = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) });

function makeSignedRequest(body: string, extraHeaders?: Record<string, string>): Request {
  const sig = sign(body, SECRET);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Pipeline-Kit-Signature': sig,
    ...extraHeaders,
  };
  return new Request(`http://localhost${PATH}`, {
    method: 'POST',
    body,
    headers,
  });
}

describe('Hono integration', () => {
  it('app.fetch() with a valid Request returns 200 and buffered atom', async () => {
    const source = createWebhookSource({
      path: PATH,
      secret: SECRET,
      schema: PayloadSchema,
    });

    const body = JSON.stringify({ type: 'user.signup', data: { email: 'hello@example.com' } });
    const req = makeSignedRequest(body);

    const res = await source.app.fetch(req);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { object: string; id: string };
    expect(json.object).toBe('atom');
    expect(typeof json.id).toBe('string');
    expect(json.id).toMatch(/^pk_atom_/);
  });

  it('handler() raw call works identically to app.fetch()', async () => {
    const source = createWebhookSource({
      path: PATH,
      secret: SECRET,
      schema: PayloadSchema,
    });

    const body = JSON.stringify({ type: 'payment.succeeded', data: { amount: 9900 } });
    const req1 = makeSignedRequest(body);
    const req2 = makeSignedRequest(body);

    const resFromApp = await source.app.fetch(req1);
    const resFromHandler = await source.handler(req2);

    expect(resFromApp.status).toBe(resFromHandler.status);

    const json1 = (await resFromApp.json()) as { object: string };
    const json2 = (await resFromHandler.json()) as { object: string };

    expect(json1.object).toBe('atom');
    expect(json2.object).toBe('atom');
  });
});
