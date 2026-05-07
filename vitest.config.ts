import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    testTimeout: 10_000,
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
