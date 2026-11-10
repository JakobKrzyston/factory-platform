/** Renders docs/PLAN.md from docs/roadmap.ts so the plan, the Throughline import and the tickets never drift.
 *  Run: npx tsx scripts/render-plan.ts */
import { writeFileSync } from "node:fs";

import { OUTCOMES } from "../docs/roadmap";

const lines: string[] = [
  "# Build plan",
  "",
  "<!-- Generated from docs/roadmap.ts by scripts/render-plan.ts. Edit the .ts file, not this one. -->",
  "",
  "Each outcome is what a reader of the product roadmap sees; each requirement (`TL-n`) is one ticket and, usually, one pull request. A requirement is done when its acceptance list passes and the PR that says `Implements TL-n` has merged.",
  "",
  "Read `docs/ARCHITECTURE.md` before starting any requirement.",
  "",
  "**Workflow for every requirement**",
  "",
  "1. Branch from `main` as `tl/N-short-name` (`wt new N-short-name` creates it).",
  "2. Build only what the requirement describes. Anything else becomes a new ticket.",
  "3. Write the note the acceptance list asks for, if it asks for one, under `docs/notes/`.",
  "4. Open a PR titled `TL-N: <title>` with what was built, how to try it, the risk and blast radius, and `Implements TL-N`.",
  "5. Record what the run cost once the run log exists (TL-11).",
  "",
  "---",
  "",
];

for (const o of OUTCOMES) {
  lines.push(`## ${o.key}: ${o.title}`, "", `Target: ${o.target}`, "", o.description, "");
  for (const r of o.requirements) {
    lines.push(
      `### ${r.key}: ${r.title}`,
      "",
      `${r.workType} · ${r.team} · ${r.target}${r.status ? ` · ${r.status}` : ""}`,
      "",
      r.description,
      "",
      "**Acceptance**",
      "",
      ...r.acceptance.map((a) => `- ${a}`),
      "",
    );
  }
  lines.push("---", "");
}

writeFileSync("docs/PLAN.md", lines.join("\n"));
console.log(`docs/PLAN.md: ${OUTCOMES.length} outcomes, ${OUTCOMES.reduce((n, o) => n + o.requirements.length, 0)} requirements`);
