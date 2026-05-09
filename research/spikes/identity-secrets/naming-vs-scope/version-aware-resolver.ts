// Cat VIII spike #5 leg-2 sub-(1) — version-aware-resolver wrapper, EXTENDED
// with scope(prefix). Forked from leg-1 (spike #4) verbatim and extended in
// place per the brain brief (no new wrapper file).
//
// Day-1 leg-1 contract (UNCHANGED):
//   - resolve(name): probe real.stats(name).current_version; return cached
//     value if cache.version === current, else await real.resolve(name) and
//     stamp the result. Errors are forwarded unchanged and NOT cached.
//   - invalidate(name): pass-through. Wrapper does NOT proactively drop its
//     cache; the next resolve(name) re-probes stats and re-fetches.
//   - stats(name): pass-through.
//
// Leg-2 extension — scope(prefix):
//   - scope('apify') returns a sub-view that exposes the same SecretsResolver
//     shape; its resolve('token') delegates to the parent wrapper's
//     resolve('apify-token') via composite-name = `${prefix}-${name}` (hyphen
//     joiner — matches the existing kit-shape NAME_RE in mock-secrets-resolver.ts).
//   - Sub-view does NOT own its own cache. Cache map lives on the parent
//     wrapper instance only. This is THE design choice the spike is testing:
//     scope is a thin name-composition façade, NOT a cache fork.
//   - invalidate(name) and stats(name) on the sub-view forward via the same
//     composite name, so cell (e) and cell (f) hit the SAME cache entry by
//     construction. Runtime observables collapse byte-identically; the
//     spike's empirical signal is purely call-site ergonomics +
//     discoverability + composition tax.
//   - Recursive scope() is supported (returns a ScopedSecretsResolver too),
//     but not stress-tested in day-1.
//
// NOT a kit-spec decision. The day-1 chosen shape (sub-view sharing parent
// cache; hyphen joiner) is documented here so synthesis can reason about it.

import {
  type Result,
  type SecretStats,
  type SecretsError,
  type SecretsResolver,
  ok,
} from './mock-secrets-resolver.ts';

interface CacheEntry {
  value: string;
  version: number;
}

// Extended resolver interface — exposes scope() so harness call sites can
// type the wrapper precisely. Same SecretsResolver methods plus a
// scope(prefix) that returns another ScopedSecretsResolver (recursive).
export interface ScopedSecretsResolver extends SecretsResolver {
  scope(prefix: string): ScopedSecretsResolver;
}

export function createVersionAwareResolver(real: SecretsResolver): ScopedSecretsResolver {
  const cache = new Map<string, CacheEntry>();

  // Build the wrapper's own resolve/invalidate/stats once. The scope()
  // sub-view forwards into THIS closure (composite-name composition), so
  // the cache map is shared by construction.
  async function resolveByName(name: string): Promise<Result<string, SecretsError>> {
    const statsResult: Result<SecretStats, SecretsError> = real.stats(name);
    if (statsResult.error !== null) {
      return { data: null, error: statsResult.error };
    }
    const currentVersion = statsResult.data.current_version;

    const cached = cache.get(name);
    if (cached !== undefined && cached.version === currentVersion) {
      return ok(cached.value);
    }

    const fresh = await real.resolve(name);
    if (fresh.error !== null) {
      return fresh;
    }
    cache.set(name, { value: fresh.data, version: currentVersion });
    return fresh;
  }

  function invalidateByName(name: string): Result<void, SecretsError> {
    return real.invalidate(name);
  }

  function statsByName(name: string): Result<SecretStats, SecretsError> {
    return real.stats(name);
  }

  // Compose `${prefix}-${suffix}` — hyphen joiner matches the kit-shape
  // NAME_RE in mock-secrets-resolver.ts (`^[a-z0-9][a-z0-9-]*$`). Empty
  // prefix degenerates to suffix, but that case is not exercised in this spike.
  function compose(prefix: string, suffix: string): string {
    return prefix.length === 0 ? suffix : `${prefix}-${suffix}`;
  }

  // Build a ScopedSecretsResolver view rooted at a (possibly empty) prefix.
  // Day-1 shape: forwards every call to the parent closure with the
  // composite name. NO own cache. Recursive scope() concatenates prefixes.
  function buildView(prefix: string): ScopedSecretsResolver {
    return {
      async resolve(name: string): Promise<Result<string, SecretsError>> {
        return resolveByName(compose(prefix, name));
      },
      invalidate(name: string): Result<void, SecretsError> {
        return invalidateByName(compose(prefix, name));
      },
      stats(name: string): Result<SecretStats, SecretsError> {
        return statsByName(compose(prefix, name));
      },
      scope(nextPrefix: string): ScopedSecretsResolver {
        return buildView(compose(prefix, nextPrefix));
      },
    };
  }

  return buildView('');
}
