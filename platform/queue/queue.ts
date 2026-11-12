/** The work queue: an issue's `factory:*` label is its state. Exports the states and the label
 *  arithmetic; run as a CLI it sets up a repository, claims an issue or moves it to a state.
 *
 *  pnpm queue setup <owner/repo>                         labels and the `factory` environment
 *  pnpm queue claim <owner/repo> <issue> <state>         prints true and moves <state> -> in-progress, or prints false
 *  pnpm queue stage <state>                              prints the role a state queues and the state after it
 *  pnpm queue set <owner/repo> <issue> <state> [comment.md]
 *  pnpm queue done <owner/repo> <issue>                  moves a closed issue to done if the factory's PR merged
 *
 *  Needs `gh` signed in: as a repo admin for setup, as the factory App otherwise. */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const STATES = {
  ready: { color: "0E8A16", description: "Queued for the factory. Adding this label starts the triage agent." },
  spec: { color: "C2E0C6", description: "Triaged. Adding this label starts the spec agent." },
  implement: { color: "BFD4F2", description: "Specified. Adding this label starts the implement agent." },
  review: { color: "D4C5F9", description: "A pull request is open. Adding this label starts the review agent." },
  "in-progress": { color: "FBCA04", description: "A factory agent is working on this issue." },
  "in-review": { color: "1D76DB", description: "The review agent has commented on the factory's pull request; a human reviews and merges it." },
  "needs-human": { color: "D93F0B", description: "The factory stopped with a question, a failure or an incomplete PR; see its comment." },
  done: { color: "5319E7", description: "The factory's pull request merged." },
} as const;

export type State = keyof typeof STATES;

/** The chain of agents (TL-7). Each state here queues one role, the folder name under the factory's `agents/`;
 *  when that role succeeds the issue moves to `next`, whose label starts the next role. */
export const STAGES = {
  ready: { role: "triage", next: "spec" },
  spec: { role: "spec", next: "implement" },
  implement: { role: "implement", next: "review" },
  review: { role: "review", next: "in-review" },
} as const satisfies Partial<Record<State, { role: string; next: State }>>;

export type Stage = keyof typeof STAGES;

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
 *    from: the stage whose label started the run.
 *  Returns: null if the run may claim it, otherwise why not. */
export function claimRefusal(issue: { state: string; labels: string[] }, from: Stage): string | null {
  if (issue.state !== "open") return "the issue is closed";
  if (!issue.labels.includes(label(from))) return `the issue is not labelled ${label(from)}`;
  return null;
}

/** Runs the GitHub CLI and returns its stdout.
 *  Args: args: the arguments after `gh`; input: text for its stdin, if any.
 *  Returns: what it printed.
 *  Raises: if `gh` exits non-zero. */
export function gh(args: string[], input?: string): string {
  return execFileSync("gh", args, { input, encoding: "utf8" });
}

/** Decides whether an issue may move to a state. A closed issue moves only to `done`, so a run that ends after
 *  a human closed the issue cannot put a stage or `needs-human` label back on it.
 *
 *  Args:
 *    issue: the issue's current state, read just before the move.
 *    to: the state to move it to.
 *  Returns: null if it may move, otherwise why not. */
export function moveRefusal(issue: { state: string }, to: State): string | null {
  return issue.state !== "open" && to !== "done" ? "the issue is closed" : null;
}

/** Finds the factory's merged pull request for an issue: one from a branch of this repository named
 *  `factory/issue-<n>-...`, the name run-issue.sh gives it.
 *
 *  Args:
 *    prs: the repository's merged pull requests.
 *    issue: the issue number.
 *  Returns: the pull request's URL, or null if none of them is the factory's for this issue. */
export function mergedFactoryPr(
  prs: { url: string; headRefName: string; isCrossRepository: boolean }[],
  issue: string,
): string | null {
  const pr = prs.find((pr) => !pr.isCrossRepository && pr.headRefName.startsWith(`factory/issue-${issue}-`));
  return pr ? pr.url : null;
}

function readIssue(repo: string, issue: string): { state: string; labels: string[] } {
  const data = JSON.parse(gh(["api", `repos/${repo}/issues/${issue}`]));
  return { state: data.state, labels: data.labels.map((l: { name: string }) => l.name) };
}

/** Moves an issue to a state, posting the comment first so it is in place when the label appears. The comment
 *  is posted even when moveRefusal keeps a closed issue where it is: it still records what the run did.
 *
 *  Args:
 *    repo: `owner/name`.
 *    issue: the issue number.
 *    to: the state to move it to.
 *    commentFile: a Markdown file to post as a comment, if any. */
export function setState(repo: string, issue: string, to: State, commentFile?: string): void {
  const path = `repos/${repo}/issues/${issue}`;
  if (commentFile) gh(["api", "--method", "POST", `${path}/comments`, "-F", `body=@${commentFile}`, "--silent"]);
  const current = readIssue(repo, issue);
  const refusal = moveRefusal(current, to);
  if (refusal) {
    console.error(`not moved to ${label(to)}: ${refusal}`);
    return;
  }
  const { add, remove } = labelChanges(current.labels, to);
  for (const name of add) gh(["api", "--method", "POST", `${path}/labels`, "-f", `labels[]=${name}`, "--silent"]);
  for (const name of remove) gh(["api", "--method", "DELETE", `${path}/labels/${encodeURIComponent(name)}`, "--silent"]);
}

/** Creates or updates the state labels, and the `factory` environment that holds the
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
  // As key=value lines, for $GITHUB_OUTPUT.
  if (command === "stage" && Object.hasOwn(STAGES, repo)) {
    const { role, next } = STAGES[repo as Stage];
    console.log(`role=${role}\nnext=${next}`);
    return;
  }
  if (command === "claim" && repo && issue && Object.hasOwn(STAGES, state)) {
    const refusal = claimRefusal(readIssue(repo, issue), state as Stage);
    if (refusal) console.error(`not claimed: ${refusal}`);
    else setState(repo, issue, "in-progress");
    console.log(refusal === null);
    return;
  }
  if (command === "set" && repo && issue && state in STATES) {
    setState(repo, issue, state as State, commentFile);
    return;
  }
  // `done` means the factory's PR merged, not only that the issue closed: a human may close an issue that a
  // question parked, or close it mid-run, with no factory PR merged.
  if (command === "done" && repo && issue) {
    const prs = JSON.parse(
      gh(["pr", "list", "--repo", repo, "--state", "merged", "--limit", "100", "--json", "url,headRefName,isCrossRepository"]),
    );
    const pr = mergedFactoryPr(prs, issue);
    if (pr) setState(repo, issue, "done");
    else console.error(`not done: no merged factory pull request for #${issue}`);
    return;
  }
  console.error(
    "usage: queue setup <owner/repo> | stage <state> | claim <owner/repo> <issue> <state> | set <owner/repo> <issue> <state> [comment.md] | done <owner/repo> <issue>",
  );
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
