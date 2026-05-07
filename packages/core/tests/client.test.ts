import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ClientConfig, createPipelineKit, resolveClientConfig } from '../src/client.js';

describe('resolveClientConfig', () => {
  const originalApiKey = process.env.PIPELINE_KIT_API_KEY;
  const originalUrl = process.env.PIPELINE_KIT_URL;

  beforeEach(() => {
    process.env.PIPELINE_KIT_API_KEY = undefined;
    process.env.PIPELINE_KIT_URL = undefined;
    delete process.env.PIPELINE_KIT_API_KEY;
    delete process.env.PIPELINE_KIT_URL;
  });

  afterEach(() => {
    if (originalApiKey !== undefined) process.env.PIPELINE_KIT_API_KEY = originalApiKey;
    else delete process.env.PIPELINE_KIT_API_KEY;
    if (originalUrl !== undefined) process.env.PIPELINE_KIT_URL = originalUrl;
    else delete process.env.PIPELINE_KIT_URL;
  });

  it('uses defaults when no config + no env vars', () => {
    const r = resolveClientConfig();
    expect(r.apiKey).toBeUndefined();
    expect(r.url).toBeUndefined();
    expect(r.timeout).toBe(30_000);
    expect(r.retryPolicy.maxAttempts).toBe(3);
  });

  it('falls back to PIPELINE_KIT_API_KEY env var when config.apiKey absent', () => {
    process.env.PIPELINE_KIT_API_KEY = 'env_key';
    const r = resolveClientConfig();
    expect(r.apiKey).toBe('env_key');
  });

  it('falls back to PIPELINE_KIT_URL env var when config.url absent', () => {
    process.env.PIPELINE_KIT_URL = 'https://env.example.com';
    const r = resolveClientConfig();
    expect(r.url).toBe('https://env.example.com');
  });

  it('explicit config wins over env var', () => {
    process.env.PIPELINE_KIT_API_KEY = 'env_key';
    const r = resolveClientConfig({ apiKey: 'explicit_key' });
    expect(r.apiKey).toBe('explicit_key');
  });

  it('merges retry policy overrides over defaults', () => {
    const r = resolveClientConfig({ retryPolicy: { maxAttempts: 7 } });
    expect(r.retryPolicy.maxAttempts).toBe(7);
    expect(r.retryPolicy.baseDelayMs).toBe(100);
  });

  it('honors custom timeout', () => {
    const r = resolveClientConfig({ timeout: 5_000 });
    expect(r.timeout).toBe(5_000);
  });
});

describe('createPipelineKit', () => {
  it('returns a client with the 4 resources mounted', () => {
    const pk = createPipelineKit();
    expect(pk.pipelines).toBeDefined();
    expect(pk.runs).toBeDefined();
    expect(pk.atoms).toBeDefined();
    expect(pk.webhooks).toBeDefined();
  });

  it('webhooks resource wires sign + verify (NOT stubbed)', () => {
    const pk = createPipelineKit();
    expect(typeof pk.webhooks.sign).toBe('function');
    expect(typeof pk.webhooks.verify).toBe('function');
  });

  it('accepts ClientConfig without throwing', () => {
    const config: ClientConfig = {
      apiKey: 'sk_test',
      url: 'https://example.com',
      timeout: 10_000,
      retryPolicy: { maxAttempts: 5 },
    };
    expect(() => createPipelineKit(config)).not.toThrow();
  });
});

describe('Stubbed resources return not_implemented errors', () => {
  const pk = createPipelineKit();

  it('pipelines.create returns not_implemented', async () => {
    const r = await pk.pipelines.create({ definition: {} });
    expect(r.data).toBeNull();
    expect(r.error?.type).toBe('not_implemented');
    expect(r.error?.code).toBe('pk_resources_v0');
    expect(r.error?.message).toContain('pipeline-kit-cloud backend');
  });

  it('pipelines.get returns not_implemented', async () => {
    const r = await pk.pipelines.get('pk_pipe_x');
    expect(r.error?.type).toBe('not_implemented');
  });

  it('pipelines.list returns not_implemented', async () => {
    const r = await pk.pipelines.list();
    expect(r.error?.type).toBe('not_implemented');
  });

  it('runs.create returns not_implemented', async () => {
    const r = await pk.runs.create({ pipeline_id: 'pk_pipe_x' });
    expect(r.error?.type).toBe('not_implemented');
  });

  it('runs.get returns not_implemented', async () => {
    const r = await pk.runs.get('pk_run_x');
    expect(r.error?.type).toBe('not_implemented');
  });

  it('runs.list returns not_implemented', async () => {
    const r = await pk.runs.list();
    expect(r.error?.type).toBe('not_implemented');
  });

  it('runs.cancel returns not_implemented', async () => {
    const r = await pk.runs.cancel('pk_run_x');
    expect(r.error?.type).toBe('not_implemented');
  });

  it('atoms.get returns not_implemented', async () => {
    const r = await pk.atoms.get('pk_atom_x');
    expect(r.error?.type).toBe('not_implemented');
  });

  it('atoms.list returns not_implemented', async () => {
    const r = await pk.atoms.list();
    expect(r.error?.type).toBe('not_implemented');
  });

  it('all stub errors share doc_url and code', async () => {
    const calls = [
      await pk.pipelines.create({ definition: {} }),
      await pk.runs.create({ pipeline_id: 'x' }),
      await pk.atoms.list(),
    ];
    for (const r of calls) {
      expect(r.error?.code).toBe('pk_resources_v0');
      expect(r.error?.doc_url).toBeTruthy();
    }
  });
});

describe('No pk.adapters resource (per spec redline)', () => {
  it('PipelineKitClient does not expose adapters', () => {
    const pk = createPipelineKit() as unknown as Record<string, unknown>;
    expect('adapters' in pk).toBe(false);
  });
});
