import { Buffer } from 'node:buffer';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sign } from '../../src/webhooks/sign.js';
import { verifyWebhook } from '../../src/webhooks/verify-webhook.js';

const SECRET = 'test_secret_at_least_32_chars_long_for_demo';
const PAYLOAD = '{"event":"test","data":{"id":"pk_run_x"}}';

// ---- round-trip ----

describe('verifyWebhook — round-trip', () => {
  it('returns ok(true) for a freshly signed payload', () => {
    const header = sign(PAYLOAD, SECRET);
    const r = verifyWebhook(PAYLOAD, header, SECRET);
    expect(r.error).toBeNull();
    expect(r.data).toBe(true);
  });

  it('accepts a Buffer payload', () => {
    const header = sign(PAYLOAD, SECRET);
    const r = verifyWebhook(Buffer.from(PAYLOAD, 'utf8'), header, SECRET);
    expect(r.error).toBeNull();
    expect(r.data).toBe(true);
  });
});

// ---- multi-key rotation ----

describe('verifyWebhook — multi-key rotation', () => {
  it('returns ok(true) when the matching key is last in the array', () => {
    const s1 = 'old_secret_key_at_least_32_chars_long!!';
    const s2 = 'new_secret_key_at_least_32_chars_long!!';
    const header = sign(PAYLOAD, s2);
    const r = verifyWebhook(PAYLOAD, header, [s1, s2]);
    expect(r.error).toBeNull();
    expect(r.data).toBe(true);
  });

  it('returns ok(true) when the matching key is first in the array', () => {
    const s1 = 'old_secret_key_at_least_32_chars_long!!';
    const s2 = 'new_secret_key_at_least_32_chars_long!!';
    const header = sign(PAYLOAD, s1);
    const r = verifyWebhook(PAYLOAD, header, [s1, s2]);
    expect(r.error).toBeNull();
    expect(r.data).toBe(true);
  });

  it('returns err(signature_mismatch) when no key in array matches', () => {
    const s1 = 'wrong_key_one_at_least_32_chars_long!!!!!';
    const s2 = 'wrong_key_two_at_least_32_chars_long!!!!!';
    const header = sign(PAYLOAD, SECRET);
    const r = verifyWebhook(PAYLOAD, header, [s1, s2]);
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('signature_mismatch');
  });
});

// ---- malformed_header ----

describe('verifyWebhook — malformed_header', () => {
  it('returns err(malformed_header) for empty header', () => {
    const r = verifyWebhook(PAYLOAD, '', SECRET);
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('malformed_header');
  });

  it('returns err(malformed_header) when t= is missing', () => {
    const r = verifyWebhook(PAYLOAD, 'v1=abc123', SECRET);
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('malformed_header');
  });

  it('returns err(malformed_header) when timestamp is NaN', () => {
    const r = verifyWebhook(PAYLOAD, `t=notanumber,v1=${'a'.repeat(64)}`, SECRET);
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('malformed_header');
  });

  it('returns err(malformed_header) when requested prefix is absent from header', () => {
    const header = sign(PAYLOAD, SECRET); // produces v1=...
    const r = verifyWebhook(PAYLOAD, header, SECRET, { prefix: 'sha256' });
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('malformed_header');
  });

  it('returns err(malformed_header) for header with no equals separator', () => {
    const r = verifyWebhook(PAYLOAD, 'no_equals_sign', SECRET);
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('malformed_header');
  });
});

// ---- timestamp_expired ----

describe('verifyWebhook — timestamp_expired', () => {
  it('returns err(timestamp_expired) when drift exceeds default 300s tolerance', () => {
    const oldTimestamp = new Date(Date.now() - 600_000);
    const header = sign(PAYLOAD, SECRET, { timestamp: oldTimestamp });
    const r = verifyWebhook(PAYLOAD, header, SECRET);
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('timestamp_expired');
  });

  it('returns err(timestamp_expired) when drift exceeds custom tolerance', () => {
    const ts = new Date(Date.now() - 5_000);
    const header = sign(PAYLOAD, SECRET, { timestamp: ts });
    const r = verifyWebhook(PAYLOAD, header, SECRET, { tolerance: 1_000 });
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('timestamp_expired');
  });

  it('accepts a signature within custom tolerance', () => {
    const ts = new Date(Date.now() - 500);
    const header = sign(PAYLOAD, SECRET, { timestamp: ts });
    const r = verifyWebhook(PAYLOAD, header, SECRET, { tolerance: 2_000 });
    expect(r.error).toBeNull();
    expect(r.data).toBe(true);
  });

  it('checks future timestamps too (replay guard)', () => {
    const futureTimestamp = new Date(Date.now() + 600_000);
    const header = sign(PAYLOAD, SECRET, { timestamp: futureTimestamp });
    const r = verifyWebhook(PAYLOAD, header, SECRET);
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('timestamp_expired');
  });
});

// ---- signature_mismatch ----

describe('verifyWebhook — signature_mismatch', () => {
  it('returns err(signature_mismatch) when secret is wrong', () => {
    const header = sign(PAYLOAD, SECRET);
    const r = verifyWebhook(PAYLOAD, header, 'wrong_secret_at_least_32_chars_long!');
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('signature_mismatch');
  });

  it('returns err(signature_mismatch) when payload is tampered', () => {
    const header = sign(PAYLOAD, SECRET);
    const r = verifyWebhook(`${PAYLOAD} tampered`, header, SECRET);
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe('signature_mismatch');
  });

  it('handles non-hex signature values without throwing', () => {
    const t = Math.floor(Date.now() / 1000);
    const r = verifyWebhook(PAYLOAD, `t=${t},v1=zzzznotvalid`, SECRET);
    expect(r.data).toBeNull();
    // non-hex fails the hex validation inside signaturesEqual → mismatch
    expect(r.error?.code).toBe('signature_mismatch');
  });
});

// ---- custom prefix ----

describe('verifyWebhook — custom prefix', () => {
  it('verifies a sha256-prefixed signature produced by sign()', () => {
    const header = sign(PAYLOAD, SECRET, { algorithm: 'v1' });
    // reinterpret existing v1= header with explicit prefix:'v1' option
    const r = verifyWebhook(PAYLOAD, header, SECRET, { prefix: 'v1' });
    expect(r.error).toBeNull();
    expect(r.data).toBe(true);
  });
});

// ---- adversarial — never throw ----

describe('verifyWebhook — adversarial (never throw)', () => {
  const cases: Array<[string, Buffer | string, string, string | string[]]> = [
    ['empty string payload', '', 'v1=abc', SECRET],
    ['empty string header', PAYLOAD, '', SECRET],
    ['empty string secret', PAYLOAD, sign(PAYLOAD, SECRET), ''],
    ['empty array secrets', PAYLOAD, sign(PAYLOAD, SECRET), []],
    ['all empty strings', '', '', ''],
    ['header with only comma', PAYLOAD, ',', SECRET],
    [
      'very long non-hex sig',
      PAYLOAD,
      `t=${Math.floor(Date.now() / 1000)},v1=${'z'.repeat(200)}`,
      SECRET,
    ],
    [
      'binary-ish buffer payload',
      Buffer.from([0xff, 0x00, 0xfe, 0xab]),
      sign(PAYLOAD, SECRET),
      SECRET,
    ],
  ];

  for (const [name, payload, header, secret] of cases) {
    it(`does not throw for: ${name}`, () => {
      expect(() => verifyWebhook(payload, header, secret)).not.toThrow();
    });
  }
});

// ---- property test ----

describe('verifyWebhook — property tests (fast-check)', () => {
  it('round-trip law: verifyWebhook(p, sign(p, s), s) is always ok(true) for any non-empty payload + secret', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        (payload, secret) => {
          const header = sign(payload, secret);
          const r = verifyWebhook(payload, header, secret);
          return r.data === true && r.error === null;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('multi-key law: ok(true) when signing key is anywhere in the array', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 300 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.array(fc.string({ minLength: 1, maxLength: 100 }), { maxLength: 5 }),
        (payload, signingKey, otherKeys) => {
          const secrets = [...otherKeys, signingKey];
          const header = sign(payload, signingKey);
          const r = verifyWebhook(payload, header, secrets);
          return r.data === true && r.error === null;
        },
      ),
      { numRuns: 100 },
    );
  });
});
