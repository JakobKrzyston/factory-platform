/** The work queue: an issue's `factory:*` label is its state. Exports the states and the label
 *  arithmetic; run as a CLI it sets up a repository, claims an issue or moves it to a state.
 *
 *  pnpm queue setup <owner/repo>                         labels and the `factory` environment
 *  pnpm queue claim <owner/repo> <issue>                 prints true and moves ready -> in-progress, or prints false
 *  pnpm queue set <owner/repo> <issue> <state> [comment.md]
 *
 *  Needs `gh` signed in: as a repo admin for setup, as the factory App otherwise. */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const STATES = {
  ready: { color: "0E8A16", description: "Queued for the factory. Adding this label starts a run." },
  "in-progress": { color: "FBCA04", description: "A factory run is working on this issue." },
  "in-review": { color: "1D76DB", description: "The factory opened a pull request; a human reviews and merges it." },
  "needs-human": { color: "D93F0B", description: "The factory stopped with a question or a failure; see its comment." },
  done: { color: "5319E7", description: "The factory's pull request merged." },
} as const;

export type State = keyof typeof STATES;

/** The label name for a state, e.g. `factory:ready`. */
export function label(state: State): string {
  return `factory:${state}`;
}

/** Works out the label edit that leaves an issue in exactly one factory state.
 *
 *  Args:
 *    current: every label the issue carries now.
 *    to: the state to move it to.
 *  Returns: the label to add (none if it is already there) and the other factory labels to remove. */
export function labelChanges(current: string[], to: State): { add: string[]; remove: string[] } {
  const target = label(to);
  return {
    add: current.includes(target) ? [] : [target],
    remove: current.filter((name) => name.startsWith("factory:") && name !== target),
  };
}

/** Decides whether a run may take an issue. The workflow's concurrency group already lets only one
 *  run per issue past this point at a time, so this only has to reject runs that are no longer
 *  wanted: a queued duplicate, or a run for an issue closed or relabelled since it was queued.
 *
 *  Args:
 *    issue: the issue's current state and label names, read after the run started.
 *  Returns: null if the run may claim it, otherwise why not. */
export function claimRefusal(issue: { state: string; labels: string[] }): string | null {
  if (issue.state !== "open") return "the issue is closed";
  if (!issue.labels.includes(label("ready"))) return `the issue is not labelled ${label("ready")}`;
  return null;
}

function gh(args: string[], input?: string): string {
  return execFileSync("gh", args, { input, encoding: "utf8" });
}

function readIssue(repo: string, issue: string): { state: string; labels: string[] } {
  const data = JSON.parse(gh(["api", `repos/${repo}/issues/${issue}`]));
  return { state: data.state, labels: data.labels.map((l: { name: string }) => l.name) };
}

/** Moves an issue to a state, posting the comment first so it is in place when the label appears.
 *
 *  Args:
 *    repo: `owner/name`.
 *    issue: the issue number.
 *    to: the state to move it to.
 *    commentFile: a Markdown file to post as a comment, if any. */
export function setState(repo: string, issue: string, to: State, commentFile?: string): void {
  const path = `repos/${repo}/issues/${issue}`;
  if (commentFile) gh(["api", "--method", "POST", `${path}/comments`, "-F", `body=@${commentFile}`, "--silent"]);
  const { add, remove } = labelChanges(readIssue(repo, issue).labels, to);
  for (const name of add) gh(["api", "--method", "POST", `${path}/labels`, "-f", `labels[]=${name}`, "--silent"]);
  for (const name of remove) gh(["api", "--method", "DELETE", `${path}/labels/${encodeURIComponent(name)}`, "--silent"]);
}

/** Creates or updates the five state labels, and the `factory` environment that holds the
 *  workflow's secrets. The environment deploys from `main` only, so a workflow running a factory
 *  branch's code cannot read them (#33). */
function setup(repo: string): void {
  for (const [state, { color, description }] of Object.entries(STATES)) {
    gh(["label", "create", label(state as State), "--repo", repo, "--color", color, "--description", description, "--force"]);
    console.log(`label        ${label(state as State)}`);
  }
  const env = `repos/${repo}/environments/factory`;
  gh(
    ["api", "--method", "PUT", env, "--input", "-", "--silent"],
    JSON.stringify({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }),
  );
  const policies: { name: string }[] = JSON.parse(gh(["api", `${env}/deployment-branch-policies`])).branch_policies;
  if (!policies.some((p) => p.name === "main")) {
    gh(["api", "--method", "POST", `${env}/deployment-branch-policies`, "-f", "name=main", "-f", "type=branch", "--silent"]);
  }
  console.log("environment  factory (deploys from main only)");
  console.log("\nNow set its secrets: gh secret set ANTHROPIC_API_KEY --env factory; gh secret set FACTORY_APP_PRIVATE_KEY --env factory < key.pem; gh variable set FACTORY_APP_ID --env factory");
}

function main([command, repo, issue, state, commentFile]: string[]): void {
  if (command === "setup" && repo) {
    setup(repo);
    return;
  }
  if (command === "claim" && repo && issue) {
    const refusal = claimRefusal(readIssue(repo, issue));
    if (refusal) console.error(`not claimed: ${refusal}`);
    else setState(repo, issue, "in-progress");
    console.log(refusal === null);
    return;
  }
  if (command === "set" && repo && issue && state in STATES) {
    setState(repo, issue, state as State, commentFile);
    return;
  }
  console.error("usage: queue setup <owner/repo> | claim <owner/repo> <issue> | set <owner/repo> <issue> <state> [comment.md]");
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
