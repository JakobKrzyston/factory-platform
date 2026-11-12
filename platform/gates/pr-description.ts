/** Checks that a pull request description has the Risk and Evidence sections of .github/pull_request_template.md
 *  filled in (TL-8). Exports descriptionProblems, which the stop hook (stop-hook.ts) runs on the agent's final message. */

// Hyphen, non-breaking hyphen, en and em dashes and the like, or a space: "two-way", "two‑way", "two way".
const JOIN = "[\\s\\-\\u2010-\\u2015]*";
const DOOR = new RegExp(`\\b(one|two)${JOIN}way${JOIN}doors?\\b`, "i");
const BLAST_RADIUS = new RegExp(`\\bblast${JOIN}radius\\b`, "i");
// The template's trailer, in any of the ways an agent writes it: "**Implements TL-8**", "Implements TL-8, TL-9."
const TRAILER = /^[\s*_]*Implements\s+TL-\d*(\s*(,|and|&)?\s*TL-\d+)*[\s*_.]*$/i;

/** Returns the text under each `## ` heading, keyed by the lower-cased heading. HTML comments and the template's
 *  closing `Implements TL-n` line are left out, so neither the template's hints nor its trailer counts as an answer.
 *  Lines inside code fences are text, never headings, and a repeated heading adds to its section. */
function sections(body: string): Map<string, string> {
  const found = new Map<string, string>();
  let current: string | null = null;
  let fence: string | null = null;
  for (const line of body.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (fence === null && marker) fence = marker;
    else if (fence !== null && marker?.startsWith(fence)) fence = null;
    else if (fence === null && TRAILER.test(line)) continue;
    else if (fence === null && /^##\s/.test(line)) {
      current = line.replace(/^##\s+/, "").replace(/\s*#*\s*$/, "").toLowerCase();
      if (!found.has(current)) found.set(current, "");
      continue;
    } else if (fence === null && /^#\s/.test(line)) {
      current = null;
      continue;
    }
    if (current !== null) found.set(current, `${found.get(current)}${line}\n`);
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
    if (!DOOR.test(risk)) problems.push("The Risk section does not say one-way door or two-way door.");
    if (!BLAST_RADIUS.test(risk)) problems.push("The Risk section does not state the blast radius.");
  }

  const evidence = section("evidence");
  if (evidence === undefined) problems.push("There is no Evidence section.");
  else if (!evidence) problems.push("The Evidence section is empty.");

  return problems;
}
