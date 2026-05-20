import type { Result } from '@idriszade/core';
import { err, ok } from '@idriszade/core';
import type { SecretStats, SecretsError, SecretsResolver } from '@idriszade/secrets';
import type { ZodType } from 'zod';

// ---------------------------------------------------------------------------
// Public error shape for construction-time misconfiguration.
// ---------------------------------------------------------------------------

/**
 * Thrown by `createEnvSecretsResolver` when the source fails Zod validation
 * at construction time. This is a fail-fast misconfiguration guard — not a
 * runtime stage-boundary error — so it is the one permitted constructor throw
 * in this adapter.
 *
 * Shape:
 * ```ts
 * {
 *   name: 'SecretsEnvConfigError',
 *   message: 'Env validation failed at construction',
 *   issues: ZodIssue[]   // from zod v4 safeParse
 * }
 * ```
 */
export class SecretsEnvConfigError extends Error {
  override readonly name = 'SecretsEnvConfigError' as const;
  readonly issues: unknown[];

  constructor(issues: unknown[]) {
    super('Env validation failed at construction');
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface EnvResolverOptions {
  /**
   * Map from kit-side secret name → environment variable name.
   * When omitted the kit-side name is used directly as the env-var name.
   *
   * @example
   * ```ts
   * { envVarMap: { githubToken: 'GH_TOKEN' } }
   * // resolve('githubToken') reads process.env.GH_TOKEN
   * ```
   */
  envVarMap?: Record<string, string>;
  /**
   * The env source to read from. Defaults to `process.env`.
   * Injectable for testing so tests never mutate `process.env`.
   */
  source?: Record<string, string | undefined>;
}

// ---------------------------------------------------------------------------
// Internal state per named secret
// ---------------------------------------------------------------------------

interface SecretState {
  reads: number;
  version: number; // incremented on invalidate; serialised to string for SecretStats
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an environment-variable-backed {@link SecretsResolver}.
 *
 * **Construction-time validation** — `source` (default `process.env`) is
 * validated against `schema` immediately. If validation fails a
 * {@link SecretsEnvConfigError} is thrown. This is intentional: misconfigured
 * env is a deployment error, not a transient secret-fetch error, so
 * fail-fast at startup is the correct behaviour.
 *
 * @param schema  Zod schema describing the required env-var shape.
 * @param options Optional indirection map and source override.
 * @throws {SecretsEnvConfigError} when `source` does not satisfy `schema`.
 */
export function createEnvSecretsResolver(
  schema: ZodType,
  options?: EnvResolverOptions,
): SecretsResolver {
  const source: Record<string, string | undefined> = options?.source ?? process.env;
  const envVarMap: Record<string, string> = options?.envVarMap ?? {};

  // Fail-fast: validate env at construction time.
  const parseResult = schema.safeParse(source);
  if (!parseResult.success) {
    throw new SecretsEnvConfigError(parseResult.error.issues);
  }

  // Per-name state: reads + version counter.
  const stateMap = new Map<string, SecretState>();

  function getState(name: string): SecretState {
    let state = stateMap.get(name);
    if (state === undefined) {
      state = { reads: 0, version: 1 };
      stateMap.set(name, state);
    }
    return state;
  }

  return {
    async resolve(name: string): Promise<Result<string, SecretsError>> {
      const envVarName = envVarMap[name] ?? name;
      const state = getState(name);
      state.reads += 1;

      const value = source[envVarName];
      if (value === undefined) {
        return err({
          type: 'secrets_error',
          code: 'secret_not_found',
          message: `env var ${envVarName} not set`,
        } satisfies SecretsError);
      }
      return ok(value);
    },

    invalidate(name: string): void {
      const state = getState(name);
      state.version += 1;
    },

    stats(name: string): SecretStats {
      const state = getState(name);
      return {
        reads: state.reads,
        currentVersion: String(state.version),
      };
    },
  };
}
