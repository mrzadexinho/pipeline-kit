CREATE TABLE IF NOT EXISTS memory (
  key       TEXT    PRIMARY KEY,
  value     TEXT    NOT NULL,
  namespace TEXT,
  created_at INTEGER,
  updated_at INTEGER
);
