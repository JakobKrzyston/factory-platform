# Build plan

<!-- Generated from docs/roadmap.ts by scripts/render-plan.ts. Edit the .ts file, not this one. -->

Each outcome is what a reader of the product roadmap sees; each requirement (`TL-n`) is one ticket and, usually, one pull request. A requirement is done when its acceptance list passes and the PR that says `Implements TL-n` has merged.

Read `docs/ARCHITECTURE.md` before starting any requirement.

**Workflow for every requirement**

1. Branch from `main` as `tl/N-short-name` (`wt new N-short-name` creates it).
2. Build only what the requirement describes. Anything else becomes a new ticket.
3. Write the note the acceptance list asks for, if it asks for one, under `docs/notes/`.
4. Open a PR titled `TL-N: <title>` with what was built, how to try it, the risk and blast radius, and `Implements TL-N`.
5. Record what the run cost once the run log exists (TL-11).

---

## OUT-1: The factory build is visible on a live roadmap

Target: 2026-Q4

Throughline tracks this project from day one: every merged pull request updates the plan, so anyone can see what has shipped and what slipped without reading the repo.

### TL-1: Private Throughline instance on a dedicated database and model key

infrastructure · platform · 2026-Q4 · in_progress

A second Throughline deployment, separate from the public demo, with its own Neon database and the owner's Anthropic key, protected by Vercel authentication so only the owner can approve proposals.

**Acceptance**

- The factory database has every Throughline migration applied and a `factory` project.
- The deployment is unreachable without signing in to Vercel.
- Agents on the `factory` project run on the configured Anthropic model, never on the free demo model.

### TL-2: Pull requests reconcile the roadmap automatically

infrastructure · platform · 2026-Q4

The factory-platform repository is connected through the GitHub App. A merged pull request that says `Implements TL-n` becomes a reconciliation proposal within minutes.

**Acceptance**

- Merging a PR with `Implements TL-4` produces a pending proposal on the `factory` project.
- The proposal names the requirement and classifies the work as done, partly done, or scope added.

### TL-3: Throughline MCP server for factory agents

feature · agents · 2027-Q1

An MCP server over Throughline's API so a factory agent can read the requirement it is implementing and post its own link proposal, instead of a person editing PR descriptions by hand. Closes the loop between the two systems (throughline-roadmap issue #71).

**Acceptance**

- A factory implementer can call `get_requirement(TL-n)` and `propose_link(pr, TL-n)`.
- Proposals created by agents are marked with their source and still require human approval.

---

## OUT-2: One factory turns a labelled issue into a reviewed pull request unattended

Target: 2026-Q4

Add a label to a GitHub issue and walk away. A triage agent sizes it, a spec agent writes the plan, an implementer builds it behind type, lint and test gates, and a reviewer with a fresh context checks the diff. What comes back is a PR that explains itself and waits for a human to merge.

### TL-4: Run one agent non-interactively from a script

infrastructure · agents · 2026-Q4

A shell script that gives Claude Code one issue and gets one pull request back, with permissions and sandboxing settled so nobody is watching the terminal. The baseline every later stage is measured against.

**Acceptance**

- `scripts/run-issue.sh <issue>` opens a draft PR on a sample repository with no interactive prompts.
- The run records what the agent could see and do (allowed tools, working directory, time limit).
- A note in `docs/notes/` describes what the unattended agent did badly, as the baseline.

### TL-5: Quality gates the agent cannot skip

infrastructure · platform · 2026-Q4

Type checks, lint and tests enforced through Claude Code hooks, so a run cannot finish while a check fails. Guidance in prompts makes good output likely; gates make bad output impossible to hand in.

**Acceptance**

- A stop hook blocks the agent from ending its turn while `typecheck`, `lint` or `test` fail.
- The hook output names the failing check so the agent can act on it.
- A deliberately broken fixture shows the agent repairing its own failure before finishing.

### TL-6: Label-driven work queue on GitHub Actions

feature · platform · 2026-Q4

A workflow fires when an issue gets the `factory:ready` label and moves it through `in-progress`, `in-review`, `needs-human` and `done`. Labels are the state machine, and asking a human is one of the states rather than a failure.

**Acceptance**

- Every state transition is a label change, visible in the issue timeline.
- A run that hits a question stops with `needs-human` and a comment stating the question.
- Two runs on the same issue cannot happen at once.

### TL-7: Separate triage, spec, implement and review agents

feature · agents · 2026-Q4

Each role is a file under `agents/<role>/agent.md` with its own prompt, model, tools and skills. The reviewer never sees the implementer's context, so it catches what the author could not. Triage runs on a cheaper model.

**Acceptance**

- Four agent definitions exist and the workflow chains them by label.
- The review agent runs from a clean checkout of the PR branch with only the diff and the spec.
- Per-role model choice is a one-line change in the agent file.

### TL-8: Pull requests that explain themselves

feature · agents · 2026-Q4

Every factory PR states what changed, how to try it, the risk (one-way or two-way door), the blast radius, and the evidence: tests added, screenshots for UI, and which checks passed.

**Acceptance**

- A PR template is filled in by the implementer and checked by the reviewer.
- A PR missing the risk or evidence sections is labelled `needs-human` instead of `in-review`.

### TL-9: Review comments become standing rules

feature · agents · 2027-Q1

Every human review comment is captured into `standards/` so the same comment never has to be left twice. The review agent reads the standards file, and a retro step proposes new rules from the week's comments.

**Acceptance**

- A script collects review comments from merged PRs into a draft rules file.
- The review agent cites the rule it applied when it flags a finding.

### TL-10: Human merge gate

security · platform · 2026-Q4

Branch protection ensures no factory PR merges without a human approval, however good the automated review was.

**Acceptance**

- The factory's GitHub token cannot merge or approve its own PRs.
- Branch protection on `main` requires one human review and green checks.

---

## OUT-3: Every run is measured

Target: 2027-Q1

Each agent run leaves a row: what it cost, how long it took, which checks passed, what the reviewer found and whether a human had to rework it. The numbers decide what to change next, not anecdotes.

### TL-11: Run log schema

infrastructure · measurement · 2027-Q1

A table (SQLite locally, Neon in the cloud) with one row per agent run: factory, role, issue, model, input and output tokens, cost, wall time, checks passed, review findings and a rework flag set when a human changed the PR before merging.

**Acceptance**

- Schema and migration committed with a one-page description of each column.
- A run can be reconstructed from its row and the linked PR.

### TL-12: Every agent run writes its log row

infrastructure · measurement · 2027-Q1

Hooks and the workflow write a row at the start and end of each run. Token counts and cost come from the harness output; rework comes from comparing the PR at hand-off with the PR at merge.

**Acceptance**

- 100% of runs started by the workflow have a finished row or a failure row.
- Cost per run matches the provider's usage report within 5%.

### TL-13: Cost and rework dashboard

feature · measurement · 2027-Q1

A page showing cost per PR, time per stage, pass rate at each gate and rework rate, per factory and per week. The chart that goes in the portfolio.

**Acceptance**

- Dashboard reads the run log and renders per-week trends.
- One documented example of a factory change that moved a metric.

---

## OUT-4: Factory changes are proven against real work

Target: 2027-Q1

A benchmark of past issues from this repository can be replayed against any version of a factory, so a change to a prompt, a model or a gate is judged by the numbers it produces, not by how it feels.

### TL-14: Benchmark set of past issues

research · measurement · 2027-Q1

Ten to twenty closed issues with their merged PRs, each with a written expected outcome and the checks that prove it. Drawn from this repository as it grows, so the benchmark is the factory's own history.

**Acceptance**

- `benchmark/` holds the issues, expected outcomes and a README on how they were chosen.
- At least two issues cover each role: triage-only, spec-heavy, implementation and review.

### TL-15: Replay harness

infrastructure · measurement · 2027-Q1

A command that runs the benchmark through a named factory version in isolated checkouts and writes the results to the run log tagged as a benchmark run.

**Acceptance**

- `pnpm bench <factory> <git-ref>` runs every benchmark issue and prints a summary table.
- Benchmark runs are excluded from production metrics by a flag.

### TL-16: Scorers

feature · measurement · 2027-Q1

Automated graders under `scorers/<name>/scorer.md`: did the tests the issue needed pass, did the diff stay inside the files the spec named, how many review findings, what did it cost. Scores are rows in the run log, so they appear on the dashboard.

**Acceptance**

- Each scorer is a file and runs on every benchmark result.
- A scorer's output is a number and a one-line reason, stored with the run.

---

## OUT-5: Factories are files: copy one to create, move folders to split

Target: 2027-Q2

A factory is a directory of agents, triggers, scorers and skills on top of a shared platform layer. Starting a factory for a new part of the product is copying a directory, and splitting a factory that has grown two kinds of work is moving agent folders.

### TL-17: Factory definition as a directory

infrastructure · platform · 2027-Q2

`factories/<name>/` with `factory.yaml`, `agents/`, `triggers/`, `scorers/` and `skills/`. A resource's name is its path. Exactly one agent per factory is the foreman that dispatches the others.

**Acceptance**

- The first factory from OUT-2 is moved into this layout with no behaviour change (benchmark proves it).
- A README documents every file and field.

### TL-18: Shared platform layer

infrastructure · platform · 2027-Q2

The queue, the run log, the gate runner and the replay harness live once under `platform/` and are used by every factory. Only agents, triggers, scorers and skills are per factory.

**Acceptance**

- No factory directory contains queue, log or gate code.
- A platform change is covered by the platform's own tests, independent of any factory.

### TL-19: A second factory made by copying the first

feature · platform · 2027-Q2

A factory for a different kind of work (documentation or frontend verification) created by copying the first directory and editing agents and triggers. The comparison shows what is truly shared and what is not.

**Acceptance**

- Two factories run from the same repository on different labels.
- A note records every file that had to change, and why.

### TL-20: Definition validator

infrastructure · platform · 2027-Q2

A script that checks a factory directory: one foreman, every trigger names an existing agent, every scorer is referenced, no secrets in files. Runs in CI on every change to `factories/`.

**Acceptance**

- `pnpm validate-factory factories/<name>` fails with a named reason on each broken fixture.
- CI blocks a PR that breaks a factory definition.

### TL-21: Split tooling

feature · platform · 2027-Q2

A command that moves chosen agent folders, triggers and scorers from one factory into a new one, rewires the labels, and validates both results, for when the run log shows one factory doing two different jobs.

**Acceptance**

- `pnpm split-factory <from> <to> --agents a,b` produces two valid factories.
- Run log rows keep their original factory name so history is not rewritten.

---

## OUT-6: The platform improves its own factories

Target: 2027-Q2

A meta-factory whose work items are the other factories' definitions. It reads the run log, proposes a change to a prompt, gate or model as a pull request, and proves the change against the benchmark before a human sees it.

### TL-22: Meta-agent proposes factory changes from the run log

feature · agents · 2027-Q2

An agent that reads the dashboard's data, picks the worst metric, and opens a PR against the responsible factory's files with a one-paragraph hypothesis. It edits only files under `factories/`.

**Acceptance**

- The meta-agent cannot touch `platform/` or application code; the validator and branch rules enforce it.
- Each proposal PR states the metric it targets and the expected direction.

### TL-23: Benchmark gate on meta-pull requests

infrastructure · measurement · 2027-Q2

A meta-PR runs the benchmark on both the current and the proposed factory and posts the comparison. It can only be merged if no scorer regressed beyond a stated tolerance.

**Acceptance**

- The comparison table is a PR comment with before and after columns.
- A seeded regression is blocked by the gate in a test.

### TL-24: Personal-task factory on the same primitives

research · agents · 2027-Q2

A factory for non-code work (research digests, personal admin) built from the same queue, log and agent layout, to show the platform is not tied to pull requests.

**Acceptance**

- One personal factory runs on a schedule and writes to the run log.
- A note lists which platform assumptions were pull-request-specific and had to loosen.

---
