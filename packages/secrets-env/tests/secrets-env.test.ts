import { createVersionAwareResolver } from '@idriszade/secrets';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEnvSecretsResolver, SecretsEnvConfigError } from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const envWith = (vars: Record<string, string>) => vars as Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createEnvSecretsResolver', () => {
  it('1. valid schema + matching env source → resolver created, resolve returns ok', async () => {
    const schema = z.object({ FOO: z.string() });
    const resolver = createEnvSecretsResolver(schema, { source: envWith({ FOO: 'bar' }) });

    const result = await resolver.resolve('FOO');
    expect(result.error).toBeNull();
    expect(result.data).toBe('bar');
  });

  it('2. schema requires BAR but source lacks it → constructor throws SecretsEnvConfigError', () => {
    const schema = z.object({ BAR: z.string() });
    expect(() => createEnvSecretsResolver(schema, { source: envWith({ OTHER: 'x' }) })).toThrow(
      SecretsEnvConfigError,
    );
  });

  it('2b. thrown error has documented shape (name + issues + message)', () => {
    const schema = z.object({ BAR: z.string() });
    let thrown: unknown;
    try {
      createEnvSecretsResolver(schema, { source: envWith({ OTHER: 'x' }) });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SecretsEnvConfigError);
    const err = thrown as SecretsEnvConfigError;
    expect(err.name).toBe('SecretsEnvConfigError');
    expect(err.message).toBe('Env validation failed at construction');
    expect(Array.isArray(err.issues)).toBe(true);
    expect(err.issues.length).toBeGreaterThan(0);
  });

  it('3. env var missing at resolve time (post-construction source mutation) → err secret_not_found', async () => {
    const source: Record<string, string | undefined> = { FOO: 'x', BAR: 'y' };
    const schema = z.object({ FOO: z.string(), BAR: z.string() });
    const resolver = createEnvSecretsResolver(schema, { source });

    // Simulate runtime disappearance of a key after construction.
    delete source.BAR;

    const result = await resolver.resolve('BAR');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('secret_not_found');
  });

  it('4. envVarMap indirection — resolve(token) reads GH_TOKEN from source', async () => {
    const schema = z.object({ GH_TOKEN: z.string() });
    const source = envWith({ GH_TOKEN: 'ghp_abc123' });
    const resolver = createEnvSecretsResolver(schema, {
      source,
      envVarMap: { token: 'GH_TOKEN' },
    });

    const result = await resolver.resolve('token');
    expect(result.error).toBeNull();
    expect(result.data).toBe('ghp_abc123');
  });

  it('5. stats(name).reads increments on each resolve call', async () => {
    const schema = z.object({ FOO: z.string() });
    const resolver = createEnvSecretsResolver(schema, { source: envWith({ FOO: 'v' }) });

    expect(resolver.stats('FOO').reads).toBe(0);
    await resolver.resolve('FOO');
    expect(resolver.stats('FOO').reads).toBe(1);
    await resolver.resolve('FOO');
    expect(resolver.stats('FOO').reads).toBe(2);
  });

  it('6. invalidate(name) bumps the version counter visible via stats', () => {
    const schema = z.object({ FOO: z.string() });
    const resolver = createEnvSecretsResolver(schema, { source: envWith({ FOO: 'v' }) });

    const vBefore = resolver.stats('FOO').currentVersion;
    resolver.invalidate('FOO');
    const vAfter = resolver.stats('FOO').currentVersion;

    expect(vAfter).not.toBe(vBefore);
    // Both should be numeric strings; after should be greater.
    expect(Number(vAfter)).toBeGreaterThan(Number(vBefore));
  });

  it('7. integration with createVersionAwareResolver — invalidate clears cache, version changes', async () => {
    const schema = z.object({ FOO: z.string() });
    const inner = createEnvSecretsResolver(schema, { source: envWith({ FOO: 'initial' }) });
    const wrapped = createVersionAwareResolver(inner);

    // First resolve — populates wrapper cache; wrapper assigns version '1'.
    const r1 = await wrapped.resolve('FOO');
    expect(r1.data).toBe('initial');
    const v1 = wrapped.stats('FOO').currentVersion;
    expect(v1).toBeDefined();

    // Invalidate via wrapper (delegates to inner.invalidate too).
    wrapped.invalidate('FOO');

    // Version should have cleared (wrapper cache cleared; next resolve regenerates).
    const vMid = wrapped.stats('FOO').currentVersion;
    expect(vMid).toBeUndefined(); // cache cleared, no version until next resolve

    // Second resolve — re-fetches and re-caches.
    const r2 = await wrapped.resolve('FOO');
    expect(r2.data).toBe('initial');
    const v2 = wrapped.stats('FOO').currentVersion;
    expect(v2).toBeDefined();
  });

  it('8. multiple distinct names resolve independently', async () => {
    const schema = z.object({ A: z.string(), B: z.string() });
    const resolver = createEnvSecretsResolver(schema, {
      source: envWith({ A: 'alpha', B: 'beta' }),
    });

    const [rA, rB] = await Promise.all([resolver.resolve('A'), resolver.resolve('B')]);
    expect(rA.data).toBe('alpha');
    expect(rB.data).toBe('beta');
    expect(resolver.stats('A').reads).toBe(1);
    expect(resolver.stats('B').reads).toBe(1);
  });

  it('9. source injection — fake source is used instead of process.env', async () => {
    const schema = z.object({ FOO: z.string() });
    const fakeSource = envWith({ FOO: 'injected' });
    const resolver = createEnvSecretsResolver(schema, { source: fakeSource });

    const result = await resolver.resolve('FOO');
    expect(result.data).toBe('injected');
  });

  it('10. invalidate on unknown name does not throw (idempotent)', () => {
    const schema = z.object({ FOO: z.string() });
    const resolver = createEnvSecretsResolver(schema, { source: envWith({ FOO: 'v' }) });

    expect(() => resolver.invalidate('UNKNOWN_KEY')).not.toThrow();
    // Stats for that key should be at initial state with bumped version.
    const s = resolver.stats('UNKNOWN_KEY');
    expect(s.reads).toBe(0);
  });
});
