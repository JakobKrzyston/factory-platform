/** Claude Code Stop hook that refuses to let the agent finish while typecheck, lint or test fails. Exports verdict.
 *  Run by scripts/run-issue.sh: tsx platform/gates/stop-hook.ts <checkout> <gates.jsonl> */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { type CheckResult, committedChecks, runChecks } from "./checks";

// An unfixable failure would otherwise block until the run's budget or time limit. After this many blocks the
// hook lets the agent stop, and run-issue.sh, which reads the last line of the log, opens no pull request.
export const MAX_BLOCKS = 5;
const OUTPUT_LINES = 60;

/** Decides whether the agent may stop, and what to tell it.
 *  Args: results: this attempt's checks; blocksSoFar: how many earlier attempts in this run were blocked.
 *  Returns: block, true when the agent must keep working; message, for the agent when blocked. */
export function verdict(results: CheckResult[], blocksSoFar: number): { block: boolean; message: string } {
  const failed = results.filter((r) => !r.ok);
  if (failed.length === 0) return { block: false, message: "" };
  if (blocksSoFar >= MAX_BLOCKS) return { block: false, message: `Gave up after ${MAX_BLOCKS} blocked attempts.` };

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
    "Each time you try to finish, the gate runs the typecheck, lint and test scripts from the committed package.json, " +
      "in a sandbox. Fix the cause and try to finish again. Editing package.json does not change what the gate runs.",
    ...sections,
  ].join("\n\n");
  return { block: true, message };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, log] = process.argv.slice(2);
  const results = runChecks(dir, committedChecks(dir));
  const blocksSoFar = existsSync(log)
    ? readFileSync(log, "utf8").split("\n").filter((line) => line && !JSON.parse(line).passed).length
    : 0;
  const passed = results.every((r) => r.ok);
  const checks = results.map(({ name, ok, exitCode, seconds }) => ({ name, ok, exit_code: exitCode, seconds }));
  appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), passed, checks })}\n`);

  const { block, message } = verdict(results, blocksSoFar);
  // Exit code 2 is Claude Code's "block": the stop is refused and stderr is given to the agent.
  if (message) process.stderr.write(`${message}\n`);
  process.exit(block ? 2 : 0);
}
