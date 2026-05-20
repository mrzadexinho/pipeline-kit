import { createHmac, hkdfSync } from 'node:crypto';
import { evt } from '../ids.js';

export function generateIdempotencyKey(): string {
  return evt();
}

export interface ServeIdempotencyScope {
  runId: string;
  serveAdapterId: string;
  atomId: string;
}

// ---------------------------------------------------------------------------
// HMAC-signed scoped idempotency key (ADR IV-6)
//
// Format: <runId>:<serveAdapterId>:<atomId>:<hmac16>
//   hmac16 = first 16 hex chars of HMAC-SHA256(HKDF(master), scopeStr)
//
// Master key resolution order:
//   1. PK_SIGNING_KEY env var (if set and non-empty)
//   2. Throw — no fallback without a configured signing key
//
// verifyScopedIdempotencyKey is NOT exported: no callers verify today.
// Add when a Serve adapter or middleware needs tamper-check on inbound key.
// ---------------------------------------------------------------------------

/** Module-level derived-key cache: master string → 32-byte Buffer */
const derivedKeyCache = new Map<string, Buffer>();

function getMasterKey(): string {
  const pkKey = process.env.PK_SIGNING_KEY;
  if (pkKey && pkKey.length > 0) {
    return pkKey;
  }

  // No fallback signing key exists in this codebase — throw immediately.
  throw new Error('[@idriszade/core] No signing key configured. Set PK_SIGNING_KEY env var.');
}

function getDerivedKey(master: string): Buffer {
  const cached = derivedKeyCache.get(master);
  if (cached !== undefined) {
    return cached;
  }
  // hkdfSync returns ArrayBuffer in Node 20; wrap in Buffer.
  const raw = hkdfSync(
    'sha256',
    Buffer.from(master, 'utf8'),
    Buffer.alloc(0),
    Buffer.from('pk-idempotency-v1'),
    32,
  );
  const derived = Buffer.from(raw);
  derivedKeyCache.set(master, derived);
  return derived;
}

export function scopedIdempotencyKey(scope: ServeIdempotencyScope): string {
  const { runId, serveAdapterId, atomId } = scope;
  const scopeStr = `${runId}:${serveAdapterId}:${atomId}`;
  const master = getMasterKey();
  const derivedKey = getDerivedKey(master);
  const hmac16 = createHmac('sha256', derivedKey).update(scopeStr).digest('hex').slice(0, 16);
  return `${scopeStr}:${hmac16}`;
}
