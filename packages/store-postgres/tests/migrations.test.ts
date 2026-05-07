import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url).pathname;
const MIGRATION_FILE = join(MIGRATIONS_DIR, '0001_init.sql');

describe('migrations', () => {
  it('migration SQL file exists', () => {
    let content: string;
    try {
      content = readFileSync(MIGRATION_FILE, 'utf-8');
    } catch {
      throw new Error(`Migration file not found: ${MIGRATION_FILE}`);
    }
    expect(content.length).toBeGreaterThan(0);
  });

  it('migration creates pipeline_atoms table with correct columns', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');

    expect(content).toContain('CREATE TABLE');
    expect(content).toContain('pipeline_atoms');
    expect(content).toContain('id TEXT PRIMARY KEY');
    expect(content).toContain('object TEXT NOT NULL');
    expect(content).toContain('created_at TIMESTAMPTZ NOT NULL');
    expect(content).toContain('data JSONB NOT NULL');
    expect(content).toContain('metadata JSONB');
    expect(content).toContain('source_id TEXT');
    expect(content).toContain('stage_id TEXT');
    expect(content).toContain('run_id TEXT');
  });

  it('migration creates pipeline_idempotency_cache table with correct columns', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');

    expect(content).toContain('pipeline_idempotency_cache');
    expect(content).toContain('key TEXT PRIMARY KEY');
    expect(content).toContain('atom_id TEXT NOT NULL');
  });

  it('migration SQL is idempotent (uses IF NOT EXISTS)', () => {
    const content = readFileSync(MIGRATION_FILE, 'utf-8');

    const createTableStatements = content.match(/CREATE TABLE/gi) ?? [];
    const createTableIfNotExists = content.match(/CREATE TABLE IF NOT EXISTS/gi) ?? [];

    expect(createTableIfNotExists.length).toBe(createTableStatements.length);
    expect(createTableIfNotExists.length).toBeGreaterThanOrEqual(2);
  });
});
