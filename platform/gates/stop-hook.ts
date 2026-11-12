/** Claude Code Stop hook that refuses to let the agent finish while typecheck, lint or test fails, or while its final
 *  message, which becomes the pull request's description, lacks its Risk or Evidence (TL-8). Exports verdict, blocked
 *  and GateConfig. Run by scripts/run-issue.sh, from this repository's root: tsx platform/gates/stop-hook.ts <gate.json> */
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { type CheckResult, baseChecks, runChecks } from "./checks";
import { descriptionProblems } from "./pr-description";

/** gate.json, written by run-issue.sh before the agent starts. */
export type GateConfig = {
  checkout: string; // the agent's clone, where the checks run
  package_json: string; // the clone's package.json, copied before the agent started
  log: string; // gates.jsonl: one line per attempt to finish
  deny_read: string[]; // paths the checks may not read: the owner's home and the API key's directory
};

// An unfixable failure would otherwise block until the run's budget or time limit. After this many blocks the
// hook lets the agent stop, and run-issue.sh, which reads the last line of the log, opens no pull request.
export const MAX_BLOCKS = 5;
const OUTPUT_LINES = 60;

/** One line of gates.jsonl. `passed` is the checks alone, which run-issue.sh records as checks_passed. */
export type GateLine = { at: string; passed: boolean; checks: unknown[]; description_problems?: string[] };

/** Whether the hook refused the attempt a gates.jsonl line records. */
export function blocked(line: GateLine): boolean {
  return !line.passed || (line.description_problems?.length ?? 0) > 0;
}

/** Decides whether the agent may stop, and what to tell it.
 *  Args: results: this attempt's checks; blocksSoFar: how many earlier attempts in this run were blocked;
 *    problems: what the agent's final message lacks as a pull request description (descriptionProblems).
 *  Returns: block, true when the agent must keep working; message, for the agent when blocked. */
export function verdict(results: CheckResult[], blocksSoFar: number, problems: string[] = []): { block: boolean; message: string } {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0 && problems.length === 0) return { block: false, message: "" };
  if (blocksSoFar >= MAX_BLOCKS) return { block: false, message: `Gave up after ${MAX_BLOCKS} blocked attempts.` };
  const description = problems.length
    ? [
        `Pull request description: your final message becomes the pull request's description, and it is not complete. ${problems.join(" ")}`,
        "Make your final message the whole description again, every section of the template from its first heading, not a note about what you just fixed.",
      ]
    : [];
  if (failed.length === 0) return { block: true, message: description.join("\n\n") };

  const names = failed.map((r) => r.name);
  const passed = results.filter((r) => r.ok).map((r) => r.name);
  const sections = failed.map((r) => {
    const lines = r.output.trimEnd().split("\n");
    const tail = lines.slice(-OUTPUT_LINES).join("\n");
    const cut = lines.length > OUTPUT_LINES ? `, last ${OUTPUT_LINES} of ${lines.length} lines` : "";
    return `--- ${r.name} (exit ${r.exitCode ?? "none"}${cut}) ---\n${tail}`;
  });
  const message = [
    `Quality gate: ${names.join(" and ")} failed, so you cannot finish yet.${passed.length ? ` Passed: ${passed.join(", ")}.` : ""}`,
    "Each time you try to finish, the gate runs the typecheck, lint and test scripts from package.json as it was " +
      "when you started, in a sandbox. Fix the cause and try to finish again.",
    ...sections,
    ...description,
  ].join("\n\n");
  return { block: true, message };
}

// realpath: import.meta.url has symlinks resolved and argv[1] does not.
if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { checkout, package_json, log, deny_read }: GateConfig = JSON.parse(readFileSync(process.argv[2], "utf8"));
  // Claude Code passes the hook its input on stdin. A run that stops to ask a question opens no pull request
  // (run-issue.sh exits 3), so the checks have nothing to protect and would only keep the agent from asking.
  const input: { last_assistant_message?: string } = JSON.parse(readFileSync(0, "utf8") || "{}");
  const last = input.last_assistant_message ?? "";
  if (last.startsWith("QUESTION:")) process.exit(0);
  const results = runChecks(checkout, baseChecks(package_json), deny_read);
  // A missing message fails the description check, so the hook fails closed.
  const description_problems = descriptionProblems(last);
  const blocksSoFar = existsSync(log)
    ? readFileSync(log, "utf8").split("\n").filter((line) => line && blocked(JSON.parse(line))).length
    : 0;
  const passed = results.every((r) => r.ok);
  const checks = results.map(({ name, ok, exitCode, seconds }) => ({ name, ok, exit_code: exitCode, seconds }));
  const line: GateLine = { at: new Date().toISOString(), passed, checks, description_problems };
  appendFileSync(log, `${JSON.stringify(line)}\n`);

  const { block, message } = verdict(results, blocksSoFar, description_problems);
  // Exit code 2 is Claude Code's "block": the stop is refused and stderr is given to the agent.
  if (message) process.stderr.write(`${message}\n`);
  process.exit(block ? 2 : 0);
}
