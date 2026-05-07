import { describe, expect, it } from 'vitest';
import { sign } from '../src/webhooks/sign.js';
import type { PipelineKitEvent } from '../src/webhooks/types.js';
import { verify } from '../src/webhooks/verify.js';

const SECRET = 'test_secret_at_least_32_chars_long_for_demo';

const eventBody = (event: PipelineKitEvent): string => JSON.stringify(event);

const sampleEvent: PipelineKitEvent = {
  type: 'pipeline.run.created',
  data: {
    run_id: 'pk_run_x',
    pipeline_id: 'pk_pipe_x',
    created_at: '2026-05-06T00:00:00.000Z',
  },
};

describe('webhooks.sign', () => {
  it('returns t=<unix>,v1=<hex> shaped header value with default options', () => {
    const value = sign('payload', SECRET);
    expect(value).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('uses provided algorithm tag when v2 is requested', () => {
    const value = sign('payload', SECRET, { algorithm: 'v2' });
    expect(value).toMatch(/^t=\d+,v2=[0-9a-f]{64}$/);
  });

  it('encodes the provided timestamp deterministically', () => {
    const ts = new Date('2026-01-01T00:00:00.000Z');
    const value = sign('payload', SECRET, { timestamp: ts });
    const expectedT = Math.floor(ts.getTime() / 1000);
    expect(value.startsWith(`t=${expectedT},`)).toBe(true);
  });

  it('produces stable hex for stable (payload, secret, timestamp) tuples', () => {
    const ts = new Date('2026-01-01T00:00:00.000Z');
    const a = sign('payload', SECRET, { timestamp: ts });
    const b = sign('payload', SECRET, { timestamp: ts });
    expect(a).toBe(b);
  });
});

describe('webhooks.verify — round-trip', () => {
  it('verifies a freshly-signed payload and returns the parsed event', () => {
    const body = eventBody(sampleEvent);
    const sig = sign(body, SECRET);
    const r = verify(body, sig, SECRET);
    expect(r.error).toBeNull();
    expect(r.data?.type).toBe('pipeline.run.created');
  });

  it('verifies a v2-signed payload when v2 is in acceptedAlgorithms', () => {
    const body = eventBody(sampleEvent);
    const sig = sign(body, SECRET, { algorithm: 'v2' });
    const r = verify(body, sig, SECRET, { acceptedAlgorithms: ['v2'] });
    expect(r.error).toBeNull();
  });

  it('verifies a header containing both v1 and v2 signatures', () => {
    const body = eventBody(sampleEvent);
    const t = Math.floor(Date.now() / 1000);
    const v1Sig = sign(body, SECRET, { timestamp: new Date(t * 1000), algorithm: 'v1' });
    const v2HexMatch = v1Sig.match(/v1=([0-9a-f]{64})/);
    expect(v2HexMatch).not.toBeNull();
    const v1Hex = v2HexMatch?.[1] ?? '';
    const fakeV2Hex = 'a'.repeat(64);
    const combined = `t=${t},v1=${v1Hex},v2=${fakeV2Hex}`;
    const r = verify(body, combined, SECRET, { acceptedAlgorithms: ['v1', 'v2'] });
    expect(r.error).toBeNull();
  });
});

describe('webhooks.verify — failure modes', () => {
  it('rejects an empty secret with missing_secret', () => {
    const body = eventBody(sampleEvent);
    const sig = sign(body, SECRET);
    const r = verify(body, sig, '');
    expect(r.error?.type).toBe('missing_secret');
  });

  it('rejects a malformed header (no t=)', () => {
    const r = verify('body', 'v1=abc', SECRET);
    expect(r.error?.type).toBe('malformed_header');
  });

  it('rejects header missing equals separator', () => {
    const r = verify('body', 'no_equals_sign', SECRET);
    expect(r.error?.type).toBe('malformed_header');
  });

  it('rejects expired timestamp outside default 5-min tolerance (replay protection)', () => {
    const body = eventBody(sampleEvent);
    const oldTimestamp = new Date(Date.now() - 600_000);
    const sig = sign(body, SECRET, { timestamp: oldTimestamp });
    const r = verify(body, sig, SECRET);
    expect(r.error?.type).toBe('expired_timestamp');
  });

  it('rejects when no provided signature matches accepted algorithms', () => {
    const body = eventBody(sampleEvent);
    const sig = sign(body, SECRET, { algorithm: 'v1' });
    const r = verify(body, sig, SECRET, { acceptedAlgorithms: ['v2'] });
    expect(r.error?.type).toBe('invalid_signature');
  });

  it('rejects when secret does not match (constant-time compare)', () => {
    const body = eventBody(sampleEvent);
    const sig = sign(body, SECRET);
    const r = verify(body, sig, 'wrong_secret');
    expect(r.error?.type).toBe('invalid_signature');
  });

  it('rejects when payload mutates after signing (signature mismatch)', () => {
    const body = eventBody(sampleEvent);
    const sig = sign(body, SECRET);
    const r = verify(`${body} tampered`, sig, SECRET);
    expect(r.error?.type).toBe('invalid_signature');
  });

  it('rejects malformed JSON body even when signature matches', () => {
    const tampered = '{not-json}';
    const sig = sign(tampered, SECRET);
    const r = verify(tampered, sig, SECRET);
    expect(r.error?.type).toBe('invalid_payload');
    expect(r.error?.code).toBe('json_parse');
  });

  it('rejects unknown event type', () => {
    const body = JSON.stringify({ type: 'unknown.event', data: {} });
    const sig = sign(body, SECRET);
    const r = verify(body, sig, SECRET);
    expect(r.error?.type).toBe('invalid_payload');
    expect(r.error?.code).toBe('unknown_event');
  });

  it('rejects non-hex provided signature values', () => {
    const t = Math.floor(Date.now() / 1000);
    const r = verify(eventBody(sampleEvent), `t=${t},v1=zzzz`, SECRET);
    expect(r.error?.type).toBe('invalid_signature');
  });

  it('rejects invalid timestamp value (NaN)', () => {
    const r = verify(eventBody(sampleEvent), `t=notanumber,v1=${'a'.repeat(64)}`, SECRET);
    expect(r.error?.type).toBe('malformed_header');
  });

  it('respects custom tolerance window', () => {
    const body = eventBody(sampleEvent);
    const ts = new Date(Date.now() - 1000);
    const sig = sign(body, SECRET, { timestamp: ts });
    const r = verify(body, sig, SECRET, { tolerance: 100 });
    expect(r.error?.type).toBe('expired_timestamp');
  });
});

describe('webhooks namespace', () => {
  it('webhooks.sign and webhooks.verify mirror standalone exports', async () => {
    const { webhooks } = await import('../src/webhooks/index.js');
    expect(webhooks.sign).toBe(sign);
    expect(webhooks.verify).toBe(verify);
  });
});
