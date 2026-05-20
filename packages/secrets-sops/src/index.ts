import { spawn as nodeSpawn } from 'node:child_process';
import type { Result } from '@idriszade/core';
import { err, ok } from '@idriszade/core';
import type { SecretStats, SecretsError, SecretsResolver } from '@idriszade/secrets';

export interface SopsResolverOptions {
  /**
   * Path to the sops binary. Defaults to `'sops'` (relies on PATH).
   */
  binaryPath?: string;
  /**
   * Override the spawn function (injection point for tests).
   */
  spawn?: typeof nodeSpawn;
  /**
   * Spawn timeout in milliseconds. Defaults to 30000.
   */
  timeoutMs?: number;
}

type DecodeResult = Result<Record<string, unknown>, SecretsError>;

/**
 * Creates a SOPS CLI-backed SecretsResolver that decrypts a sops-encrypted
 * JSON file via `sops -d <filePath>` and looks up keys in the decoded object.
 *
 * Caches the full decoded object until `invalidate(name)` is called.
 * Concurrent `resolve()` calls while sops is in-flight share the same pending
 * promise (deduplicated spawn).
 *
 * ADR: VIII-5 (reference-adapter trio, sops leg).
 */
export function createSopsSecretsResolver(
  filePath: string,
  options?: SopsResolverOptions,
): SecretsResolver {
  const binaryPath = options?.binaryPath ?? 'sops';
  const spawnFn = options?.spawn ?? nodeSpawn;
  const timeoutMs = options?.timeoutMs ?? 30_000;

  // Per-name stats: reads + version counter
  const statsMap = new Map<string, { reads: number; version: number }>();

  // Full-decode cache: null = not loaded; pending = in-flight
  let cachedDecode: DecodeResult | null = null;
  let pendingDecode: Promise<DecodeResult> | undefined;

  function getStats(name: string): { reads: number; version: number } {
    let s = statsMap.get(name);
    if (!s) {
      s = { reads: 0, version: 0 };
      statsMap.set(name, s);
    }
    return s;
  }

  function runSops(): Promise<DecodeResult> {
    return new Promise<DecodeResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const child = spawnFn(binaryPath, ['-d', filePath]);

      function settle(result: DecodeResult): void {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve(result);
      }

      timer = setTimeout(() => {
        settle(
          err({
            type: 'secrets_error',
            code: 'secret_unavailable',
            message: `sops invocation timed out after ${timeoutMs}ms`,
          }),
        );
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (spawnErr: NodeJS.ErrnoException) => {
        if (spawnErr.code === 'ENOENT') {
          settle(
            err({
              type: 'secrets_error',
              code: 'secret_unavailable',
              message: 'sops binary not found on PATH (or at configured binaryPath)',
            }),
          );
        } else {
          settle(
            err({
              type: 'secrets_error',
              code: 'secret_unavailable',
              message: `sops spawn error: ${spawnErr.message}`,
            }),
          );
        }
      });

      child.on('close', (code: number | null) => {
        if (code !== 0) {
          settle(
            err({
              type: 'secrets_error',
              code: 'secret_unavailable',
              message: `sops exit code ${code ?? 'null'}: ${stderr.trim()}`,
            }),
          );
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          settle(
            err({
              type: 'secrets_error',
              code: 'secret_unavailable',
              message: 'sops output is not valid JSON',
            }),
          );
          return;
        }

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          settle(
            err({
              type: 'secrets_error',
              code: 'secret_unavailable',
              message: 'sops output is not a JSON object',
            }),
          );
          return;
        }

        settle(ok(parsed as Record<string, unknown>));
      });
    });
  }

  async function ensureDecode(): Promise<DecodeResult> {
    if (cachedDecode !== null) return cachedDecode;
    if (pendingDecode !== undefined) return pendingDecode;

    pendingDecode = runSops().then((result) => {
      cachedDecode = result;
      pendingDecode = undefined;
      return result;
    });

    return pendingDecode;
  }

  return {
    async resolve(name: string): Promise<Result<string, SecretsError>> {
      const decodeResult = await ensureDecode();

      if (decodeResult.error !== null) return decodeResult;

      const obj = decodeResult.data;
      const value = obj[name];

      if (typeof value !== 'string') {
        return err({
          type: 'secrets_error',
          code: 'secret_not_found',
          message: `key ${name} not found in sops output`,
        });
      }

      const s = getStats(name);
      s.reads++;
      return ok(value);
    },

    invalidate(name: string): void {
      // Clear full-decode cache so next resolve re-spawns sops
      cachedDecode = null;
      pendingDecode = undefined;
      // Bump version counter for the named secret
      const s = getStats(name);
      s.version++;
    },

    stats(name: string): SecretStats {
      const s = getStats(name);
      return {
        reads: s.reads,
        currentVersion: s.version > 0 ? String(s.version) : undefined,
      };
    },
  };
}
