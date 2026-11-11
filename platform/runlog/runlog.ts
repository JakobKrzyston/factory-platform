/** Writes the run log: a row when a run starts, its outcome and measurements when it ends, and rework when its
 *  PR merges. Exports openRunLog, startRun, finishRun, measure and recordRework; run as a CLI by run-issue.sh
 *  and the factory workflow. Postgres when DATABASE_URL is set, otherwise SQLite in .runlog/.
 *
 *  tsx platform/runlog/runlog.ts start <id> <factory> <role> <factory_sha> <model> <owner/repo> <issue>
 *  tsx platform/runlog/runlog.ts finish <id> <done|needs_human|failed> [run-dir]
 *  tsx platform/runlog/runlog.ts rework <owner/repo> <issue>        needs `gh` signed in */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import postgres from "postgres";

import { DEFAULT_SQLITE_PATH, migratePostgres, migrateSqlite } from "./migrate";

type Param = string | number | boolean | null;

/** The run log database, with `?` placeholders in either dialect. */
export type RunLog = {
  query(text: string, params?: Param[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
};

/** Opens the run log, applying any pending migrations first.
 *  Args: url: a Postgres connection string, or empty for SQLite; path: the SQLite file.
 *  Returns: the open run log. */
export async function openRunLog(url = process.env.DATABASE_URL, path = DEFAULT_SQLITE_PATH): Promise<RunLog> {
  if (url) {
    await migratePostgres(url);
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    return {
      query: async (text, params = []) => {
        let n = 0;
        return [...(await sql.unsafe(text.replace(/\?/g, () => `$${++n}`), params))];
      },
      close: () => sql.end(),
    };
  }
  migrateSqlite(path);
  const db = new DatabaseSync(path);
  return {
    // node:sqlite binds no booleans; SQLite stores them as 1 and 0 anyway.
    query: async (text, params = []) => db.prepare(text).all(...params.map((p) => (typeof p === "boolean" ? Number(p) : p))),
    close: async () => db.close(),
  };
}

/** Inserts a run's row with status `running`.
 *  Args: db: the run log; run: the identity columns (see README.md). */
export async function startRun(
  db: RunLog,
  run: { id: string; factory: string; role: string; factory_sha: string; model: string; repo: string; issue: number },
): Promise<void> {
  await db.query(
    "INSERT INTO runs (id, factory, role, factory_sha, model, repo, issue, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [run.id, run.factory, run.role, run.factory_sha, run.model, run.repo, run.issue, new Date().toISOString()],
  );
}

/** What a run's transcript says it used. */
export type Measurements = {
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
};

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type ModelUsage = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number };

/** Reads a run's model, tokens and cost from Claude Code's stream-json transcript.
 *  Args: transcript: the transcript.jsonl text; a killed run can leave its last line truncated.
 *  Returns: the measurements; cost is null when the run ended without a result line. */
export function measure(transcript: string): Measurements {
  const lines = transcript.split("\n").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const model: string | null = lines.find((l) => l.type === "system" && l.subtype === "init")?.model ?? null;
  const result = lines.filter((l) => l.type === "result").at(-1);

  // modelUsage covers every model the run called, which is what total_cost_usd is the cost of.
  if (result?.modelUsage) {
    const usage = Object.values(result.modelUsage) as ModelUsage[];
    const total = (key: keyof ModelUsage) => usage.reduce((sum, u) => sum + (u[key] ?? 0), 0);
    return {
      model,
      input_tokens: total("inputTokens"),
      output_tokens: total("outputTokens"),
      cache_read_tokens: total("cacheReadInputTokens"),
      cache_write_tokens: total("cacheCreationInputTokens"),
      cost_usd: result.total_cost_usd ?? null,
    };
  }

  // A killed run writes no result line. Its tokens are still in the assistant messages, each of which is
  // streamed once per content block with the same usage, so count each message id once.
  const byMessage = new Map<string, Usage>();
  for (const l of lines) if (l.type === "assistant" && l.message?.usage) byMessage.set(l.message.id, l.message.usage);
  if (byMessage.size === 0) {
    return { model, input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_write_tokens: null, cost_usd: null };
  }
  const usage = [...byMessage.values()];
  const total = (key: keyof Usage) => usage.reduce((sum, u) => sum + (u[key] ?? 0), 0);
  return {
    model,
    input_tokens: total("input_tokens"),
    output_tokens: total("output_tokens"),
    cache_read_tokens: total("cache_read_input_tokens"),
    cache_write_tokens: total("cache_creation_input_tokens"),
    cost_usd: null,
  };
}

/** Ends a running row with its outcome and, given the run directory, its measurements. A row that has already
 *  ended is left alone, so a fallback can call this after the run has finished its own row.
 *
 *  Args:
 *    db: the run log.
 *    id: the row's id.
 *    status: `done`, `needs_human` or `failed`.
 *    runDir: run-issue.sh's .runlog/runs/<run-id>/, read for transcript.jsonl and run.json when present.
 *  Returns: true if the row was ended now, false if it had already ended.
 *  Raises: if there is no row with this id. */
export async function finishRun(db: RunLog, id: string, status: string, runDir?: string): Promise<boolean> {
  const [row] = await db.query("SELECT status, started_at FROM runs WHERE id = ?", [id]);
  if (!row) throw new Error(`no run log row with id ${id}`);
  if (row.status !== "running") return false;

  const file = (name: string) => (runDir && existsSync(join(runDir, name)) ? readFileSync(join(runDir, name), "utf8") : "");
  const m = measure(file("transcript.jsonl"));
  const run: { checks_passed?: boolean; pr?: string; head_sha?: string } = JSON.parse(file("run.json") || "{}");
  const endedAt = new Date();
  const wallSeconds = Math.round((endedAt.getTime() - new Date(row.started_at as string).getTime()) / 1000);

  await db.query(
    `UPDATE runs SET status = ?, ended_at = ?, wall_seconds = ?, model = COALESCE(?, model), pr = ?, head_sha = ?,
       input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?, cost_usd = ?, checks_passed = ?
     WHERE id = ? AND status = 'running'`,
    [
      status,
      endedAt.toISOString(),
      wallSeconds,
      m.model,
      run.pr ? Number(run.pr.split("/").at(-1)) : null,
      run.head_sha ?? null,
      m.input_tokens,
      m.output_tokens,
      m.cache_read_tokens,
      m.cache_write_tokens,
      m.cost_usd,
      run.checks_passed ?? null,
      id,
    ],
  );
  return true;
}

/** Sets `rework` on the runs behind an issue's merged pull requests: true when the PR's head at merge is not
 *  the commit the factory handed off, the `head_sha` of the last run on that PR to end.
 *
 *  Args:
 *    db: the run log.
 *    repo: `owner/name`.
 *    issue: the issue number.
 *    lookup: reads a PR's merge state and head commit from GitHub.
 *  Returns: the PRs whose runs were updated, with the value set. */
export async function recordRework(
  db: RunLog,
  repo: string,
  issue: number,
  lookup: (pr: number) => { merged: boolean; head: string },
): Promise<{ pr: number; rework: boolean }[]> {
  const rows = await db.query(
    "SELECT pr, head_sha FROM runs WHERE repo = ? AND issue = ? AND pr IS NOT NULL AND rework IS NULL ORDER BY ended_at",
    [repo, issue],
  );
  const handedOff = new Map(rows.map((r) => [Number(r.pr), r.head_sha as string | null]));
  const updated: { pr: number; rework: boolean }[] = [];
  for (const [pr, headSha] of handedOff) {
    const { merged, head } = lookup(pr);
    if (!merged) continue;
    const rework = head !== headSha;
    await db.query("UPDATE runs SET rework = ? WHERE repo = ? AND pr = ?", [rework, repo, pr]);
    updated.push({ pr, rework });
  }
  return updated;
}

function githubPr(repo: string, pr: number): { merged: boolean; head: string } {
  const out = execFileSync("gh", ["pr", "view", String(pr), "--repo", repo, "--json", "mergedAt,headRefOid"], {
    encoding: "utf8",
  });
  const { mergedAt, headRefOid } = JSON.parse(out);
  return { merged: Boolean(mergedAt), head: headRefOid };
}

const USAGE = `usage:
  runlog.ts start <id> <factory> <role> <factory_sha> <model> <owner/repo> <issue>
  runlog.ts finish <id> <done|needs_human|failed> [run-dir]
  runlog.ts rework <owner/repo> <issue>`;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  const valid =
    (command === "start" && args.length === 7) ||
    (command === "finish" && (args.length === 2 || args.length === 3)) ||
    (command === "rework" && args.length === 2);
  if (!valid) {
    console.error(USAGE);
    process.exit(2);
  }
  const db = await openRunLog();
  try {
    if (command === "start") {
      const [id, factory, role, factory_sha, model, repo, issue] = args;
      await startRun(db, { id, factory, role, factory_sha, model, repo, issue: Number(issue) });
    } else if (command === "finish") {
      const [id, status, runDir] = args;
      if (await finishRun(db, id, status, runDir)) console.error(`run log: ${id} ended ${status}`);
    } else {
      const [repo, issue] = args;
      for (const { pr, rework } of await recordRework(db, repo, Number(issue), (pr) => githubPr(repo, pr))) {
        console.log(`#${pr}: rework ${rework}`);
      }
    }
  } finally {
    await db.close();
  }
}
