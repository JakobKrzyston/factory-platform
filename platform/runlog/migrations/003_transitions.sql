-- #86: one row per stretch an issue carried a factory:* label, so the run log holds the time between runs as
-- well as the runs. Like 001 and 002, this file runs unchanged on SQLite and Postgres.
-- Each column is described in platform/runlog/README.md.

CREATE TABLE transitions (
  repo        TEXT NOT NULL,
  issue       INTEGER NOT NULL,
  label       TEXT NOT NULL,
  entered_at  TIMESTAMPTZ NOT NULL,
  left_at     TIMESTAMPTZ,
  seconds     INTEGER CHECK (seconds >= 0),
  PRIMARY KEY (repo, issue, label, entered_at)
);
