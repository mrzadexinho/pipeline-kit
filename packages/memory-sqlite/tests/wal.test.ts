import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteMemoryAdapter } from '../src/index.js';

describe('SqliteMemoryAdapter — WAL perf sanity', () => {
  const dbPath = join(tmpdir(), `pk-memory-wal-test-${Date.now()}.sqlite`);

  afterEach(() => {
    // Clean up the temporary database file
    for (const suffix of ['', '-wal', '-shm']) {
      const p = dbPath + suffix;
      if (existsSync(p)) rmSync(p);
    }
  });

  it('100 sequential writes to file-path SQLite complete in <500ms (WAL regression guard)', async () => {
    const adapter = createSqliteMemoryAdapter({ dbPath, walMode: true });

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const result = await adapter.write(`key-${i}`, `value-${i}`);
      expect(result.error).toBeNull();
    }
    const elapsed = performance.now() - start;

    await adapter.close();

    // Regression guard for WAL mode being enabled. Non-WAL would take ~1000ms+ (per-write fsync); 500ms cleanly distinguishes WAL-on from WAL-off while remaining stable under parallel CI load.
    expect(elapsed).toBeLessThan(500);
  }, 5000);
});
