/** Reads the benchmark's cases, `benchmark/<issue>-<slug>/case.md` (TL-14): settings as `key: value` lines
 *  between `---` fences, then `## Issue` (a snapshot of the issue) and `## Expected outcome`. Exports ROLES,
 *  parseCase and readCases. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The roles a case can replay, in the order the queue chains them. */
export const ROLES = ["triage", "spec", "implement", "review"] as const;
export type Role = (typeof ROLES)[number];

/** What the replay harness reads from a case. The other settings (`pr`, `files`, `checks`) and the expected
 *  outcome are for the scorers (TL-16). */
export type Case = {
  id: string;
  issue: number;
  base_sha: string;
  role: Role;
  stages: Role[];
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
 *  Returns: the case. The issue's title is the snapshot's first line, without leading `#`s; its body is the rest.
 *  Raises: if the fences, a setting or the `## Issue` section is missing or invalid, or a review stage has no
 *  spec and implement stage before it: a replay hands work on only between its own stages, and the reviewer
 *  needs a spec and a change. */
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
  const review = stages.indexOf("review");
  if (review >= 0 && !(stages.slice(0, review).includes("spec") && stages.slice(0, review).includes("implement"))) {
    throw new Error(`${id}: a review stage needs spec and implement stages before it`);
  }

  // The section runs to the next level-2 heading, so the snapshot may use ### and deeper.
  const section = match[2].match(/^## Issue\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  const snapshot = section?.[1].trim();
  if (!snapshot) throw new Error(`${id}: missing ## Issue section`);
  const [first, ...rest] = snapshot.split("\n");
  return {
    id,
    issue,
    base_sha,
    role,
    stages: stages as Role[],
    title: first.replace(/^#+\s*/, ""),
    body: rest.join("\n").trim(),
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
