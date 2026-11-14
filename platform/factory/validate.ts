/** Checks a factory directory before it merges (TL-20): what readFactory refuses, and that every agent and scorer
 *  parses, every scorer folder names a measure that exists, nothing in it is code, and no file holds a secret.
 *  Exports validateFactory and SECRETS; as a CLI it checks each directory given and exits 1 naming each problem.
 *
 *  pnpm validate-factory factories/<name> [factories/<other> ...] */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { parseAgent } from "../agents/agent";
import { parseScorer } from "../scorers/scorers";
import { readFactory } from "./factory";

/** What a secret looks like, by its shape or by the variable from `.env.example` it is assigned to. A name for
 *  each, so a problem says which kind it found without repeating the value. */
export const SECRETS: { name: string; pattern: RegExp }[] = [
  { name: "an Anthropic API key", pattern: /sk-ant-[\w-]{20,}/ },
  { name: "a GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}|\bgithub_pat_\w{22,}/ },
  { name: "a private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "a database URL with a password", pattern: /\b(postgres(ql)?|mysql):\/\/[^\s:@/]+:[^\s@/]+@/ },
  // The Vercel bypass secret and the MCP token have no fixed shape, so only an assignment gives them away.
  { name: "a secret assigned to its variable", pattern: /\b(ANTHROPIC_API_KEY|DATABASE_URL|THROUGHLINE_MCP_TOKEN|THROUGHLINE_BYPASS_SECRET)=\S/ },
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function folders(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Checks one factory directory.
 *
 *  Args:
 *    dir: the factory's directory, `factories/<name>/`.
 *  Returns: each problem found, one line each, naming the file; empty when the factory is valid. */
export function validateFactory(dir: string): string[] {
  if (!existsSync(join(dir, "factory.yaml"))) return [`${dir} has no factory.yaml`];
  const problems: string[] = [];

  // One foreman, every trigger names an existing agent, every chain ends with a human.
  try {
    readFactory(dir);
  } catch (error) {
    problems.push(message(error));
  }

  for (const agent of folders(join(dir, "agents"))) {
    const file = join("agents", agent, "agent.md");
    if (!existsSync(join(dir, file))) continue;
    try {
      const { contract } = parseAgent(readFileSync(join(dir, file), "utf8"));
      // run-issue.sh appends it to a pull-request agent's prompt; a missing one would leave that part empty.
      if (contract === "pull-request" && !existsSync(join(dir, "skills/pr-description/SKILL.md"))) {
        problems.push(`${file}: a pull-request agent needs skills/pr-description/SKILL.md, which its gate checks against`);
      }
    } catch (error) {
      problems.push(`${file}: ${message(error)}`);
    }
  }

  // readScorers skips a folder without a scorer.md, so pnpm bench would quietly grade without it.
  for (const scorer of folders(join(dir, "scorers"))) {
    const file = join(dir, "scorers", scorer, "scorer.md");
    if (!existsSync(file)) {
      problems.push(`scorers/${scorer}: has no scorer.md, so pnpm bench would skip it`);
      continue;
    }
    try {
      parseScorer(scorer, readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(message(error));
    }
  }

  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
  for (const file of files) {
    // Rule 5: the queue, the run log and the gates are the platform's, so a factory has no code to run.
    if (![".md", ".yaml"].includes(extname(file))) {
      problems.push(`${file}: is not Markdown or YAML; a factory holds definitions, not code (rule 5)`);
      continue;
    }
    readFileSync(join(dir, file), "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const secret of SECRETS) {
          if (secret.pattern.test(line)) problems.push(`${file}:${i + 1}: looks like ${secret.name}; secrets never enter the repo (rule 7)`);
        }
      });
  }

  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error("usage: pnpm validate-factory factories/<name> [factories/<other> ...]");
    process.exit(2);
  }
  let failed = false;
  for (const dir of dirs) {
    const problems = validateFactory(dir);
    if (problems.length === 0) {
      console.log(`${dir}: valid`);
      continue;
    }
    failed = true;
    console.error(`${dir}: not a valid factory`);
    for (const problem of problems) console.error(`  - ${problem}`);
  }
  process.exit(failed ? 1 : 0);
}
