/**
 * Cat VI Spike #3 — probe-reconstruction.ts
 *
 * Cat VIII cf #8: non-re-readable resources — adapter reconstruction.
 *
 * Scenario: An adapter holds a pre-signed S3 URL (expires in 15 min).
 * Pipeline runs for 20 min. Mid-run, the URL expires. Who reconstructs?
 *
 * Three options:
 *   A: Adapter internally reconnects (adapter owns its lifecycle)
 *   B: Composer detects stale + triggers adapter.reconstruct() (new mechanism)
 *   C: Stage returns Result.err({ code: "resource_stale" }) → Composer retries
 *      with fresh adapter (existing retry semantics; no new mechanism)
 *
 * Key distinction: Cat VIII version-aware-resolver handles RE-READABLE secrets
 * (can re-resolve name → new value). Pre-signed URLs, HTTP/2 streams, and
 * WebSocket connections are NOT re-readable — the resource IS the connection.
 *
 * Question: does reconstruction need a new Composer mechanism, or do existing
 * retry semantics + adapter-internal reconnection handle it?
 */

import { type Result, ok, err } from './types.js';

// =============================================================================
// Shared types for this probe
// =============================================================================

interface ResourceError { type: 'resource_error'; code: string; message: string; }

/** Simulated pre-signed URL resource — expires after a TTL */
interface PreSignedUrlResource {
  url: string;
  expiresAt: number; // ms timestamp
  isExpired(): boolean;
  fetchData(key: string): Promise<Result<string, ResourceError>>;
}

/** Adapter wrapping a non-re-readable resource */
interface PreSignedAdapter {
  fetch(key: string): Promise<Result<string, ResourceError>>;
}

// =============================================================================
// Mock: resource factory (simulates re-signing from auth service)
// =============================================================================

let signCount = 0;
function createPreSignedUrl(ttlMs: number): PreSignedUrlResource {
  signCount++;
  const url = `https://s3.example.com/bucket/key?X-Signature=sig${signCount}&expires=${Date.now() + ttlMs}`;
  const expiresAt = Date.now() + ttlMs;
  return {
    url,
    expiresAt,
    isExpired() { return Date.now() > this.expiresAt; },
    async fetchData(key: string): Promise<Result<string, ResourceError>> {
      if (this.isExpired()) {
        return err({ type: 'resource_error', code: 'resource_expired', message: `URL expired: ${this.url}` });
      }
      return ok(`data-for-${key}-via-${this.url.slice(0, 40)}`);
    },
  };
}

// =============================================================================
// Option A — Adapter internally reconnects
// =============================================================================

function createAdapterA(initialTtlMs: number): PreSignedAdapter {
  let resource = createPreSignedUrl(initialTtlMs);

  return {
    async fetch(key: string): Promise<Result<string, ResourceError>> {
      // Adapter self-heals: if expired, re-sign internally
      if (resource.isExpired()) {
        console.log('  [adapter-A] resource expired — re-signing internally');
        resource = createPreSignedUrl(60_000); // fresh 60s TTL
      }
      return resource.fetchData(key);
    },
  };
}

// =============================================================================
// Option B — reconstruct() hook (new Composer mechanism)
// =============================================================================

interface ReconstructableAdapter extends PreSignedAdapter {
  reconstruct(): Promise<void>;
  isStale(): boolean;
}

function createAdapterB(initialTtlMs: number): ReconstructableAdapter {
  let resource = createPreSignedUrl(initialTtlMs);
  return {
    isStale() { return resource.isExpired(); },
    async reconstruct() {
      console.log('  [adapter-B] Composer triggered reconstruct() — re-signing');
      resource = createPreSignedUrl(60_000);
    },
    async fetch(key: string): Promise<Result<string, ResourceError>> {
      return resource.fetchData(key);
    },
  };
}

/** Simulated Composer with reconstruct() awareness */
async function composerRunWithReconstruct(
  adapter: ReconstructableAdapter,
  keys: string[]
): Promise<Array<Result<string, ResourceError>>> {
  const results: Array<Result<string, ResourceError>> = [];
  for (const key of keys) {
    if (adapter.isStale()) {
      await adapter.reconstruct();
    }
    results.push(await adapter.fetch(key));
  }
  return results;
}

// =============================================================================
// Option C — Result.err({ code: "resource_stale" }) → Composer retries
// =============================================================================

interface RetryableAdapter extends PreSignedAdapter {
  refresh(): Promise<void>;
}

function createAdapterC(initialTtlMs: number): RetryableAdapter {
  let resource = createPreSignedUrl(initialTtlMs);
  return {
    async refresh() {
      console.log('  [adapter-C] refreshing resource after resource_expired error');
      resource = createPreSignedUrl(60_000);
    },
    async fetch(key: string): Promise<Result<string, ResourceError>> {
      return resource.fetchData(key);
    },
  };
}

/** Composer retry loop — existing retry semantics handle resource_expired */
async function composerRunWithRetry(
  adapter: RetryableAdapter,
  keys: string[],
  maxRetries = 2
): Promise<Array<Result<string, ResourceError>>> {
  const results: Array<Result<string, ResourceError>> = [];
  for (const key of keys) {
    let attempt = 0;
    let result: Result<string, ResourceError>;
    do {
      result = await adapter.fetch(key);
      if (result.error?.code === 'resource_expired' && attempt < maxRetries) {
        await adapter.refresh();
        attempt++;
        continue;
      }
      break;
    } while (true);
    results.push(result);
  }
  return results;
}

// =============================================================================
// Probe runner
// =============================================================================

function section(title: string): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'─'.repeat(60)}`);
}

async function probeOptionA(): Promise<void> {
  section('Option A — Adapter internal reconnect');
  signCount = 0;
  const adapter = createAdapterA(10); // 10ms TTL — expires immediately on probe

  await new Promise(r => setTimeout(r, 20)); // let it expire

  const keys = ['key-1', 'key-2', 'key-3'];
  const results: string[] = [];
  for (const key of keys) {
    const r = await adapter.fetch(key);
    results.push(r.error === null ? `ok(${r.data.slice(0, 20)}...)` : `err(${r.error.code})`);
  }

  console.log('  [results]', results);
  console.log('  [signs-issued]', signCount); // adapter re-signed once internally

  console.log('\n  [analysis]');
  console.log('    PRO: No new kit mechanism. Adapter is self-contained.');
  console.log('    PRO: Pipeline stage code unchanged — fetch() always works.');
  console.log('    CON: Adapter silently re-signs. Composer cannot observe stale events.');
  console.log('    CON: Re-sign logic duplicated per adapter (N adapters, N re-sign strategies).');
  console.log('    CON: If re-sign fails (auth expired, network down), error surfaces at fetch() —');
  console.log('         same as resource_stale; indistinguishable from resource error.');
  console.log('    VERDICT: Sufficient for simple cases. Breaks down for adapters that cannot');
  console.log('    self-re-sign (require Composer-provided credentials or context).');
}

async function probeOptionB(): Promise<void> {
  section('Option B — Composer reconstruct() hook (new mechanism)');
  signCount = 0;
  const adapter = createAdapterB(10); // 10ms TTL

  await new Promise(r => setTimeout(r, 20)); // let it expire

  const keys = ['key-1', 'key-2', 'key-3'];
  const results = await composerRunWithReconstruct(adapter, keys);
  const summary = results.map(r =>
    r.error === null ? `ok(${r.data.slice(0, 20)}...)` : `err(${r.error.code})`
  );

  console.log('  [results]', summary);
  console.log('  [signs-issued]', signCount);

  console.log('\n  [analysis]');
  console.log('    PRO: Composer sees stale events explicitly (isStale() check).');
  console.log('    PRO: Reconstruction is predictable — happens BEFORE the failing fetch.');
  console.log('    CON: Requires new Composer mechanism (isStale + reconstruct contract).');
  console.log('    CON: Adapter must implement 2 new methods (isStale, reconstruct).');
  console.log('    CON: POLLING model — Composer checks stale before each call, even when fresh.');
  console.log('    CON: Reconstruction timing is Composer-imposed, not demand-driven.');
  console.log('    VERDICT: Over-engineered for the use case. Version-aware-resolver (Cat VIII)');
  console.log('    already handles re-readable secrets. reconstruct() adds NEW surface that');
  console.log('    re-readable resources don\'t need and non-re-readable resources don\'t fit cleanly.');
}

async function probeOptionC(): Promise<void> {
  section('Option C — Result.err(resource_stale) + Composer retry (existing semantics)');
  signCount = 0;
  const adapter = createAdapterC(10); // 10ms TTL

  await new Promise(r => setTimeout(r, 20)); // let it expire

  const keys = ['key-1', 'key-2', 'key-3'];
  const results = await composerRunWithRetry(adapter, keys);
  const summary = results.map(r =>
    r.error === null ? `ok(${r.data.slice(0, 20)}...)` : `err(${r.error.code})`
  );

  console.log('  [results]', summary);
  console.log('  [signs-issued]', signCount);

  console.log('\n  [analysis]');
  console.log('    PRO: No new mechanism in Composer. Uses existing retry path.');
  console.log('    PRO: Error surfaces explicitly — resource_expired is a known code.');
  console.log('    PRO: Adapter decides HOW to refresh; Composer decides WHETHER to retry.');
  console.log('    PRO: Compatible with Cat I (Inngest retry semantics) — step returns error,');
  console.log('         Inngest re-runs step with fresh adapter at next attempt.');
  console.log('    CON: First fetch() call MUST fail to trigger retry — one wasted round-trip.');
  console.log('    CON: Adapter needs refresh() or equivalent — slight duplication with Option A.');
  console.log('    VERDICT: Best fit. resource_expired is a retryable error code. Inngest\'s step');
  console.log('    retry handles it at the durable-execution layer without new Composer surface.');
}

function printComparison(): void {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('  Comparison — reconstruction mechanisms');
  console.log(`${'─'.repeat(60)}`);
  console.log(`
  ┌──────────────────┬─────────────────┬──────────────────┬────────────────┐
  │ Axis             │ A: Internal     │ B: reconstruct() │ C: Retry       │
  ├──────────────────┼─────────────────┼──────────────────┼────────────────┤
  │ New kit surface  │ 0               │ isStale+reconstr │ 0              │
  │ Adapter surface  │ internal only   │ isStale+reconstr │ refresh()      │
  │ Composer change  │ 0               │ isStale poll loop│ retry config   │
  │ Inngest compat   │ transparent     │ Composer-only    │ NATIVE (step)  │
  │ Error visibility │ hidden re-sign  │ explicit pre-call│ explicit error │
  │ Wasted round-trip│ 0               │ 0                │ 1 (first fail) │
  │ Self-re-sign able│ YES             │ YES              │ YES            │
  │ Context-dependent│ hard            │ possible         │ POSSIBLE       │
  └──────────────────┴─────────────────┴──────────────────┴────────────────┘

  VERDICT: Option C (retry + Result.err) is sufficient.
    No new Composer mechanism needed for non-re-readable resource reconstruction.
    resource_expired is a retryable error code. Inngest's step retry handles the
    outer retry loop. Adapter implements refresh() internally (same structure as
    Cat VIII version-aware-resolver's invalidate() — same shape, different layer).

  Cat VIII cf #8 RESOLUTION: Non-re-readable resources map to existing retry
  semantics. reconstruct() as a new Composer interface is rejected — over-engineered.
  The reconstruct pattern IS the retry pattern with a resource-aware error code.
  `);
}

async function main(): Promise<void> {
  console.log('### Cat VI spike #3 — probe-reconstruction ###\n');
  await probeOptionA();
  await probeOptionB();
  await probeOptionC();
  printComparison();
  console.log('\n[driver] all reconstruction probes done. exit 0');
}

main().catch((e) => { console.error(e); process.exit(1); });
