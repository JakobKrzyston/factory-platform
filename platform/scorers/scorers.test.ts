/** Tests the scorer files, each measure, and that scores are stored with their run and read back by the
 *  dashboard. Run: pnpm test */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Case } from "../bench/cases";
import { readScores } from "../dashboard/dashboard";
import { FACTORIES_DIR } from "../factory/factory";
import { openRunLog, startRun } from "../runlog/runlog";
import { type Subject, MEASURES, formatScore, parseScorer, readScorers, saveScores, scoreResult } from "./scorers";

const CASE: Case = {
  id: "60-lint",
  issue: 60,
  pr: 62,
  base_sha: "5d7abe927640a9c9f87acf316f3abf5a089c8f8e",
  role: "implement",
  stages: ["implement", "review"],
  files: ["scripts/check-merge-gate.ts", "docs/notes/60.md"],
  checks: "pnpm test",
  title: "Fix the lint warnings",
  body: "Fix them.",
};

function subject(overrides: Partial<Subject>): Subject {
  return {
    case: CASE,
    role: "implement",
    outcome: "done",
    cost_usd: 0.05,
    wall_seconds: 25,
    review_findings: null,
    patch: null,
    source: "/nonexistent",
    ...overrides,
  };
}

function writePatch(text: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "scorer-patch-")), "changes.patch");
  writeFileSync(path, text);
  return path;
}

const scorers = (...measures: string[]) => measures.map((measure) => ({ name: measure, measure }));

test("the code factory's scorer files all parse, one per measure", () => {
  assert.deepEqual(readScorers(join(FACTORIES_DIR, "code", "scorers")), [
    { name: "cost", measure: "cost" },
    { name: "findings", measure: "findings" },
    { name: "scope", measure: "scope" },
    { name: "tests", measure: "tests" },
  ]);
  assert.deepEqual(readScorers(join(FACTORIES_DIR, "code", "no-such-dir")), []);
});

test("parseScorer refuses missing fences, an unknown field or measure, and a file that says nothing", () => {
  assert.deepEqual(parseScorer("spend", "---\nmeasure: cost\n---\nDollars.\n"), { name: "spend", measure: "cost" });
  assert.throws(() => parseScorer("x", "measure: cost\n"), /settings between --- lines/);
  assert.throws(() => parseScorer("x", "---\nmeasure: cost\nweight: 2\n---\nDollars.\n"), /unknown fields: weight/);
  assert.throws(() => parseScorer("x", "---\nmeasure: vibes\n---\nHow it felt.\n"), /measure must be one of tests, scope, findings, cost/);
  assert.throws(() => parseScorer("x", "---\nmeasure: toString\n---\nNot a measure.\n"), /measure must be one of/);
  assert.throws(() => parseScorer("x", "---\nmeasure: cost\n---\n\n"), /says nothing after its settings/);
});

test("scope is the share of the patch's files among the case's files, counting both sides of a rename", () => {
  const inside = writePatch("diff --git a/scripts/check-merge-gate.ts b/scripts/check-merge-gate.ts\n--- a/x\n+++ b/x\n");
  assert.deepEqual(MEASURES.scope(subject({ patch: inside })), {
    score: 1,
    reason: "1 changed file, all among the case's files",
  });
  const outside = writePatch(
    [
      "diff --git a/scripts/check-merge-gate.ts b/scripts/check-merge-gate.ts",
      "diff --git a/docs/notes/60.md b/docs/notes/61.md",
      "rename from docs/notes/60.md",
      "diff --git a/biome.json b/biome.json",
    ].join("\n"),
  );
  assert.deepEqual(MEASURES.scope(subject({ patch: outside })), {
    score: 0.5,
    reason: "2 of 4 changed files among the case's files; outside: biome.json, docs/notes/61.md",
  });
  assert.equal(MEASURES.scope(subject({ patch: null })), null);
  assert.equal(MEASURES.scope(subject({ role: "review", patch: inside })), null);
});

test("findings and cost score whatever run recorded them, and nothing that did not", () => {
  assert.deepEqual(MEASURES.findings(subject({ role: "review", review_findings: 3 })), { score: 3, reason: "the review raised 3 findings" });
  assert.deepEqual(MEASURES.findings(subject({ role: "review", review_findings: 1 })), { score: 1, reason: "the review raised 1 finding" });
  assert.equal(MEASURES.findings(subject({ role: "review", review_findings: null })), null);
  assert.deepEqual(MEASURES.cost(subject({ role: "triage", cost_usd: 0.0042, wall_seconds: 11 })), {
    score: 0.0042,
    reason: "$0.004 for triage in 11s",
  });
  assert.equal(MEASURES.cost(subject({ cost_usd: null })), null);
});

test("tests scores 0 for an implement run that handed off nothing, and leaves other runs alone", () => {
  assert.deepEqual(MEASURES.tests(subject({ outcome: "needs_human" })), {
    score: 0,
    reason: "implement ended needs_human and handed off no patch",
  });
  assert.equal(MEASURES.tests(subject({ role: "spec" })), null);
  assert.equal(MEASURES.tests(subject({ case: { ...CASE, checks: "" } })), null);
});

test(
  "tests runs the case's checks on the base plus the patch, with the base's scripts, in the sandbox",
  // The checks run under srt, which cannot start inside the gate's own sandbox.
  { skip: process.env.SANDBOX_RUNTIME === "1" && "srt cannot run inside the gate's sandbox" },
  () => {
    const repo = mkdtempSync(join(tmpdir(), "scorer-repo-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    git("init", "--quiet");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "test -f ok.txt" } }));
    git("add", "package.json");
    git("-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "--quiet", "-m", "base");
    const base = git("rev-parse", "HEAD");
    const patchOf = (change: () => void) => {
      change();
      git("add", "-A");
      const patch = writePatch(`${git("diff", "--cached", "--binary")}\n`);
      git("reset", "--quiet", "--hard", base);
      git("clean", "--quiet", "-fd");
      return patch;
    };
    const fixes = patchOf(() => writeFileSync(join(repo, "ok.txt"), "ok\n"));
    // A patch that makes `pnpm test` succeed by rewriting the script, not by doing the work.
    const cheats = patchOf(() => writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "true" } })));
    const run = (patch: string, checks = "pnpm test") =>
      MEASURES.tests(subject({ case: { ...CASE, base_sha: base, checks }, patch, source: repo }));

    const passed = run(fixes);
    assert.equal(passed?.score, 1);
    assert.match(passed?.reason ?? "", /^the case's checks passed on the patch in [\d.]+s$/);
    assert.deepEqual(run(cheats), { score: 0, reason: "the case's checks failed (exit 1): no output" });
    // The checks cannot read the home directory, where the bench's checkout and the owner's keys live.
    assert.equal(run(fixes, `pnpm test && ls ${JSON.stringify(process.env.HOME)} > /dev/null`)?.score, 0);
    assert.equal(run(fixes, "pnpm exec true")?.score, 1);
    assert.match(run(fixes, "pnpm build")?.reason ?? "", /pnpm build: not a script in the base's package.json$/);
  },
);

test("scores are stored with their run and read back for the dashboard, benchmark runs only", async () => {
  const db = await openRunLog("", join(mkdtempSync(join(tmpdir(), "scores-")), "runlog.db"));
  const run = { factory: "code", factory_sha: "5477cf4c0ffee", model: "sonnet", repo: "o/r", issue: 60 };
  await startRun(db, { ...run, id: "bench-1", role: "implement", benchmark: true });
  await startRun(db, { ...run, id: "prod-1", role: "implement" });
  const scores = scoreResult(scorers("findings", "cost"), subject({ cost_usd: 0.1, wall_seconds: 30 }));
  assert.deepEqual(scores, [{ scorer: "cost", score: 0.1, reason: "$0.100 for implement in 30s" }]);
  await saveScores(db, "bench-1", scores);
  await saveScores(db, "prod-1", scores);
  await assert.rejects(saveScores(db, "bench-1", scores), /UNIQUE constraint failed/);

  const read = await readScores(db);
  assert.deepEqual(
    read.map(({ run_id, factory_sha, issue, role, scorer, score, reason }) => ({ run_id, factory_sha, issue, role, scorer, score, reason })),
    [{ run_id: "bench-1", factory_sha: "5477cf4c0ffee", issue: 60, role: "implement", scorer: "cost", score: 0.1, reason: "$0.100 for implement in 30s" }],
  );
  await db.close();
});

test("formatScore keeps at most three decimals", () => {
  assert.deepEqual([1, 0.5, 0.07123, 2 / 3].map(formatScore), ["1", "0.5", "0.071", "0.667"]);
});
