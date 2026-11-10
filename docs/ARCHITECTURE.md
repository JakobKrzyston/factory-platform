# Architecture

This document is written ahead of the code. Each section names the decision, the reason, and the stage that will test it. When a stage changes a decision, update the section in the same pull request and say why in the stage note.

## The shape

```
            label added                    PR opened                     merged
GitHub issue ──────────▶ platform/queue ──▶ factories/<name> agents ──▶ GitHub PR ──▶ human merges
                              │                   │       ▲                  │
                              │                   ▼       │ gates            │
                              │             platform/gates (hooks)           │
                              │                   │                          │
                              └───────────────────┴──▶ platform/runlog ◀─────┘
                                                            │
                                                            ▼
                                                  benchmark + scorers ──▶ meta-factory ──▶ PR to factories/
```

Three layers:

- **Platform** (`platform/`): the queue, the run log, the gate runner, the replay harness and the dashboard. Written once, shared by every factory, tested on its own.
- **Factories** (`factories/<name>/`): definitions only. Agents, triggers, scorers and skills as files. No code that could run without the platform.
- **Evidence** (`benchmark/`, `standards/`, `docs/notes/`): what the factory is measured against, the rules it has learned, and the record of each stage.

## Decisions

### The queue is GitHub issue labels (TL-6)

A factory needs a place where work waits and where its state lives. GitHub labels give both for free, are visible in the issue timeline, and need no service to run. The states are `factory:ready`, `factory:in-progress`, `factory:in-review`, `factory:needs-human` and `factory:done`. `needs-human` is a state, not a failure: an unattended agent that hits a question stops there with a comment.

Tested by: TL-6. Revisit if two factories need to share work or ordering matters, when a table in the run log database can take over.

### Gates are Claude Code hooks (TL-5)

A stop hook runs typecheck, lint and tests and refuses to let the agent end its turn while any fail. Hooks run outside the model, so they cannot be talked out of. The hook output names the failing check so the agent can act on it.

Tested by: TL-5. The same gates run in CI, so a PR cannot pass locally and fail on merge.

### One agent per role, one file per agent (TL-7)

`factories/<name>/agents/<role>/agent.md` holds the prompt, model, allowed tools and skills for one role. The reviewer runs from a clean checkout with only the diff and the spec. Triage runs on a cheaper model. Model choice is a one-line change, so the benchmark can compare models per role.

Tested by: TL-7, then the benchmark in TL-15.

### Humans merge: two rulesets and a factory App (TL-10)

The factory acts on GitHub as its own GitHub App, never as the owner and never through Actions' `GITHUB_TOKEN`. An owner token would make the owner the PR author, and GitHub does not let authors approve their own PRs, so the one human here could never approve factory work. `GITHUB_TOKEN` is ruled out twice: PRs it opens do not trigger workflows, so the required check would never run, and letting it open PRs also lets it approve them. The App gets read-write Contents, Pull requests and Issues, and nothing else: without Workflows it cannot edit `.github/workflows`, and without Checks or Commit statuses it cannot post a green check of its own.

Two rulesets on `main`, kept as JSON in `.github/rulesets/` and applied with `pnpm merge-gate`:

- **main: human merges** restricts updates, deletion and force pushes, and requires one approving review that is dismissed by later pushes and must come after the last push. Only the admin role bypasses it, and only through a pull request. The update restriction is what stops the App merging even after a human approves; the review rule is what stops anyone merging factory work unreviewed. The owner's bypass is how the owner merges their own PRs, since nobody else can review them.
- **main: green checks** requires the `checks` job from `.github/workflows/ci.yml`, pinned to the GitHub Actions app so nothing else can report it. Nobody bypasses it.

Two rulesets, because bypass is per ruleset: one ruleset would let the owner skip checks along with review. `pnpm check-merge-gate` proves the gate from the App's side by opening a PR, trying to approve and merge it, and expecting both to be refused.

Tested by: TL-10. Revisit when a second factory gets its own App: an App with write access can approve a PR it did not open, so two factory Apps could approve each other's PRs. Until then every factory shares one App.

### The run log is a table, not a log file (TL-11)

One row per run, written at start and end. SQLite in `.runlog/` locally, Neon Postgres in the cloud, same schema. Columns: `factory`, `role`, `issue`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `wall_seconds`, `checks_passed`, `review_findings`, `rework` (set when a human changed the PR between hand-off and merge), `benchmark` (true for replay runs, so they stay out of production metrics).

Tested by: TL-11, TL-12. The dashboard (TL-13) only reads this table.

### Benchmark from the repository's own history (TL-14)

The benchmark is closed issues from this repository with their merged PRs and a written expected outcome. It grows as the project does. A factory change is judged by replaying the benchmark on the old and new definition, scored by the files under `scorers/`.

Tested by: TL-14 to TL-16, then every meta-PR (TL-23).

### Factories are directories (TL-17)

Following Warp's layout: a resource's name is its path, exactly one agent per factory is the foreman, skills at the factory root apply to every agent and skills under an agent apply to that agent only. Creating a factory is copying a directory; splitting one is moving agent folders. A validator (TL-20) runs in CI.

Tested by: TL-17 moves the first factory into this layout with the benchmark proving no behaviour changed; TL-19 makes a second factory by copying.

### The meta-factory edits only definitions (TL-22)

The meta-agent reads the run log, picks the worst metric and opens a PR against `factories/`. Branch rules and the validator stop it touching `platform/`. The benchmark gate (TL-23) must pass before a human sees the PR.

Tested by: TL-22, TL-23.

### Throughline keeps the roadmap (TL-1 to TL-3)

`docs/roadmap.ts` is the source of truth. It renders `docs/PLAN.md`, seeds the Throughline `factory` project, and creates the tickets. PRs say `Implements TL-n`; Throughline reconciles them on merge.

Agents reach Throughline through its MCP server (TL-3), registered in `.mcp.json`: `get_requirement` reads the requirement being implemented and `propose_link` proposes the PR's link to it. The server lives in Throughline (`/api/mcp`), not in `platform/`, because it is a way into Throughline's graph and must go through Throughline's own proposal code; a copy here would have to write to its database directly. It authenticates with a bearer token plus the Vercel protection bypass, and has no tool that approves anything: an agent's link is a pending proposal labelled "Proposed by an agent" until the owner approves it. The bypass secret is the weak point. Throughline has no sign-in of its own, so the secret opens the whole instance, and an agent holding it could approve proposals on the review page. For now only interactive sessions the owner watches get it; they already hold the owner's GitHub login, which can merge, so it gives them nothing new. An unattended agent needs a way in that carries only the MCP token first (issue #35). The `throughline` skill in `.claude/skills/` tells an agent when to call each tool.

Tested by: TL-3. Unattended runs (TL-4) start Claude Code with `--bare` in a clone of the target repository, so they load no `.mcp.json`; passing `--mcp-config` would give them the tools. What holds that back is the credentials: which ones an unattended agent may carry belongs to its agent definition (TL-7).

## Non-goals

- Not a general agent framework. It runs Claude Code and, later, whatever harness a factory file names.
- Not a tracker. Linear or GitHub issues hold tickets; Throughline holds the roadmap; this repository holds the factory.
- No user accounts. One owner, protected by GitHub permissions and Vercel authentication on the dashboard.
