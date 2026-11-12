/** The work queue: an issue's `factory:*` label is its state. Exports the platform's states and the label
 *  arithmetic; run as a CLI it sets up a repository, routes a label to its factory's trigger, claims an issue,
 *  reports a run or moves an issue to a state. Which labels start which agents is the factory's, read from its
 *  triggers (platform/factory/).
 *
 *  pnpm queue setup <owner/repo>                         labels and the `factory` environment
 *  pnpm queue route <owner/repo> <label>                 prints the factory, trigger and agent a label starts, or nothing
 *  pnpm queue claim <owner/repo> <issue> <label>         prints true and moves <label> -> in-progress, or prints false
 *  pnpm queue report <owner/repo> <issue> <factory> <trigger> <exit-code> <output-file> <run-url>
 *  pnpm queue set <owner/repo> <issue> <label> [comment.md]
 *  pnpm queue done <owner/repo> <issue>                  moves a closed issue to done if the factory's PR merged
 *
 *  Needs `gh` signed in: as a repo admin for setup, as the factory App otherwise. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { END, type Factory, readFactories, route, type Trigger } from "../factory/factory";

/** The states every factory shares. The labels that start agents are each factory's triggers. */
export const STATES = {
  "factory:in-progress": { color: "FBCA04", description: "A factory agent is working on this issue." },
  [END]: { color: "1D76DB", description: "The factory's last agent has handed its pull request to a human, who reviews and merges it." },
  "factory:needs-human": { color: "D93F0B", description: "The factory stopped with a question, a failure or an incomplete PR; see its comment." },
  "factory:done": { color: "5319E7", description: "The factory's pull request merged." },
} as const;

/** Works out the label edit that leaves an issue in exactly one factory state.
 *
 *  Args:
 *    current: every label the issue carries now.
 *    to: the state's label, e.g. `factory:in-progress`.
 *  Returns: the label to add (none if it is already there) and the other factory labels to remove. */
export function labelChanges(current: string[], to: string): { add: string[]; remove: string[] } {
  return {
    add: current.includes(to) ? [] : [to],
    remove: current.filter((name) => name.startsWith("factory:") && name !== to),
  };
}

/** Decides whether a run may take an issue. The workflow's concurrency group already lets only one
 *  run per issue past this point at a time, so this only has to reject runs that are no longer
 *  wanted: a queued duplicate, or a run for an issue closed or relabelled since it was queued.
 *
 *  Args:
 *    issue: the issue's current state and label names, read after the run started.
 *    from: the label that started the run.
 *  Returns: null if the run may claim it, otherwise why not. */
export function claimRefusal(issue: { state: string; labels: string[] }, from: string): string | null {
  if (issue.state !== "open") return "the issue is closed";
  if (!issue.labels.includes(from)) return `the issue is not labelled ${from}`;
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
 *    to: the state's label.
 *  Returns: null if it may move, otherwise why not. */
export function moveRefusal(issue: { state: string }, to: string): string | null {
  return issue.state !== "open" && to !== "factory:done" ? "the issue is closed" : null;
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
 *    to: the state's label.
 *    commentFile: a Markdown file to post as a comment, if any. */
export function setState(repo: string, issue: string, to: string, commentFile?: string): void {
  const path = `repos/${repo}/issues/${issue}`;
  if (commentFile) gh(["api", "--method", "POST", `${path}/comments`, "-F", `body=@${commentFile}`, "--silent"]);
  const current = readIssue(repo, issue);
  const refusal = moveRefusal(current, to);
  if (refusal) {
    console.error(`not moved to ${to}: ${refusal}`);
    return;
  }
  const { add, remove } = labelChanges(current.labels, to);
  for (const name of add) gh(["api", "--method", "POST", `${path}/labels`, "-f", `labels[]=${name}`, "--silent"]);
  for (const name of remove) gh(["api", "--method", "DELETE", `${path}/labels/${encodeURIComponent(name)}`, "--silent"]);
}

/** Words what a run did, and picks the state it leaves the issue in.
 *
 *  Args:
 *    factory: the factory the run belongs to.
 *    trigger: the trigger that started it.
 *    code: run-issue.sh's exit status: 0 done, 3 a question, 4 a PR whose description is incomplete, else failed.
 *    output: what run-issue.sh printed.
 *    runUrl: the Actions run, for the comment's link.
 *  Returns: the label to move the issue to and the comment to post first. */
export function report(
  factory: Factory,
  trigger: Trigger,
  code: number,
  output: string,
  runUrl: string,
): { to: string; comment: string } {
  const lines = output.replace(/\n$/, "").split("\n");
  if (code === 0) {
    const values: Record<string, string> = { output: output.trimEnd(), run_url: runUrl };
    return { to: trigger.next, comment: trigger.comment.replace(/\{(output|run_url)\}/g, (_, key: string) => values[key]) };
  }
  if (code === 3) {
    const comment = [
      `The factory's ${trigger.agent} agent stopped to ask a question:`,
      "",
      ...lines.map((line) => `> ${line}`),
      "",
      `Answer in a comment here, then add \`${trigger.label}\` again. [Run log](${runUrl})`,
      ...(trigger.question ? ["", trigger.question.trimEnd()] : []),
    ];
    return { to: "factory:needs-human", comment: `${comment.join("\n")}\n` };
  }
  if (code === 4) {
    // TL-8: a pull request that does not state its risk and evidence is not ready for review, so it stops here
    // instead of starting the next agent.
    const next = factory.triggers.find((t) => t.label === trigger.next);
    const comment = [
      `The ${trigger.agent} agent opened ${lines[0]}, but its description is not ready for review:`,
      "",
      ...lines.slice(1).map((line) => `- ${line}`),
      "",
      `Fill in the missing sections on the pull request, then add \`${trigger.next}\`${next ? ` to start the ${next.agent} agent` : ""}, or merge it. Or close the pull request and add \`${trigger.label}\` to run again. [Run log](${runUrl})`,
    ];
    return { to: "factory:needs-human", comment: `${comment.join("\n")}\n` };
  }
  return {
    to: "factory:needs-human",
    comment: `The factory's ${trigger.agent} agent failed (exit ${code}). See the [run log](${runUrl}), then add \`${trigger.label}\` to try this step again.\n`,
  };
}

/** Every label that starts an agent in any factory. */
function triggerLabels(): string[] {
  return readFactories().flatMap((factory) => factory.triggers.map((trigger) => trigger.label));
}

/** Creates or updates the state labels, the trigger labels of every factory serving the repository, and the
 *  `factory` environment that holds the workflow's secrets. The environment deploys from `main` only, so a
 *  workflow running a factory branch's code cannot read them (#33). */
function setup(repo: string): void {
  const triggers = readFactories()
    .filter((factory) => factory.repositories.includes(repo))
    .flatMap((factory) => factory.triggers);
  const labels = [
    ...triggers.map(({ label, color, description }) => ({ label, color, description })),
    ...Object.entries(STATES).map(([label, { color, description }]) => ({ label, color, description })),
  ];
  for (const { label, color, description } of labels) {
    gh(["label", "create", label, "--repo", repo, "--color", color, "--description", description, "--force"]);
    console.log(`label        ${label}`);
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

function main(args: string[]): void {
  const [command, repo, issue] = args;
  if (command === "setup" && repo) {
    setup(repo);
    return;
  }
  // As key=value lines, for $GITHUB_OUTPUT; nothing when the label starts no agent here.
  if (command === "route" && repo && args[2]) {
    const found = route(readFactories(), repo, args[2]);
    if (found) console.log(`factory=${found.factory.name}\ntrigger=${found.trigger.name}\nagent=${found.trigger.agent}`);
    return;
  }
  const [, , , state, commentFile] = args;
  if (command === "claim" && repo && issue && triggerLabels().includes(state)) {
    const refusal = claimRefusal(readIssue(repo, issue), state);
    if (refusal) console.error(`not claimed: ${refusal}`);
    else setState(repo, issue, "factory:in-progress");
    console.log(refusal === null);
    return;
  }
  const [, , , factoryName, triggerName, code, outputFile, runUrl] = args;
  if (command === "report" && repo && issue && /^\d+$/.test(code ?? "") && outputFile && runUrl) {
    const factory = readFactories().find((f) => f.name === factoryName);
    const trigger = factory?.triggers.find((t) => t.name === triggerName);
    if (factory && trigger) {
      const { to, comment } = report(factory, trigger, Number(code), readFileSync(outputFile, "utf8"), runUrl);
      const dir = mkdtempSync(join(tmpdir(), "factory-report-"));
      try {
        writeFileSync(join(dir, "comment.md"), comment);
        setState(repo, issue, to, join(dir, "comment.md"));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      return;
    }
  }
  if (command === "set" && repo && issue && (Object.hasOwn(STATES, state) || triggerLabels().includes(state))) {
    setState(repo, issue, state, commentFile);
    return;
  }
  // `done` means the factory's PR merged, not only that the issue closed: a human may close an issue that a
  // question parked, or close it mid-run, with no factory PR merged.
  if (command === "done" && repo && issue) {
    const prs = JSON.parse(
      gh(["pr", "list", "--repo", repo, "--state", "merged", "--limit", "100", "--json", "url,headRefName,isCrossRepository"]),
    );
    const pr = mergedFactoryPr(prs, issue);
    if (pr) setState(repo, issue, "factory:done");
    else console.error(`not done: no merged factory pull request for #${issue}`);
    return;
  }
  console.error(
    "usage: queue setup <owner/repo> | route <owner/repo> <label> | claim <owner/repo> <issue> <label> | report <owner/repo> <issue> <factory> <trigger> <exit-code> <output-file> <run-url> | set <owner/repo> <issue> <label> [comment.md] | done <owner/repo> <issue>",
  );
  process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
