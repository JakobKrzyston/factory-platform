/** Checks that a pull request description has the Risk and Evidence sections of .github/pull_request_template.md
 *  filled in (TL-8). Exports descriptionProblems. Run by scripts/run-issue.sh, from this repository's root:
 *  tsx platform/gates/pr-description.ts < body.md   prints one problem per line, nothing when the body passes */
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Returns the text under each `## ` heading, keyed by the lower-cased heading. HTML comments and the template's
 *  closing `Implements TL-n` line are left out, so neither the template's hints nor its trailer counts as an answer. */
function sections(body: string): Map<string, string> {
  const found = new Map<string, string>();
  let current: string | null = null;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    if (/^Implements TL-\d*\s*$/.test(line)) continue;
    const heading = line.match(/^##\s+(.*?)\s*#*\s*$/);
    if (heading) {
      current = heading[1].toLowerCase();
      found.set(current, "");
    } else if (/^#\s/.test(line)) {
      current = null;
    } else if (current !== null) {
      found.set(current, `${found.get(current)}${line}\n`);
    }
  }
  return found;
}

/** Lists what a factory pull request's description lacks before a human should review it: a Risk section that
 *  names the door and the blast radius, and an Evidence section with something in it.
 *
 *  Args:
 *    body: the agent's part of the description, as Markdown. Not the whole PR body: run-issue.sh's footer would
 *      count as text under the last section.
 *  Returns: one sentence per problem; empty when the description passes. */
export function descriptionProblems(body: string): string[] {
  const found = sections(body);
  const section = (name: string) => [...found].find(([heading]) => heading.startsWith(name))?.[1].trim();
  const problems: string[] = [];

  const risk = section("risk");
  if (risk === undefined) problems.push("There is no Risk section.");
  else if (!risk) problems.push("The Risk section is empty.");
  else {
    if (!/\b(one|two)[- ]way\b/i.test(risk)) problems.push("The Risk section does not say one-way or two-way door.");
    if (!/blast radius/i.test(risk)) problems.push("The Risk section does not state the blast radius.");
  }

  const evidence = section("evidence");
  if (evidence === undefined) problems.push("There is no Evidence section.");
  else if (!evidence) problems.push("The Evidence section is empty.");

  return problems;
}

// realpath: import.meta.url has symlinks resolved and argv[1] does not.
if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  for (const problem of descriptionProblems(readFileSync(0, "utf8"))) console.log(problem);
}
