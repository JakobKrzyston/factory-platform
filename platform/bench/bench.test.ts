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

TL-12: Run log rows

\`\`\`\`markdown
Every run writes a row.

## Acceptance

- A row per run.
\`\`\`\`

## Expected outcome

runlog.ts writes the row.
`;

test("parseCase reads the settings and splits the issue snapshot into title and body", () => {
  assert.deepEqual(parseCase("12-run-log-rows", CASE), {
    id: "12-run-log-rows",
    issue: 12,
    pr: 47,
    base_sha: "d40a26e0ffeed40a26e0ffeed40a26e0ffeed40a",
    role: "implement",
    stages: ["spec", "implement", "review"],
    files: ["platform/runlog/runlog.ts", "scripts/run-issue.sh"],
    checks: "pnpm test",
    title: "TL-12: Run log rows",
    body: "Every run writes a row.\n\n## Acceptance\n\n- A row per run.",
  });
});

test("parseCase accepts a review of the case's PR alone, and refuses a review with nothing to review", () => {
  const reviewOnly = parseCase("c", CASE.replace("spec, implement, review", "review"));
  assert.deepEqual([reviewOnly.stages, reviewOnly.pr], [["review"], 47]);
  assert.throws(() => parseCase("c", CASE.replace("spec, implement, review", "review").replace("pr: 47\n", "")), /needs an implement stage before it or a pr/);
});

test("parseCase refuses an unknown stage, a missing snapshot and a base that is not a commit", () => {
  assert.throws(() => parseCase("c", CASE.replace("spec, implement", "spec, build")), /unknown stages: build/);
  assert.throws(() => parseCase("c", CASE.replace("## Issue", "## Problem")), /missing ## Issue/);
  assert.throws(() => parseCase("c", CASE.replace("base_sha: d40a", "base_sha: main")), /base_sha must be a commit/);
});

test("formatSummary aligns the columns, totals cost and wall time, and lists each result's scores", () => {
  const table = formatSummary([
    {
      case: "12-run-log-rows",
      role: "spec",
      outcome: "done",
      checks_passed: null,
      cost_usd: 0.123,
      wall_seconds: 40,
      scores: [{ scorer: "cost", score: 0.123, reason: "$0.123 for spec in 40s" }],
    },
    {
      case: "12-run-log-rows",
      role: "implement",
      outcome: "failed",
      checks_passed: false,
      cost_usd: 2,
      wall_seconds: 900,
      scores: [
        { scorer: "cost", score: 2, reason: "$2.000 for implement in 900s" },
        { scorer: "tests", score: 0, reason: "implement ended failed and handed off no patch" },
      ],
    },
    { case: "12-run-log-rows", role: "review", outcome: "skipped", checks_passed: null, cost_usd: null, wall_seconds: null, scores: [] },
  ]);
  assert.equal(
    table,
    [
      "case             role       outcome  checks  cost   wall time  scores",
      "12-run-log-rows  spec       done     -       $0.12  40s        cost 0.123",
      "12-run-log-rows  implement  failed   failed  $2.00  900s       cost 2, tests 0",
      "12-run-log-rows  review     skipped  -       -      -          -",
      "total                                        $2.12  940s",
    ].join("\n"),
  );
});

const REPO_ROOT = join(dirname(new URL(import.meta.url).pathname), "../..");
const sh = (cwd: string, ...args: string[]) => execFileSync(args[0], args.slice(1), { cwd, encoding: "utf8" }).trim();

/** The values claude was given for --allowedTools, which takes every argument up to the next flag. */
function allowedTools(runDir: string): string[] {
  const args = readFileSync(join(runDir, "args.txt"), "utf8").trimEnd().split("\n");
  const start = args.indexOf("--allowedTools") + 1;
  const end = args.findIndex((arg, i) => i >= start && arg.startsWith("--"));
  return args.slice(start, end);
}

/** A stand-in for claude: records its arguments, then finishes at once, as the run's gate would record a pass,
 *  with a change in the clone. */
const FAKE_CLAUDE = `#!/usr/bin/env bash
if [[ \${1:-} == --version ]]; then echo "0.0.0 (fake)"; exit 0; fi
args=("$@")
while [[ $# -gt 0 ]]; do [[ $1 == --settings ]] && settings=$2; shift; done
run_dir=$(dirname "$settings")
printf '%s\\n' "\${args[@]}" > "$run_dir/args.txt"
cat > /dev/null
git log --all --format=%H > "$run_dir/history.txt"
if [[ $(jq -r .contract "$run_dir/run.json") == review ]]; then
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
  "a replay reads and writes nothing on GitHub, pushes nothing, sees no commit after its base, and its rows are benchmark rows the dashboard leaves out",
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
    // A factory of the test's own, whose agents are named for nothing run-issue.sh knows: their contracts pick
    // what each is given and what becomes of its answer (TL-18).
    const agent = (contract: string, tools: string) =>
      `---\ndescription: A test agent.\ncontract: ${contract}\nmodel: fake\ntools: ${tools}\nbudget_usd: 1\ntime_limit_seconds: 60\n---\nDo the ${contract}.\n`;
    const demo = {
      "agents/build/agent.md": agent("pull-request", "Bash, Edit, Read, Write"),
      "agents/check/agent.md": agent("review", "Bash, Read"),
      "agents/check/skills/cite/SKILL.md": "---\nname: cite\n---\nCite the check skill.\n\n---\n\nAfter a rule.\n",
      "agents/check/skills/plain/SKILL.md": "A skill without front matter.\n",
      "skills/pr-description/SKILL.md": "Describe the build skill.\n",
    };
    for (const [path, text] of Object.entries(demo)) {
      mkdirSync(dirname(join(root, "factories/demo", path)), { recursive: true });
      writeFileSync(join(root, "factories/demo", path), text);
    }
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
    // The commit that closed the issue, which the agent must not be able to read.
    writeFileSync(join(target, "answer.txt"), "answer\n");
    sh(target, "git", "add", "-A");
    sh(target, "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "answer");

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

    const replay = (agent: string, patch: string) => {
      const file = join(work, `${agent}.json`);
      const spec = { user: { login: "factory" }, body: "<!-- factory:spec -->\n\nWrite replayed.txt." };
      writeFileSync(file, JSON.stringify({ source: target, base: "main", base_sha: baseSha, title: "T", body: "B", comments: [spec], patch }));
      return spawnSync("bash", [join(root, "scripts/run-issue.sh"), agent, "https://github.com/o/r/issues/7"], {
        env: { PATH: `${bin}:${process.env.PATH}`, HOME: process.env.HOME, ANTHROPIC_API_KEY: "test", DATABASE_URL: "", REPLAY: file, FACTORY: "demo" },
        encoding: "utf8",
      });
    };

    const build = replay("build", "");
    assert.equal(build.status, 0, build.stderr);
    const patch = build.stdout.trim();
    assert.match(readFileSync(patch, "utf8"), /\+\+\+ b\/replayed.txt/);
    assert.equal(readFileSync(join(dirname(patch), "history.txt"), "utf8").trim(), baseSha);
    // Each agent gets the file tools its agent.md lists, confined to the clone; a pull-request agent creates files
    // with Write (#67).
    assert.deepEqual(allowedTools(dirname(patch)), ["Read(./**)", "Edit(./**)", "Write(./**)"]);
    // The pull-request contract hands the agent the factory's pr-description skill, whose gate it runs under.
    const buildArgs = readFileSync(join(dirname(patch), "args.txt"), "utf8");
    assert.match(buildArgs, /Do the pull-request\.\n\nWrite the pull request description as this skill says:\n\nDescribe the build skill\./);
    assert.match(readFileSync(join(dirname(patch), "settings.json"), "utf8"), /stop-hook\.ts/);
    const check = replay("check", patch);
    assert.equal(check.status, 0, check.stderr);
    assert.match(readFileSync(check.stdout.trim(), "utf8"), /## Findings/);
    // The reviewer, which lists neither Edit nor Write, can only read, and gets its own skills without their front
    // matter, then the standing rules its citation gate checks.
    assert.deepEqual(allowedTools(dirname(check.stdout.trim())), ["Read(./**)"]);
    const checkArgs = readFileSync(join(dirname(check.stdout.trim()), "args.txt"), "utf8");
    assert.match(checkArgs, /Do the review\.\n\nCite the check skill\.\n\n---\n\nAfter a rule\.\n\nA skill without front matter\.\n\n# Standing rules/);
    assert.doesNotMatch(checkArgs, /name: cite|Describe the build skill/);
    assert.match(readFileSync(join(dirname(check.stdout.trim()), "settings.json"), "utf8"), /standards\.ts review-hook/);

    const log = readFileSync(calls, "utf8");
    assert.doesNotMatch(log, /^gh /m);
    assert.doesNotMatch(log, /^git .*\bpush\b/m);

    const db = await openRunLog("", join(root, ".runlog/runlog.db"));
    const rows = await db.query("SELECT role, status, benchmark, checks_passed, cost_usd FROM runs ORDER BY started_at");
    assert.deepEqual(
      rows.map((r) => ({ ...r })),
      [
        { role: "build", status: "done", benchmark: 1, checks_passed: 1, cost_usd: 0.01 },
        { role: "check", status: "done", benchmark: 1, checks_passed: null, cost_usd: 0.01 },
      ],
    );
    assert.deepEqual(await readRuns(db), []);
    await db.close();
  },
);
