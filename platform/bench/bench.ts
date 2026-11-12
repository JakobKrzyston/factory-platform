/** The replay harness (TL-15): replays every benchmark case through one factory version, checked out at a git
 *  ref in a clone of its own, and prints a summary table. Each run is a row in the run log marked benchmark.
 *  Exports bench and formatSummary.
 *
 *  pnpm bench <factory> <git-ref> [--case <id>] [--max-usd <n>]
 *
 *  --case runs one case: its directory name under benchmark/, or its issue number. --max-usd (default 10) stops
 *  starting runs once the benchmark has spent that much; a run can overshoot it by up to its role's budget_usd. */
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { openRunLog } from "../runlog/runlog";
import { type Case, readCases } from "./cases";

/** One stage of one case: how its run ended, from its run log row. */
export type Result = {
  case: string;
  role: string;
  outcome: string;
  checks_passed: boolean | null;
  cost_usd: number | null;
  wall_seconds: number | null;
};

const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** Replays cases through the factory at a ref, one stage at a time, handing each stage's output to the next as
 *  the queue would through GitHub: the triage note and the spec as comments, the implement run's patch as the
 *  PR the reviewer reviews. A stage that does not end `done` ends its case.
 *
 *  Args:
 *    root: this checkout. Its benchmark/ holds the cases, its repository supplies both the ref and each case's
 *      base_sha, and its .runlog/ receives the run directories and, without DATABASE_URL, the rows.
 *    factory: the directory under factories/ at the ref.
 *    ref: any git ref or commit; the run log records the commit as factory_sha.
 *    cases: the cases to replay.
 *    maxUsd: no run starts once the runs so far cost this much; the rest are `skipped`.
 *  Returns: one result per stage that ran or was skipped.
 *  Raises: if the ref is unknown, its run-issue.sh cannot replay, or it has no such factory. */
export async function bench(root: string, factory: string, ref: string, cases: Case[], maxUsd: number): Promise<Result[]> {
  const sha = git(root, ["rev-parse", "--verify", `${ref}^{commit}`]);
  const source = git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  const repo = git(root, ["remote", "get-url", "origin"]).match(/github\.com[:/](.+?)(\.git)?$/)?.[1];
  if (!repo) throw new Error("origin is not a GitHub repository");
  const base = git(root, ["rev-parse", "--abbrev-ref", "origin/HEAD"]).replace(/^origin\//, "");

  const work = mkdtempSync(join(tmpdir(), "bench-"));
  const factoryDir = join(work, "factory");
  const runlogLink = join(factoryDir, ".runlog");
  try {
    git(work, ["clone", "--quiet", "--no-checkout", source, factoryDir]);
    git(factoryDir, ["switch", "--quiet", "--detach", sha]);
    // A version from before replay existed would fetch the live issue and publish its PR and comments.
    const script = join(factoryDir, "scripts/run-issue.sh");
    if (!existsSync(script) || !readFileSync(script, "utf8").includes("REPLAY")) {
      throw new Error(`${ref} has no replay mode in scripts/run-issue.sh, so it cannot be benchmarked`);
    }
    if (!existsSync(join(factoryDir, "factories", factory))) throw new Error(`${ref} has no factories/${factory}/`);
    // Run directories and SQLite rows land in this checkout's .runlog/, not in the clone deleted below.
    mkdirSync(join(root, ".runlog"), { recursive: true });
    symlinkSync(join(root, ".runlog"), runlogLink);
    execFileSync("pnpm", ["install", "--frozen-lockfile", "--silent"], { cwd: factoryDir, stdio: "inherit" });

    const db = await openRunLog();
    const results: Result[] = [];
    let spent = 0;
    try {
      for (const c of cases) {
        const comments: { user: { login: string }; body: string }[] = [];
        let patch = "";
        for (const role of c.stages) {
          if (spent >= maxUsd) {
            results.push({ case: c.id, role, outcome: "skipped", checks_passed: null, cost_usd: null, wall_seconds: null });
            continue;
          }
          const replay = join(work, `${c.id}-${role}.json`);
          writeFileSync(replay, JSON.stringify({ source, base, base_sha: c.base_sha, title: c.title, body: c.body, comments, patch }));
          const id = randomUUID();
          const run = spawnSync("bash", [script, role, `https://github.com/${repo}/issues/${c.issue}`], {
            env: { ...process.env, FACTORY: factory, REPLAY: replay, RUN_LOG_ID: id },
            stdio: ["ignore", "pipe", "inherit"],
            encoding: "utf8",
          });
          const [row] = await db.query("SELECT status, checks_passed, cost_usd, wall_seconds FROM runs WHERE id = ?", [id]);
          // SQLite returns booleans as 1/0, Postgres numerics as strings.
          const known = (v: unknown) => v !== null && v !== undefined;
          const result: Result = {
            case: c.id,
            role,
            // No row: the script stopped before it could insert one.
            outcome: (row?.status as string) ?? "failed",
            checks_passed: known(row?.checks_passed) ? Boolean(row.checks_passed) : null,
            cost_usd: known(row?.cost_usd) ? Number(row.cost_usd) : null,
            wall_seconds: known(row?.wall_seconds) ? Number(row.wall_seconds) : null,
          };
          results.push(result);
          spent += result.cost_usd ?? 0;
          if (run.status !== 0) break;
          const out = run.stdout.trim();
          const login = process.env.FACTORY_BOT || "factory";
          // The bodies the factory workflow posts, without their run log links.
          if (role === "triage") comments.push({ user: { login }, body: `**Triage**\n\n${out}` });
          if (role === "spec") comments.push({ user: { login }, body: out });
          if (role === "implement") patch = out;
        }
      }
    } finally {
      await db.close();
    }
    return results;
  } finally {
    // Unlinked first, so removing the clone cannot reach this checkout's run log.
    if (existsSync(runlogLink)) unlinkSync(runlogLink);
    rmSync(work, { recursive: true, force: true });
  }
}

/** Formats results as an aligned text table, with a total.
 *  Args: results: from bench.
 *  Returns: the table, one line per result. */
export function formatSummary(results: Result[]): string {
  const rows = results.map((r) => [
    r.case,
    r.role,
    r.outcome,
    r.checks_passed === null ? "-" : r.checks_passed ? "passed" : "failed",
    r.cost_usd === null ? "-" : `$${r.cost_usd.toFixed(2)}`,
    r.wall_seconds === null ? "-" : `${r.wall_seconds}s`,
  ]);
  const total = results.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
  const wall = results.reduce((sum, r) => sum + (r.wall_seconds ?? 0), 0);
  const table = [["case", "role", "outcome", "checks", "cost", "wall time"], ...rows, ["total", "", "", "", `$${total.toFixed(2)}`, `${wall}s`]];
  const widths = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
  return table.map((row) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd()).join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { case: { type: "string" }, "max-usd": { type: "string", default: "10" } },
  });
  const maxUsd = Number(values["max-usd"]);
  if (positionals.length !== 2 || !(maxUsd > 0)) {
    console.error("usage: pnpm bench <factory> <git-ref> [--case <id>] [--max-usd <n>]");
    process.exit(2);
  }
  const [factory, ref] = positionals;
  const root = process.cwd();
  const cases = readCases(join(root, "benchmark")).filter(
    (c) => values.case === undefined || c.id === values.case || String(c.issue) === values.case,
  );
  if (cases.length === 0) {
    console.error(values.case ? `no benchmark case ${values.case}` : "no cases under benchmark/");
    process.exit(1);
  }
  try {
    console.log(formatSummary(await bench(root, factory, ref, cases, maxUsd)));
  } catch (error) {
    console.error(`bench: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
