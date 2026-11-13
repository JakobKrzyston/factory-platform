-- TL-16: one row per scorer per benchmark run it graded. Like 001, this file runs unchanged on
-- SQLite and Postgres. Each column is described in platform/runlog/README.md.

CREATE TABLE scores (
  run_id  TEXT NOT NULL REFERENCES runs (id),
  scorer  TEXT NOT NULL,
  score   DOUBLE PRECISION NOT NULL,
  reason  TEXT NOT NULL CHECK (reason <> ''),
  PRIMARY KEY (run_id, scorer)
);
