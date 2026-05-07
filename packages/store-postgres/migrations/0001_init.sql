CREATE TABLE IF NOT EXISTS pipeline_atoms (
  id TEXT PRIMARY KEY,
  object TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  metadata JSONB,
  data JSONB NOT NULL,
  source_id TEXT,
  stage_id TEXT,
  run_id TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_idempotency_cache (
  key TEXT PRIMARY KEY,
  atom_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
