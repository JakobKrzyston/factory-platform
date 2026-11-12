/** Tests the run log writer against throwaway SQLite files. Run: pnpm test */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { type RunLog, finishRun, measure, openRunLog, recordRework, startRun } from "./runlog";

const RUN = {
  id: "github-43061939534-1",
  factory: "code",
  role: "implementer",
  factory_sha: "d40a26e0ffeed40a26e0ffeed40a26e0ffeed40a",
  model: "sonnet",
  repo: "JakobKrzyston/factory-platform",
  issue: 12,
};

const INIT = { type: "system", subtype: "init", model: "claude-sonnet-5-5" };
const assistant = (id: string, output: number) => ({
  type: "assistant",
  message: {
    id,
    usage: { input_tokens: 3, output_tokens: output, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
  },
});
// Shaped like a real result line from Claude Code 2.1.322, trimmed to the fields the writer reads.
const RESULT = {
  type: "result",
  subtype: "success",
  total_cost_usd: 1.234567,
  usage: { input_tokens: 5, output_tokens: 70, cache_read_input_tokens: 2000, cache_creation_input_tokens: 400 },
  modelUsage: {
    "claude-sonnet-5-5": { inputTokens: 5, outputTokens: 70, cacheReadInputTokens: 2000, cacheCreationInputTokens: 400 },
    "claude-haiku-5-5": { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 30 },
  },
};
const jsonl = (...lines: object[]) => lines.map((l) => JSON.stringify(l)).join("\n");

async function freshLog(): Promise<RunLog> {
  return openRunLog("", join(mkdtempSync(join(tmpdir(), "runlog-")), "runlog.db"));
}

function runDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "run-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

test("measure sums every model the result line reports, with the harness's cost", () => {
  assert.deepEqual(measure(jsonl(INIT, assistant("m1", 70), RESULT)), {
    model: "claude-sonnet-5-5",
    input_tokens: 6,
    output_tokens: 72,
    cache_read_tokens: 2000,
    cache_write_tokens: 430,
    cost_usd: 1.234567,
  });
});

test("measure counts a killed run's messages once each and leaves its cost unknown", () => {
  // m1 was streamed as two content blocks; the last line was cut off mid-write.
  const transcript = `${jsonl(INIT, assistant("m1", 40), assistant("m1", 40), assistant("m2", 10))}\n{"type":"assis`;
  assert.deepEqual(measure(transcript), {
    model: "claude-sonnet-5-5",
    input_tokens: 6,
    output_tokens: 50,
    cache_read_tokens: 2000,
    cache_write_tokens: 400,
    cost_usd: null,
  });
  assert.equal(measure("").input_tokens, null);
});

test("measure keeps the result line's cost when it reports no modelUsage", () => {
  const { modelUsage, ...noModelUsage } = RESULT;
  assert.equal(measure(jsonl(INIT, assistant("m1", 70), noModelUsage)).cost_usd, 1.234567);
});

test("a run that opened a PR ends done with its measurements", async () => {
  const db = await freshLog();
  await startRun(db, RUN);
  const dir = runDir({
    "transcript.jsonl": jsonl(INIT, RESULT),
    "run.json": JSON.stringify({
      checks_passed: true,
      pr: "https://github.com/JakobKrzyston/factory-platform/pull/47",
      head_sha: "4dda246c",
    }),
  });
  assert.equal(await finishRun(db, RUN.id, "done", dir), true);
  const [row] = await db.query("SELECT * FROM runs");
  assert.equal(typeof row.wall_seconds, "number");
  assert.ok(row.ended_at);
  assert.deepEqual(
    { ...row, wall_seconds: undefined, started_at: undefined, ended_at: undefined },
    {
      ...RUN,
      model: "claude-sonnet-5-5",
      pr: 47,
      head_sha: "4dda246c",
      benchmark: 0,
      status: "done",
      started_at: undefined,
      ended_at: undefined,
      wall_seconds: undefined,
      input_tokens: 6,
      output_tokens: 72,
      cache_read_tokens: 2000,
      cache_write_tokens: 430,
      cost_usd: 1.234567,
      checks_passed: 1,
      review_findings: null,
      rework: null,
    },
  );
});

test("a review run records its findings on the PR it reviewed, and no head_sha", async () => {
  const db = await freshLog();
  await startRun(db, { ...RUN, role: "review" });
  // The shape run-issue.sh writes for a review: the reviewed commit is reviewed_sha, which rework must not see.
  const dir = runDir({ "run.json": JSON.stringify({ pr: "https://x/pull/47", reviewed_sha: "4dda246c", review_findings: 3 }) });
  assert.equal(await finishRun(db, RUN.id, "done", dir), true);
  const [row] = await db.query("SELECT role, pr, head_sha, review_findings, checks_passed FROM runs");
  assert.deepEqual({ ...row }, { role: "review", pr: 47, head_sha: null, review_findings: 3, checks_passed: null });
});

test("a fallback finish leaves an ended row alone, and a run that never started anything still ends", async () => {
  const db = await freshLog();
  await startRun(db, RUN);
  assert.equal(await finishRun(db, RUN.id, "needs_human", runDir({})), true);
  assert.equal(await finishRun(db, RUN.id, "failed"), false);
  const [row] = await db.query("SELECT status, model, input_tokens, cost_usd, checks_passed FROM runs");
  assert.deepEqual({ ...row }, { status: "needs_human", model: "sonnet", input_tokens: null, cost_usd: null, checks_passed: null });
  await assert.rejects(finishRun(db, "missing", "failed"), /no run log row with id missing/);
});

test("a finish that loses a race to another finish reports that it ended nothing", async () => {
  const db = await freshLog();
  await startRun(db, RUN);
  // The other finish lands between this one's read of the row and its update.
  const racing: RunLog = {
    ...db,
    query: async (text, params) => {
      if (text.startsWith("UPDATE")) await finishRun(db, RUN.id, "done");
      return db.query(text, params);
    },
  };
  assert.equal(await finishRun(racing, RUN.id, "failed"), false);
  const [row] = await db.query("SELECT status FROM runs");
  assert.equal(row.status, "done");
});

test("rework is set when the merged head is not the commit handed off", async () => {
  const db = await freshLog();
  const handOff = async (id: string, pr: number, head: string) => {
    await startRun(db, { ...RUN, id });
    await finishRun(db, id, "done", runDir({ "run.json": JSON.stringify({ pr: `https://x/pull/${pr}`, head_sha: head }) }));
  };
  await handOff("a", 47, "aaa"); // merged as handed off
  await handOff("b", 48, "bbb"); // a human pushed ccc before merging
  await handOff("c", 49, "ddd"); // still open
  await startRun(db, { ...RUN, id: "d" }); // merged, but its run recorded no head_sha, so rework is unknown
  await finishRun(db, "d", "failed", runDir({ "run.json": JSON.stringify({ pr: "https://x/pull/50" }) }));
  const heads: Record<number, { merged: boolean; head: string }> = {
    47: { merged: true, head: "aaa" },
    48: { merged: true, head: "ccc" },
    49: { merged: false, head: "ddd" },
    50: { merged: true, head: "eee" },
  };
  assert.deepEqual(await recordRework(db, RUN.repo, RUN.issue, (pr) => heads[pr]), [
    { pr: 47, rework: false },
    { pr: 48, rework: true },
  ]);
  const rows = await db.query("SELECT pr, rework FROM runs ORDER BY pr");
  assert.deepEqual(
    rows.map((r) => ({ ...r })),
    [
      { pr: 47, rework: 0 },
      { pr: 48, rework: 1 },
      { pr: 49, rework: null },
      { pr: 50, rework: null },
    ],
  );
});
