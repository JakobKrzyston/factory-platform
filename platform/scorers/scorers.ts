/** Grades benchmark results (TL-16). A factory's scorers are files, `factories/<name>/scorers/<scorer>/scorer.md`,
 *  each naming one of the measures below; this module runs them and stores each score, a number and a one-line
 *  reason, in the run log's `scores` table. Exports MEASURES, parseScorer, readScorers, scoreResult, saveScores
 *  and formatScore. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { Case, Role } from "../bench/cases";
import { parseSettings } from "../factory/factory";
import { type CheckResult, runChecks } from "../gates/checks";
import type { RunLog } from "../runlog/runlog";

/** One stage of one case, as its run ended: what a scorer grades. */
export type Subject = {
  case: Case;
  role: Role;
  /** The row's status: `done`, `needs_human` or `failed`. */
  outcome: string;
  cost_usd: number | null;
  wall_seconds: number | null;
  review_findings: number | null;
  /** The changes.patch an implement run handed off, or null when it handed off none. */
  patch: string | null;
  /** A git repository that holds the case's base_sha. */
  source: string;
};

/** A measure's verdict: a number and a reason on one line. */
export type Grade = { score: number; reason: string };
export type Score = Grade & { scorer: string };
/** A scorer: its folder name and the measure its scorer.md names. */
export type Scorer = { name: string; measure: string };

type Measure = (subject: Subject) => Grade | null;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The paths a patch touches, from its `diff --git` lines: both sides, so a rename counts its old path too. */
function changedFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const [, a, b] of readFileSync(patch, "utf8").matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)) {
    files.add(a);
    files.add(b);
  }
  return [...files].sort();
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A shell function standing in for pnpm inside the sandbox. Case checks say `pnpm <script>` and `pnpm exec <bin>`,
 *  but pnpm is installed under the home directory the sandbox denies, and `pnpm <script>` would run the script from
 *  the patched package.json, which the agent could have rewritten. So a script runs as the base's package.json
 *  defines it, as the gate's checks do, and `exec` runs a binary from node_modules/.bin, which runChecks puts first
 *  on PATH. */
function pnpmFunction(scripts: Record<string, string>): string {
  const arms = Object.entries(scripts).map(([name, script]) => `${quote(name)}) shift; ${script} "$@" ;;`);
  return [
    "pnpm() {",
    'case "$1" in',
    'exec) shift; "$@" ;;',
    ...arms,
    `*) echo "pnpm $1: not a script in the base's package.json" >&2; return 127 ;;`,
    "esac",
    "}",
    "",
  ].join("\n");
}

/** Runs a case's checks on its base with a patch applied, in the gate's sandbox, in a fresh clone outside the home
 *  directory. Dependencies are the base's, installed before the patch is applied and without lifecycle scripts or
 *  this process's environment, as run-issue.sh installs them for the gate: pnpm runs a .pnpmfile.cjs it finds even
 *  with --ignore-scripts, outside any sandbox. */
function runCaseChecks(source: string, baseSha: string, patch: string, checks: string): CheckResult {
  const dir = mkdtempSync(join(tmpdir(), "scorer-checks-"));
  // Only PATH and HOME: the bench's environment holds the API key and DATABASE_URL, and the checks run agent code.
  const env = { PATH: process.env.PATH ?? "", HOME: homedir() };
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "ignore", "inherit"] });
  try {
    git("init", "--quiet");
    git("fetch", "--quiet", source, baseSha);
    git("switch", "--quiet", "--detach", "FETCH_HEAD");
    const pkg = join(dir, "package.json");
    const scripts: Record<string, string> = existsSync(pkg) ? (JSON.parse(readFileSync(pkg, "utf8")).scripts ?? {}) : {};
    if (existsSync(join(dir, "pnpm-lock.yaml"))) {
      execFileSync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts", "--silent"], { cwd: dir, env, stdio: "inherit" });
    }
    git("apply", patch);
    const [result] = runChecks(dir, [{ name: "case checks", script: pnpmFunction(scripts) + checks }], [homedir()], env);
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The last non-empty line of a check's output, cut to a length that fits a dashboard cell. */
function lastLine(output: string): string {
  const line = output.trim().split("\n").at(-1)?.trim() ?? "";
  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

/** What each scorer.md's `measure` can name. A measure returns null for a result it does not apply to, such as
 *  `scope` for a triage run, which changes no files. */
export const MEASURES: Record<string, Measure> = {
  // 1 if the case's checks pass on the patch implement handed off, else 0. A run that handed off nothing scores 0:
  // the factory delivered nothing that passes.
  tests: (s) => {
    if (s.role !== "implement" || !s.case.checks) return null;
    if (!s.patch) return { score: 0, reason: `implement ended ${s.outcome} and handed off no patch` };
    const result = runCaseChecks(s.source, s.case.base_sha, s.patch, s.case.checks);
    return result.ok
      ? { score: 1, reason: `the case's checks passed on the patch in ${result.seconds}s` }
      : { score: 0, reason: `the case's checks failed (exit ${result.exitCode}): ${lastLine(result.output) || "no output"}` };
  },
  // The share of the patch's files that are among the case's `files`.
  scope: (s) => {
    if (s.role !== "implement" || !s.patch) return null;
    const changed = changedFiles(s.patch);
    if (changed.length === 0) return null;
    const outside = changed.filter((file) => !s.case.files.includes(file));
    const inside = changed.length - outside.length;
    return {
      score: inside / changed.length,
      reason: outside.length
        ? `${inside} of ${plural(changed.length, "changed file")} among the case's files; outside: ${outside.join(", ")}`
        : `${plural(changed.length, "changed file")}, all among the case's files`,
    };
  },
  // The findings a review raised. A run with review_findings is a review, as on the dashboard.
  findings: (s) =>
    s.review_findings === null ? null : { score: s.review_findings, reason: `the review raised ${plural(s.review_findings, "finding")}` },
  // The run's cost in US dollars. A run killed before Claude Code reported a cost has none to score.
  cost: (s) =>
    s.cost_usd === null
      ? null
      : { score: s.cost_usd, reason: `$${s.cost_usd.toFixed(3)} for ${s.role}${s.wall_seconds === null ? "" : ` in ${s.wall_seconds}s`}` },
};

/** Parses one scorer.md: settings as `key: value` lines between `---` fences, then what its number means.
 *
 *  Args:
 *    name: the scorer's folder name, which is its name in the run log.
 *    text: the file's contents.
 *  Returns: the scorer.
 *  Raises: if the fences are missing, a setting is unknown, the measure is not one of MEASURES, or the text after
 *  the settings, which says what the number means, is empty. */
export function parseScorer(name: string, text: string): Scorer {
  const file = `scorers/${name}/scorer.md`;
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: must start with settings between --- lines`);
  const settings = parseSettings(match[1], file);
  const unknown = [...settings.keys()].filter((key) => key !== "measure");
  if (unknown.length > 0) throw new Error(`${file}: unknown fields: ${unknown.join(", ")}`);
  const measure = settings.get("measure");
  if (typeof measure !== "string" || !Object.hasOwn(MEASURES, measure)) {
    throw new Error(`${file}: measure must be one of ${Object.keys(MEASURES).join(", ")}`);
  }
  if (!match[2].trim()) throw new Error(`${file}: says nothing after its settings about what the number means`);
  return { name, measure };
}

/** Reads every scorer under a factory's `scorers/` directory.
 *  Args: dir: `factories/<name>/scorers`; folders without a scorer.md are skipped.
 *  Returns: the scorers, sorted by name; none when the directory does not exist.
 *  Raises: if a scorer.md does not parse. */
export function readScorers(dir: string): Scorer[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "scorer.md")))
    .map((entry) => entry.name)
    .sort()
    .map((name) => parseScorer(name, readFileSync(join(dir, name, "scorer.md"), "utf8")));
}

/** Runs every scorer on one result.
 *  Args: scorers: from readScorers; subject: the result.
 *  Returns: a score from each scorer whose measure applies to the result. */
export function scoreResult(scorers: Scorer[], subject: Subject): Score[] {
  return scorers.flatMap((scorer) => {
    const grade = MEASURES[scorer.measure](subject);
    return grade ? [{ scorer: scorer.name, ...grade }] : [];
  });
}

/** Stores a run's scores in the run log.
 *  Args: db: the run log; runId: the row the scores grade; scores: from scoreResult. */
export async function saveScores(db: RunLog, runId: string, scores: Score[]): Promise<void> {
  for (const s of scores) {
    await db.query("INSERT INTO scores (run_id, scorer, score, reason) VALUES (?, ?, ?, ?)", [runId, s.scorer, s.score, s.reason]);
  }
}

/** Formats a score for a table: at most three decimals, no trailing zeros.
 *  Args: score: the number.
 *  Returns: such as `1`, `0.5` or `0.071`. */
export function formatScore(score: number): string {
  return String(Number(score.toFixed(3)));
}
