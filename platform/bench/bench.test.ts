/** Tests the benchmark case reader, the summary table, and run-issue.sh's replay mode, which must write nothing
 *  to GitHub and mark its rows benchmark. Run: pnpm test */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { readRuns } from "../dashboard/dashboard";
import { openRunLog } from "../runlog/runlog";
import { formatSummary } from "./bench";
import { parseCase } from "./cases";

// The format TL-14 owns, as the brief for TL-15 gives it.
const CASE = `---
issue: 12
pr: 47
base_sha: d40a26e0ffeed40a26e0ffeed40a26e0ffeed40a
role: implement
stages: spec, implement, review
files: platform/runlog/runlog.ts, scripts/run-issue.sh
checks: pnpm test
---
## Issue

# TL-12: Run log rows

Every run writes a row.

### Acceptance

- A row per run.

## Expected outcome

runlog.ts writes the row.
`;

test("parseCase reads the settings and splits the issue snapshot into title and body", () => {
  assert.deepEqual(parseCase("12-run-log-rows", CASE), {
    id: "12-run-log-rows",
    issue: 12,
    base_sha: "d40a26e0ffeed40a26e0ffeed40a26e0ffeed40a",
    role: "implement",
    stages: ["spec", "implement", "review"],
    title: "TL-12: Run log rows",
    body: "Every run writes a row.\n\n### Acceptance\n\n- A row per run.",
  });
});

test("parseCase refuses a review with nothing to review, an unknown stage and a missing snapshot", () => {
  assert.throws(() => parseCase("c", CASE.replace("spec, implement, review", "implement, review")), /needs spec and implement/);
  assert.throws(() => parseCase("c", CASE.replace("spec, implement", "spec, build")), /unknown stages: build/);
  assert.throws(() => parseCase("c", CASE.replace("## Issue", "## Problem")), /missing ## Issue/);
  assert.throws(() => parseCase("c", CASE.replace("base_sha: d40a", "base_sha: main")), /base_sha must be a commit/);
});

test("formatSummary aligns the columns and totals cost and wall time", () => {
  const table = formatSummary([
    { case: "12-run-log-rows", role: "spec", outcome: "done", checks_passed: null, cost_usd: 0.123, wall_seconds: 40 },
    { case: "12-run-log-rows", role: "implement", outcome: "failed", checks_passed: false, cost_usd: 2, wall_seconds: 900 },
    { case: "12-run-log-rows", role: "review", outcome: "skipped", checks_passed: null, cost_usd: null, wall_seconds: null },
  ]);
  assert.equal(
    table,
    [
      "case             role       outcome  checks  cost   wall time",
      "12-run-log-rows  spec       done     -       $0.12  40s",
      "12-run-log-rows  implement  failed   failed  $2.00  900s",
      "12-run-log-rows  review     skipped  -       -      -",
      "total                                        $2.12  940s",
    ].join("\n"),
  );
});

const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "../..");
const sh = (cwd: string, ...args: string[]) => execFileSync(args[0], args.slice(1), { cwd, encoding: "utf8" }).trim();

/** A stand-in for claude: finishes at once, as the run's gate would record a pass, with a change in the clone. */
const FAKE_CLAUDE = `#!/usr/bin/env bash
if [[ \${1:-} == --version ]]; then echo "0.0.0 (fake)"; exit 0; fi
while [[ $# -gt 0 ]]; do [[ $1 == --settings ]] && settings=$2; shift; done
run_dir=$(dirname "$settings")
cat > /dev/null
if [[ $(jq -r .role "$run_dir/run.json") == review ]]; then
  result=$'## Findings\\n\\nNone.'
else
  echo '{"passed": true, "checks": [], "description_problems": []}' >> "$run_dir/gates.jsonl"
  echo replayed > replayed.txt
  result="A description."
fi
jq -cn --arg result "$result" '{type: "result", subtype: "success", is_error: false, result: $result,
  num_turns: 1, duration_ms: 1000, total_cost_usd: 0.01,
  modelUsage: {fake: {inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0}}}'
`;

test(
  "a replay reads and writes nothing on GitHub, pushes nothing, and its rows are benchmark rows the dashboard leaves out",
  // run-issue.sh starts tsx's CLI, whose IPC socket the gate's sandbox denies.
  { skip: process.env.SANDBOX_RUNTIME === "1" && "run-issue.sh cannot run inside the gate's sandbox" },
  async () => {
    const work = mkdtempSync(join(tmpdir(), "replay-"));

    // This checkout's files as they are now, untracked ones included, ignored ones (such as .env.local) not.
    const root = join(work, "root");
    for (const file of sh(REPO_ROOT, "git", "ls-files", "-co", "--exclude-standard").split("\n")) {
      if (existsSync(join(REPO_ROOT, file))) cpSync(join(REPO_ROOT, file), join(root, file), { recursive: true });
    }
    symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));
    sh(root, "git", "init", "--quiet");
    writeFileSync(join(root, ".git/info/exclude"), "node_modules\n");
    sh(root, "git", "add", "-A");
    sh(root, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "factory");

    // The repository the case replays on.
    const target = join(work, "target");
    mkdirSync(target);
    sh(target, "git", "init", "--quiet");
    writeFileSync(join(target, "README.md"), "target\n");
    sh(target, "git", "add", "-A");
    sh(target, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "base");
    const baseSha = sh(target, "git", "rev-parse", "HEAD");

    // gh fails and records every call; git records every call and then runs.
    const bin = join(work, "bin");
    const calls = join(work, "calls.log");
    mkdirSync(bin);
    const write = (name: string, text: string) => {
      writeFileSync(join(bin, name), text);
      chmodSync(join(bin, name), 0o755);
    };
    write("gh", `#!/usr/bin/env bash\necho "gh $*" >> "${calls}"\nexit 1\n`);
    write("git", `#!/usr/bin/env bash\necho "git $*" >> "${calls}"\nexec "${sh(work, "which", "git")}" "$@"\n`);
    write("claude", FAKE_CLAUDE);

    const replay = (role: string, patch: string) => {
      const file = join(work, `${role}.json`);
      const spec = { user: { login: "factory" }, body: "<!-- factory:spec -->\n\nWrite replayed.txt." };
      writeFileSync(file, JSON.stringify({ source: target, base: "main", base_sha: baseSha, title: "T", body: "B", comments: [spec], patch }));
      return spawnSync("bash", [join(root, "scripts/run-issue.sh"), role, "https://github.com/o/r/issues/7"], {
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, ANTHROPIC_API_KEY: "test", DATABASE_URL: "", REPLAY: file },
        encoding: "utf8",
      });
    };

    const implement = replay("implement", "");
    assert.equal(implement.status, 0, implement.stderr);
    const patch = implement.stdout.trim();
    assert.match(readFileSync(patch, "utf8"), /\+\+\+ b\/replayed.txt/);
    const review = replay("review", patch);
    assert.equal(review.status, 0, review.stderr);
    assert.match(readFileSync(review.stdout.trim(), "utf8"), /## Findings/);

    const log = readFileSync(calls, "utf8");
    assert.doesNotMatch(log, /^gh /m);
    assert.doesNotMatch(log, /^git .*\bpush\b/m);

    const db = await openRunLog("", join(root, ".runlog/runlog.db"));
    const rows = await db.query("SELECT role, status, benchmark, checks_passed, cost_usd FROM runs ORDER BY started_at");
    assert.deepEqual(
      rows.map((r) => ({ ...r })),
      [
        { role: "implement", status: "done", benchmark: 1, checks_passed: 1, cost_usd: 0.01 },
        { role: "review", status: "done", benchmark: 1, checks_passed: null, cost_usd: 0.01 },
      ],
    );
    assert.deepEqual(await readRuns(db), []);
    await db.close();
  },
);
