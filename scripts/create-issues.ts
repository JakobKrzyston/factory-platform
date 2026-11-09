/** Creates one GitHub issue per requirement in docs/roadmap.ts, skipping any whose title already exists.
 *  Needs `gh` signed in. Run: npx tsx scripts/create-issues.ts [owner/repo] */
import { execFileSync } from "node:child_process";

import { OUTCOMES } from "../docs/roadmap";

const repo = process.argv[2] ?? "JakobKrzyston/factory-platform";

function gh(args: string[], input?: string): string {
  return execFileSync("gh", args, { input, encoding: "utf8" });
}

const existing = new Set<string>(
  JSON.parse(gh(["api", `repos/${repo}/issues?state=all&per_page=100`, "--jq", "[.[].title]"])),
);

for (const o of OUTCOMES) {
  for (const r of o.requirements) {
    const title = `${r.key}: ${r.title}`;
    if (existing.has(title)) {
      console.log(`skip  ${title}`);
      continue;
    }
    const body = [
      `**Outcome:** ${o.key} — ${o.title}`,
      `**Type:** ${r.workType} · **Team:** ${r.team} · **Target:** ${r.target}`,
      "",
      r.description,
      "",
      "**Acceptance**",
      "",
      ...r.acceptance.map((a) => `- [ ] ${a}`),
      "",
      `PRs for this issue should say \`Implements ${r.key}\` so Throughline reconciles them.`,
    ].join("\n");
    gh(
      ["api", `repos/${repo}/issues`, "--input", "-", "--jq", ".number"],
      JSON.stringify({ title, body, labels: ["requirement", r.workType, o.key.toLowerCase()] }),
    );
    console.log(`made  ${title}`);
  }
}
