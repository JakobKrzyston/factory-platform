/** The factory-platform roadmap: product outcomes and the technical requirements that deliver them.
 *  One source for the Throughline seed, docs/PLAN.md and the issue tracker tickets. */

export type Target = `${number}-Q${1 | 2 | 3 | 4}`;
export type WorkType = "feature" | "infrastructure" | "security" | "tech_debt" | "research";
export type Status = "planned" | "in_progress" | "done";

export interface Requirement {
  key: string;
  title: string;
  description: string;
  workType: WorkType;
  team: "platform" | "agents" | "measurement";
  target: Target;
  status?: Status;
  userVisible?: boolean;
  productNote?: string;
  acceptance: string[];
}

export interface Outcome {
  key: string;
  title: string;
  description: string;
  target: Target;
  priority: number;
  requirements: Requirement[];
}

export const PROJECT = { name: "Factory Platform", slug: "factory" } as const;

export const OUTCOMES: Outcome[] = [
  {
    key: "OUT-1",
    title: "The factory build is visible on a live roadmap",
    description:
      "Throughline tracks this project from day one: every merged pull request updates the plan, so anyone can see what has shipped and what slipped without reading the repo.",
    target: "2026-Q4",
    priority: 0,
    requirements: [
      {
        key: "TL-1",
        title: "Private Throughline instance on a dedicated database and model key",
        description:
          "A second Throughline deployment, separate from the public demo, with its own Neon database and the owner's Anthropic key, protected by Vercel authentication so only the owner can approve proposals.",
        workType: "infrastructure",
        team: "platform",
        target: "2026-Q4",
        status: "in_progress",
        acceptance: [
          "The factory database has every Throughline migration applied and a `factory` project.",
          "The deployment is unreachable without signing in to Vercel.",
          "Agents on the `factory` project run on the configured Anthropic model, never on the free demo model.",
        ],
      },
      {
        key: "TL-2",
        title: "Pull requests reconcile the roadmap automatically",
        description:
          "The factory-platform repository is connected through the GitHub App. A merged pull request that says `Implements TL-n` becomes a reconciliation proposal within minutes.",
        workType: "infrastructure",
        team: "platform",
        target: "2026-Q4",
        userVisible: true,
        productNote: "Each stage of the factory appears on the roadmap as soon as its work merges.",
        acceptance: [
          "Merging the first PR that implements a later requirement (TL-4) produces a pending proposal on the `factory` project.",
          "The proposal names the requirement and classifies the work as done, partly done, or scope added.",
        ],
      },
      {
        key: "TL-3",
        title: "Throughline MCP server for factory agents",
        description:
          "An MCP server over Throughline's API so a factory agent can read the requirement it is implementing and post its own link proposal, instead of a person editing PR descriptions by hand. Closes the loop between the two systems (throughline-roadmap issue #71).",
        workType: "feature",
        team: "agents",
        target: "2027-Q1",
        userVisible: true,
        productNote: "Agents report their own progress to the roadmap.",
        acceptance: [
          "A factory implementer can call `get_requirement(TL-n)` and `propose_link(pr, TL-n)`.",
          "Proposals created by agents are marked with their source and still require human approval.",
        ],
      },
    ],
  },
  {
    key: "OUT-2",
    title: "One factory turns a labelled issue into a reviewed pull request unattended",
    description:
      "Add a label to a GitHub issue and walk away. A triage agent sizes it, a spec agent writes the plan, an implementer builds it behind type, lint and test gates, and a reviewer with a fresh context checks the diff. What comes back is a PR that explains itself and waits for a human to merge.",
    target: "2026-Q4",
    priority: 1,
    requirements: [
      {
        key: "TL-4",
        title: "Run one agent non-interactively from a script",
        description:
          "A shell script that gives Claude Code one issue and gets one pull request back, with permissions and sandboxing settled so nobody is watching the terminal. The baseline every later stage is measured against.",
        workType: "infrastructure",
        team: "agents",
        target: "2026-Q4",
        acceptance: [
          "`scripts/run-issue.sh <issue>` opens a draft PR on a sample repository with no interactive prompts.",
          "The run records what the agent could see and do (allowed tools, working directory, time limit).",
          "A note in `docs/notes/` describes what the unattended agent did badly, as the baseline.",
        ],
      },
      {
        key: "TL-5",
        title: "Quality gates the agent cannot skip",
        description:
          "Type checks, lint and tests enforced through Claude Code hooks, so a run cannot finish while a check fails. Guidance in prompts makes good output likely; gates make bad output impossible to hand in.",
        workType: "infrastructure",
        team: "platform",
        target: "2026-Q4",
        acceptance: [
          "A stop hook blocks the agent from ending its turn while `typecheck`, `lint` or `test` fail.",
          "The hook output names the failing check so the agent can act on it.",
          "A deliberately broken fixture shows the agent repairing its own failure before finishing.",
        ],
      },
      {
        key: "TL-6",
        title: "Label-driven work queue on GitHub Actions",
        description:
          "A workflow fires when an issue gets the `factory:ready` label and moves it through `in-progress`, `in-review`, `needs-human` and `done`. Labels are the state machine, and asking a human is one of the states rather than a failure.",
        workType: "feature",
        team: "platform",
        target: "2026-Q4",
        userVisible: true,
        productNote: "Work is requested by adding a label; the factory reports back on the issue.",
        acceptance: [
          "Every state transition is a label change, visible in the issue timeline.",
          "A run that hits a question stops with `needs-human` and a comment stating the question.",
          "Two runs on the same issue cannot happen at once.",
        ],
      },
      {
        key: "TL-7",
        title: "Separate triage, spec, implement and review agents",
        description:
          "Each role is a file under `agents/<role>/agent.md` with its own prompt, model, tools and skills. The reviewer never sees the implementer's context, so it catches what the author could not. Triage runs on a cheaper model.",
        workType: "feature",
        team: "agents",
        target: "2026-Q4",
        acceptance: [
          "Four agent definitions exist and the workflow chains them by label.",
          "The review agent runs from a clean checkout of the PR branch with only the diff and the spec.",
          "Per-role model choice is a one-line change in the agent file.",
        ],
      },
      {
        key: "TL-8",
        title: "Pull requests that explain themselves",
        description:
          "Every factory PR states what changed, how to try it, the risk (one-way or two-way door), the blast radius, and the evidence: tests added, screenshots for UI, and which checks passed.",
        workType: "feature",
        team: "agents",
        target: "2026-Q4",
        userVisible: true,
        productNote: "A reviewer can decide in minutes whether a change is safe to merge.",
        acceptance: [
          "A PR template is filled in by the implementer and checked by the reviewer.",
          "A PR missing the risk or evidence sections is labelled `needs-human` instead of `in-review`.",
        ],
      },
      {
        key: "TL-9",
        title: "Review comments become standing rules",
        description:
          "Every human review comment is captured into `standards/` so the same comment never has to be left twice. The review agent reads the standards file, and a retro step proposes new rules from the week's comments.",
        workType: "feature",
        team: "agents",
        target: "2027-Q1",
        acceptance: [
          "A script collects review comments from merged PRs into a draft rules file.",
          "The review agent cites the rule it applied when it flags a finding.",
        ],
      },
      {
        key: "TL-10",
        title: "Human merge gate",
        description:
          "Branch protection ensures no factory PR merges without a human approval, however good the automated review was.",
        workType: "security",
        team: "platform",
        target: "2026-Q4",
        acceptance: [
          "The factory's GitHub token cannot merge or approve its own PRs.",
          "Branch protection on `main` requires one human review and green checks.",
        ],
      },
    ],
  },
  {
    key: "OUT-3",
    title: "Every run is measured",
    description:
      "Each agent run leaves a row: what it cost, how long it took, which checks passed, what the reviewer found and whether a human had to rework it. The numbers decide what to change next, not anecdotes.",
    target: "2027-Q1",
    priority: 2,
    requirements: [
      {
        key: "TL-11",
        title: "Run log schema",
        description:
          "A table (SQLite locally, Neon in the cloud) with one row per agent run: factory, role, issue, model, input and output tokens, cost, wall time, checks passed, review findings and a rework flag set when a human changed the PR before merging.",
        workType: "infrastructure",
        team: "measurement",
        target: "2027-Q1",
        acceptance: [
          "Schema and migration committed with a one-page description of each column.",
          "A run can be reconstructed from its row and the linked PR.",
        ],
      },
      {
        key: "TL-12",
        title: "Every agent run writes its log row",
        description:
          "Hooks and the workflow write a row at the start and end of each run. Token counts and cost come from the harness output; rework comes from comparing the PR at hand-off with the PR at merge.",
        workType: "infrastructure",
        team: "measurement",
        target: "2027-Q1",
        acceptance: [
          "100% of runs started by the workflow have a finished row or a failure row.",
          "Cost per run matches the provider's usage report within 5%.",
        ],
      },
      {
        key: "TL-13",
        title: "Cost and rework dashboard",
        description:
          "A page showing cost per PR, time per stage, pass rate at each gate and rework rate, per factory and per week. The chart that goes in the portfolio.",
        workType: "feature",
        team: "measurement",
        target: "2027-Q1",
        userVisible: true,
        productNote: "The cost of a pull request and how often a human had to fix it are visible at a glance.",
        acceptance: [
          "Dashboard reads the run log and renders per-week trends.",
          "One documented example of a factory change that moved a metric.",
        ],
      },
    ],
  },
  {
    key: "OUT-4",
    title: "Factory changes are proven against real work",
    description:
      "A benchmark of past issues from this repository can be replayed against any version of a factory, so a change to a prompt, a model or a gate is judged by the numbers it produces, not by how it feels.",
    target: "2027-Q1",
    priority: 3,
    requirements: [
      {
        key: "TL-14",
        title: "Benchmark set of past issues",
        description:
          "Ten to twenty closed issues with their merged PRs, each with a written expected outcome and the checks that prove it. Drawn from this repository as it grows, so the benchmark is the factory's own history.",
        workType: "research",
        team: "measurement",
        target: "2027-Q1",
        acceptance: [
          "`benchmark/` holds the issues, expected outcomes and a README on how they were chosen.",
          "At least two issues cover each role: triage-only, spec-heavy, implementation and review.",
        ],
      },
      {
        key: "TL-15",
        title: "Replay harness",
        description:
          "A command that runs the benchmark through a named factory version in isolated checkouts and writes the results to the run log tagged as a benchmark run.",
        workType: "infrastructure",
        team: "measurement",
        target: "2027-Q1",
        acceptance: [
          "`pnpm bench <factory> <git-ref>` runs every benchmark issue and prints a summary table.",
          "Benchmark runs are excluded from production metrics by a flag.",
        ],
      },
      {
        key: "TL-16",
        title: "Scorers",
        description:
          "Automated graders under `scorers/<name>/scorer.md`: did the tests the issue needed pass, did the diff stay inside the files the spec named, how many review findings, what did it cost. Scores are rows in the run log, so they appear on the dashboard.",
        workType: "feature",
        team: "measurement",
        target: "2027-Q1",
        acceptance: [
          "Each scorer is a file and runs on every benchmark result.",
          "A scorer's output is a number and a one-line reason, stored with the run.",
        ],
      },
    ],
  },
  {
    key: "OUT-5",
    title: "Factories are files: copy one to create, move folders to split",
    description:
      "A factory is a directory of agents, triggers, scorers and skills on top of a shared platform layer. Starting a factory for a new part of the product is copying a directory, and splitting a factory that has grown two kinds of work is moving agent folders.",
    target: "2027-Q2",
    priority: 4,
    requirements: [
      {
        key: "TL-17",
        title: "Factory definition as a directory",
        description:
          "`factories/<name>/` with `factory.yaml`, `agents/`, `triggers/`, `scorers/` and `skills/`. A resource's name is its path. Exactly one agent per factory is the foreman that dispatches the others.",
        workType: "infrastructure",
        team: "platform",
        target: "2027-Q2",
        acceptance: [
          "The first factory from OUT-2 is moved into this layout with no behaviour change (benchmark proves it).",
          "A README documents every file and field.",
        ],
      },
      {
        key: "TL-18",
        title: "Shared platform layer",
        description:
          "The queue, the run log, the gate runner and the replay harness live once under `platform/` and are used by every factory. Only agents, triggers, scorers and skills are per factory.",
        workType: "infrastructure",
        team: "platform",
        target: "2027-Q2",
        acceptance: [
          "No factory directory contains queue, log or gate code.",
          "A platform change is covered by the platform's own tests, independent of any factory.",
        ],
      },
      {
        key: "TL-19",
        title: "A second factory made by copying the first",
        description:
          "A factory for a different kind of work (documentation or frontend verification) created by copying the first directory and editing agents and triggers. The comparison shows what is truly shared and what is not.",
        workType: "feature",
        team: "platform",
        target: "2027-Q2",
        userVisible: true,
        productNote: "A new factory for a new part of the product takes an afternoon, not a rebuild.",
        acceptance: [
          "Two factories run from the same repository on different labels.",
          "A note records every file that had to change, and why.",
        ],
      },
      {
        key: "TL-20",
        title: "Definition validator",
        description:
          "A script that checks a factory directory: one foreman, every trigger names an existing agent, every scorer is referenced, no secrets in files. Runs in CI on every change to `factories/`.",
        workType: "infrastructure",
        team: "platform",
        target: "2027-Q2",
        acceptance: [
          "`pnpm validate-factory factories/<name>` fails with a named reason on each broken fixture.",
          "CI blocks a PR that breaks a factory definition.",
        ],
      },
      {
        key: "TL-21",
        title: "Split tooling",
        description:
          "A command that moves chosen agent folders, triggers and scorers from one factory into a new one, rewires the labels, and validates both results, for when the run log shows one factory doing two different jobs.",
        workType: "feature",
        team: "platform",
        target: "2027-Q2",
        acceptance: [
          "`pnpm split-factory <from> <to> --agents a,b` produces two valid factories.",
          "Run log rows keep their original factory name so history is not rewritten.",
        ],
      },
    ],
  },
  {
    key: "OUT-6",
    title: "The platform improves its own factories",
    description:
      "A meta-factory whose work items are the other factories' definitions. It reads the run log, proposes a change to a prompt, gate or model as a pull request, and proves the change against the benchmark before a human sees it.",
    target: "2027-Q2",
    priority: 5,
    requirements: [
      {
        key: "TL-22",
        title: "Meta-agent proposes factory changes from the run log",
        description:
          "An agent that reads the dashboard's data, picks the worst metric, and opens a PR against the responsible factory's files with a one-paragraph hypothesis. It edits only files under `factories/`.",
        workType: "feature",
        team: "agents",
        target: "2027-Q2",
        userVisible: true,
        productNote: "The system suggests its own improvements, backed by its own numbers.",
        acceptance: [
          "The meta-agent cannot touch `platform/` or application code; the validator and branch rules enforce it.",
          "Each proposal PR states the metric it targets and the expected direction.",
        ],
      },
      {
        key: "TL-23",
        title: "Benchmark gate on meta-pull requests",
        description:
          "A meta-PR runs the benchmark on both the current and the proposed factory and posts the comparison. It can only be merged if no scorer regressed beyond a stated tolerance.",
        workType: "infrastructure",
        team: "measurement",
        target: "2027-Q2",
        acceptance: [
          "The comparison table is a PR comment with before and after columns.",
          "A seeded regression is blocked by the gate in a test.",
        ],
      },
      {
        key: "TL-24",
        title: "Personal-task factory on the same primitives",
        description:
          "A factory for non-code work (research digests, personal admin) built from the same queue, log and agent layout, to show the platform is not tied to pull requests.",
        workType: "research",
        team: "agents",
        target: "2027-Q2",
        acceptance: [
          "One personal factory runs on a schedule and writes to the run log.",
          "A note lists which platform assumptions were pull-request-specific and had to loosen.",
        ],
      },
    ],
  },
];
