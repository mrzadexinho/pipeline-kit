import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    testTimeout: 10_000,
    env: {
      // Required by scopedIdempotencyKey (ADR IV-6): HMAC signing key for tests.
      // Individual tests that probe missing-key behaviour must delete this and
      // use vi.resetModules() to get a fresh module with no cached derived key.
      PK_SIGNING_KEY: 'pk-test-signing-key-do-not-use-in-production',
    },
    include: ['packages/*/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.test-d.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/index.ts',
        'packages/*/src/**/*.test-d.ts',
        'packages/*/src/**/types.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
