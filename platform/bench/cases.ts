/** Reads the benchmark's cases, `benchmark/<issue>-<slug>/case.md` (TL-14): settings as `key: value` lines
 *  between `---` fences, then `## Issue` (a snapshot of the issue) and `## Expected outcome`. Exports ROLES,
 *  parseCase and readCases. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The roles a case can replay, in the order the queue chains them. */
export const ROLES = ["triage", "spec", "implement", "review"] as const;
export type Role = (typeof ROLES)[number];

/** What the replay harness and the scorers read from a case. `pr` is the merged PR a review-only case reviews;
 *  `files` and `checks` are for the scorers (TL-16). The expected outcome is for a person reading the case. */
export type Case = {
  id: string;
  issue: number;
  pr: number | null;
  base_sha: string;
  role: Role;
  stages: Role[];
  /** The paths the change may touch. */
  files: string[];
  /** One shell line that proves the outcome, or empty. */
  checks: string;
  title: string;
  body: string;
};

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Parses one case.md.
 *
 *  Args:
 *    id: the case's directory name, such as `12-run-log-rows`.
 *    text: the file's contents.
 *  Returns: the case. The issue's title is the snapshot's first line, without leading `#`s; its body is the rest,
 *  unwrapped from the code fence a snapshot may put around it.
 *  Raises: if the fences, a setting or the `## Issue` section is missing or invalid, or a review stage has neither
 *  an implement stage before it nor a `pr` to review. */
export function parseCase(id: string, text: string): Case {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`${id}: case.md must start with settings between --- lines`);
  const settings = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const [, key, value] = line.match(/^(\w+):\s*(.*?)\s*$/) ?? [];
    if (!key) throw new Error(`${id}: not a "key: value" line: ${line}`);
    settings.set(key, value);
  }
  const required = (key: string) => {
    const value = settings.get(key);
    if (!value) throw new Error(`${id}: missing setting: ${key}`);
    return value;
  };

  const issue = Number(required("issue"));
  if (!Number.isInteger(issue) || issue <= 0) throw new Error(`${id}: issue must be an issue number`);
  const base_sha = required("base_sha");
  if (!/^[0-9a-f]{7,40}$/.test(base_sha)) throw new Error(`${id}: base_sha must be a commit hash`);
  const role = required("role");
  if (!isRole(role)) throw new Error(`${id}: role must be one of ${ROLES.join(", ")}`);
  const stages = required("stages").split(",").map((stage) => stage.trim());
  const unknown = stages.filter((stage) => !isRole(stage));
  if (unknown.length > 0) throw new Error(`${id}: unknown stages: ${unknown.join(", ")}`);
  const pr = settings.get("pr") ? Number(settings.get("pr")) : null;
  if (pr !== null && !(Number.isInteger(pr) && pr > 0)) throw new Error(`${id}: pr must be a pull request number`);
  const review = stages.indexOf("review");
  if (review >= 0 && !stages.slice(0, review).includes("implement") && pr === null) {
    throw new Error(`${id}: a review stage needs an implement stage before it or a pr to review`);
  }

  // The section ends at the expected outcome, not at the next heading, so the issue's own headings stay in it.
  const section = match[2].match(/^## Issue\n([\s\S]*?)(?=^## Expected outcome$|(?![\s\S]))/m);
  const snapshot = section?.[1].trim();
  if (!snapshot) throw new Error(`${id}: missing ## Issue section`);
  const [first, ...rest] = snapshot.split("\n");
  // TL-14 fences the body, with more backticks than the issue uses, so it reads as a quotation.
  const body = rest.join("\n").trim();
  const fenced = body.match(/^(`{3,})[^\n]*\n([\s\S]*?)\n\1$/);
  return {
    id,
    issue,
    pr,
    base_sha,
    role,
    stages: stages as Role[],
    files: (settings.get("files") ?? "").split(",").map((file) => file.trim()).filter(Boolean),
    checks: settings.get("checks") ?? "",
    title: first.replace(/^#+\s*/, ""),
    body: fenced ? fenced[2].trim() : body,
  };
}

/** Reads every case under a benchmark directory.
 *  Args: dir: the benchmark directory; subdirectories without a case.md are skipped.
 *  Returns: the cases, sorted by directory name.
 *  Raises: if a case.md does not parse. */
export function readCases(dir: string): Case[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "case.md")))
    .map((entry) => entry.name)
    .sort()
    .map((name) => parseCase(name, readFileSync(join(dir, name, "case.md"), "utf8")));
}
