/** Applies the merge gate on `main`: creates or updates each ruleset in .github/rulesets by name,
 *  and stops Actions' GITHUB_TOKEN from approving pull requests. Needs `gh` signed in as a repo admin.
 *  Run: pnpm merge-gate [owner/repo] */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

const repo = process.argv[2] ?? "JakobKrzyston/factory-platform";
const dir = ".github/rulesets";

function gh(args: string[], input?: string): string {
  return execFileSync("gh", args, { input, encoding: "utf8" });
}

const existing: { id: number; name: string }[] = JSON.parse(gh(["api", `repos/${repo}/rulesets`]));

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const body = readFileSync(`${dir}/${file}`, "utf8");
  const { name } = JSON.parse(body);
  const match = existing.find((r) => r.name === name);
  const [method, path] = match ? ["PUT", `repos/${repo}/rulesets/${match.id}`] : ["POST", `repos/${repo}/rulesets`];
  gh(["api", "--method", method, path, "--input", "-", "--silent"], body);
  console.log(`${match ? "updated" : "created"}  ${name}`);
}

gh(
  ["api", "--method", "PUT", `repos/${repo}/actions/permissions/workflow`, "--input", "-", "--silent"],
  JSON.stringify({ default_workflow_permissions: "read", can_approve_pull_request_reviews: false }),
);
console.log("set      Actions token: read-only, cannot approve or open PRs");
