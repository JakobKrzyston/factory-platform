-- TL-11: one row per agent run. This file runs unchanged on SQLite and Postgres,
-- so the local and cloud run logs have the same schema by construction.
-- Each column is described in platform/runlog/README.md.

CREATE TABLE runs (
  id                  TEXT PRIMARY KEY,
  factory             TEXT NOT NULL,
  role                TEXT NOT NULL,
  factory_sha         TEXT NOT NULL,
  model               TEXT NOT NULL,
  repo                TEXT NOT NULL,
  issue               INTEGER NOT NULL,
  pr                  INTEGER,
  head_sha            TEXT,
  benchmark           BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'done', 'needs_human', 'failed')),
  started_at          TIMESTAMPTZ NOT NULL,
  ended_at            TIMESTAMPTZ,
  wall_seconds        INTEGER CHECK (wall_seconds >= 0),
  input_tokens        INTEGER CHECK (input_tokens >= 0),
  output_tokens       INTEGER CHECK (output_tokens >= 0),
  cache_read_tokens   INTEGER CHECK (cache_read_tokens >= 0),
  cache_write_tokens  INTEGER CHECK (cache_write_tokens >= 0),
  cost_usd            NUMERIC(10, 6) CHECK (cost_usd >= 0),
  checks_passed       BOOLEAN,
  review_findings     INTEGER CHECK (review_findings >= 0),
  rework              BOOLEAN,
  -- A run has ended exactly when it is no longer running.
  CHECK ((status = 'running') = (ended_at IS NULL))
);
