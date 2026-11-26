/** Tests the run log migration against a throwaway SQLite file. Run: pnpm test */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { migrateSqlite } from "./migrate";

function freshDb(): DatabaseSync {
  const path = join(mkdtempSync(join(tmpdir(), "runlog-")), "runlog.db");
  migrateSqlite(path);
  return new DatabaseSync(path);
}

const START = {
  id: "0b7e5c1e-4f7a-4d0e-9a51-3f1f6b8f2c11",
  factory: "code",
  role: "implementer",
  factory_sha: "877eef4c0ffee877eef4c0ffee877eef4c0ffee8",
  model: "claude-opus-5-5",
  repo: "JakobKrzyston/factory-platform",
  issue: 11,
  started_at: "2026-11-09T10:00:00.000Z",
};

const INSERT_START = `INSERT INTO runs (id, factory, role, factory_sha, model, repo, issue, started_at)
  VALUES (:id, :factory, :role, :factory_sha, :model, :repo, :issue, :started_at)`;

test("applies each migration once", () => {
  const path = join(mkdtempSync(join(tmpdir(), "runlog-")), "nested", "runlog.db");
  assert.deepEqual(migrateSqlite(path), ["001_runs", "002_scores", "003_transitions"]);
  assert.deepEqual(migrateSqlite(path), []);
});

test("applies 003 to a run log that already has 001 and 002", () => {
  const path = join(mkdtempSync(join(tmpdir(), "runlog-")), "runlog.db");
  const before = new DatabaseSync(path);
  before.exec("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY)");
  for (const version of ["001_runs", "002_scores"]) {
    before.exec(readFileSync(join(import.meta.dirname, "migrations", `${version}.sql`), "utf8"));
    before.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(version);
  }
  before.close();

  assert.deepEqual(migrateSqlite(path), ["003_transitions"]);
  const db = new DatabaseSync(path);
  db.prepare("INSERT INTO transitions (repo, issue, label, entered_at) VALUES ('o/r', 1, 'factory:ready', ?)").run(START.started_at);
  assert.throws(() => db.prepare("UPDATE transitions SET seconds = -1").run(), /CHECK constraint failed/);
});

test("a run is written at start and completed at end", () => {
  const db = freshDb();
  db.prepare(INSERT_START).run(START);
  assert.equal(db.prepare("SELECT status, benchmark FROM runs").get()?.status, "running");

  db.prepare(
    `UPDATE runs SET status = 'done', ended_at = :ended_at, wall_seconds = 754, pr = 27, head_sha = :head_sha,
       input_tokens = 1200, output_tokens = 48000, cache_read_tokens = 2100000, cache_write_tokens = 90000,
       cost_usd = 4.271350, checks_passed = TRUE, rework = FALSE
     WHERE id = :id`,
  ).run({ id: START.id, ended_at: "2026-11-09T10:12:34.000Z", head_sha: "4dda246c0ffee4dda246c0ffee4dda246c0ffee4" });

  assert.deepEqual(
    { ...db.prepare("SELECT pr, status, wall_seconds, cost_usd, checks_passed, benchmark, review_findings FROM runs").get() },
    { pr: 27, status: "done", wall_seconds: 754, cost_usd: 4.27135, checks_passed: 1, benchmark: 0, review_findings: null },
  );
});

test("constraints reject inconsistent rows", () => {
  const db = freshDb();
  db.prepare(INSERT_START).run(START);
  assert.throws(() => db.prepare("UPDATE runs SET ended_at = started_at WHERE id = ?").run(START.id), /CHECK constraint failed/);
  assert.throws(() => db.prepare("UPDATE runs SET status = 'done' WHERE id = ?").run(START.id), /CHECK constraint failed/);
  assert.throws(() => db.prepare("UPDATE runs SET status = 'crashed', ended_at = started_at").run(), /CHECK constraint failed/);
});
