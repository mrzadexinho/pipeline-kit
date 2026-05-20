import type { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createSopsSecretsResolver } from '../src/index.js';

// ---------------------------------------------------------------------------
// Test helper: builds a fake spawn function with controllable outcomes
// ---------------------------------------------------------------------------

interface FakeSpawnOpts {
  stdout?: string;
  stderr?: string;
  exit?: number;
  err?: Error;
  /** If true, never emits close (simulates hang / timeout scenario) */
  hang?: boolean;
}

function fakeSpawn(opts: FakeSpawnOpts): typeof spawn {
  return ((..._args: unknown[]) => {
    const stdoutEmitter = new EventEmitter();
    const stderrEmitter = new EventEmitter();
    const child = Object.assign(new EventEmitter(), {
      stdout: stdoutEmitter,
      stderr: stderrEmitter,
    });

    queueMicrotask(() => {
      if (opts.err) {
        child.emit('error', opts.err);
        return;
      }
      if (opts.hang) return; // never resolves
      if (opts.stdout) stdoutEmitter.emit('data', Buffer.from(opts.stdout));
      if (opts.stderr) stderrEmitter.emit('data', Buffer.from(opts.stderr));
      child.emit('close', opts.exit ?? 0);
    });

    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSopsSecretsResolver', () => {
  it('1. resolves a key from valid sops JSON output', async () => {
    const resolver = createSopsSecretsResolver('./secrets.enc.json', {
      spawn: fakeSpawn({ stdout: JSON.stringify({ db_password: 'hunter2' }) }),
    });

    const result = await resolver.resolve('db_password');
    expect(result.error).toBeNull();
    expect(result.data).toBe('hunter2');
  });

  it('2. cache hit: second resolve does not re-spawn sops', async () => {
    let callCount = 0;
    const spy = ((...args: unknown[]) => {
      callCount++;
      return fakeSpawn({ stdout: JSON.stringify({ db_password: 'hunter2' }) })(...args);
    }) as unknown as typeof spawn;

    const resolver = createSopsSecretsResolver('./secrets.enc.json', { spawn: spy });

    await resolver.resolve('db_password');
    await resolver.resolve('db_password');

    expect(callCount).toBe(1);
  });

  it('3. after invalidate, next resolve re-spawns', async () => {
    let callCount = 0;
    const spy = ((...args: unknown[]) => {
      callCount++;
      return fakeSpawn({ stdout: JSON.stringify({ db_password: 'hunter2' }) })(...args);
    }) as unknown as typeof spawn;

    const resolver = createSopsSecretsResolver('./secrets.enc.json', { spawn: spy });

    await resolver.resolve('db_password');
    resolver.invalidate('db_password');
    await resolver.resolve('db_password');

    expect(callCount).toBe(2);
  });

  it('4. non-zero exit returns err with code secret_unavailable', async () => {
    const resolver = createSopsSecretsResolver('./secrets.enc.json', {
      spawn: fakeSpawn({ stderr: 'decryption failed', exit: 1 }),
    });

    const result = await resolver.resolve('db_password');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('secret_unavailable');
    expect(result.error?.message).toContain('exit code 1');
  });

  it('5. ENOENT spawn error returns err mentioning binary not found', async () => {
    const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const resolver = createSopsSecretsResolver('./secrets.enc.json', {
      spawn: fakeSpawn({ err: enoentErr }),
    });

    const result = await resolver.resolve('db_password');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('secret_unavailable');
    expect(result.error?.message).toContain('binary not found');
  });

  it('6. invalid JSON output returns err with code secret_unavailable', async () => {
    const resolver = createSopsSecretsResolver('./secrets.enc.json', {
      spawn: fakeSpawn({ stdout: 'not json', exit: 0 }),
    });

    const result = await resolver.resolve('any_key');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('secret_unavailable');
    expect(result.error?.message).toContain('not valid JSON');
  });

  it('7. key missing in valid JSON returns err with code secret_not_found', async () => {
    const resolver = createSopsSecretsResolver('./secrets.enc.json', {
      spawn: fakeSpawn({ stdout: JSON.stringify({ other: 'x' }) }),
    });

    const result = await resolver.resolve('missing_key');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('secret_not_found');
    expect(result.error?.message).toContain('missing_key');
  });

  it('8. concurrent resolves share one spawn (deduplicated)', async () => {
    let callCount = 0;
    const spy = ((...args: unknown[]) => {
      callCount++;
      return fakeSpawn({ stdout: JSON.stringify({ foo: 'bar' }) })(...args);
    }) as unknown as typeof spawn;

    const resolver = createSopsSecretsResolver('./secrets.enc.json', { spawn: spy });

    const [r1, r2] = await Promise.all([resolver.resolve('foo'), resolver.resolve('foo')]);

    expect(callCount).toBe(1);
    expect(r1.error).toBeNull();
    expect(r2.error).toBeNull();
    expect(r1.data).toBe('bar');
    expect(r2.data).toBe('bar');
  });

  it('9. timeout returns err mentioning timed out', async () => {
    const resolver = createSopsSecretsResolver('./secrets.enc.json', {
      spawn: fakeSpawn({ hang: true }),
      timeoutMs: 50,
    });

    const result = await resolver.resolve('any');
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe('secret_unavailable');
    expect(result.error?.message).toContain('timed out');
  });

  it('10. stats increments reads; invalidate bumps version', async () => {
    const resolver = createSopsSecretsResolver('./secrets.enc.json', {
      spawn: fakeSpawn({ stdout: JSON.stringify({ api_key: 'secret123' }) }),
    });

    // Before any resolve, reads = 0, currentVersion = undefined
    expect(resolver.stats('api_key')).toEqual({ reads: 0, currentVersion: undefined });

    await resolver.resolve('api_key');
    await resolver.resolve('api_key');
    expect(resolver.stats('api_key').reads).toBe(2);
    expect(resolver.stats('api_key').currentVersion).toBeUndefined();

    resolver.invalidate('api_key');
    expect(resolver.stats('api_key').currentVersion).toBe('1');

    resolver.invalidate('api_key');
    expect(resolver.stats('api_key').currentVersion).toBe('2');
  });
});
