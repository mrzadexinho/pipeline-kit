-- Install pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Default embeddings table (dimension 1536; adjust if needed)
CREATE TABLE IF NOT EXISTS pipeline_embeddings (
  id TEXT PRIMARY KEY NOT NULL,
  object TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  metadata JSONB,
  data JSONB NOT NULL,
  source_id TEXT,
  stage_id TEXT,
  run_id TEXT,
  embedding vector(1536)
);

-- HNSW index for cosine similarity (change operator class for other distance metrics)
CREATE INDEX IF NOT EXISTS pipeline_embeddings_hnsw_idx
  ON pipeline_embeddings
  USING hnsw (embedding vector_cosine_ops);
