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

A factory needs a place where work waits and where its state lives. GitHub labels give both for free, are visible in the issue timeline, and need no service to run. The states are `factory:ready`, `factory:in-progress`, `factory:in-review`, `factory:needs-human` and `factory:done`. An issue carries exactly one, and the factory App makes every change. `needs-human` is a state, not a failure: an unattended agent that hits a question stops there with a comment.

`.github/workflows/factory.yml` fires when `factory:ready` is added, claims the issue, runs `scripts/run-issue.sh` on an Actions runner and moves the issue to `in-review` or `needs-human`. Merging the PR closes the issue, which moves it to `done`. The agent asks a question by ending its run with `QUESTION:`. TL-5's stop hook lets that stop through without running the checks: a question opens no PR, so there is nothing for the gate to protect. The human answers in a comment and re-adds `factory:ready`. The next prompt includes comments only from people who could have added the label, and from the App itself. Exclusion is GitHub's job concurrency, grouped by issue: one run at a time, others wait. A waiting run claims the issue only if it is still `factory:ready`. A run that dies still ends at `needs-human`, through an `always()` step. The platform side is `platform/queue/`.

The workflow's secrets live in a `factory` environment that deploys from `main` only. The factory pushes its branches to this repository, so CI on its PRs runs code an agent wrote. That code can reach the network, but the environment rule means it cannot read the Anthropic key or the App key, and no workflow on `push` or `pull_request` names a repository secret (#33).

Tested by: TL-6 (`docs/notes/06-label-queue.md`). Revisit if two factories need to share work or ordering matters, when a table in the run log database can take over.

### An unattended run is one confined headless Claude Code call (TL-4)

`scripts/run-issue.sh` clones the target repository into a temporary directory and runs `claude -p` there, with `--setting-sources ""` so none of the owner's settings, CLAUDE.md, skills or plugins load. (TL-4 used `--bare`, which also skips every hook, so TL-5 replaced it; see below.) Permissions are settled before the run, because nobody can answer a prompt: `dontAsk` mode denies anything not pre-approved, `Read` and `Edit` are allowed inside the clone only, and Bash runs in Claude Code's OS sandbox with no network, no writes outside the clone and no reads of the home directory. The agent is started with only `PATH` and `HOME` in its environment; Claude Code reads the API key through `apiKeyHelper` from a temporary file the agent is denied. The agent gets no git or GitHub access: the script commits, pushes and opens a draft PR, and refuses to when the run ended in an error or changed `.github/`. A pushed branch still runs the target repository's CI. That is safe only while that CI cannot read secrets: the sample repository has none, and this repository keeps the factory's secrets in an environment that deploys from `main` only (#33, TL-6). Each run's settings, transcript and outcome are written to `.runlog/runs/<run-id>/` until the run log table exists.

Tested by: TL-4 (`docs/notes/04-run-issue.md`). TL-6 runs the same script on GitHub Actions runners. It keeps the home-directory rule there, since the runner's home holds the workflow's checkout. It adds `sandbox.failIfUnavailable`, so a runner without bubblewrap fails the run instead of running Bash unsandboxed. It also moves the clone's git metadata outside the clone, since the script's git commands now run with the App's write token. The agent cannot commit or plant a hook or config there. The prompt goes in on stdin, because Linux caps a single argument at 128 KiB.

### Gates are Claude Code hooks (TL-5)

A stop hook runs typecheck, lint and tests and refuses to let the agent end its turn while any fail. Hooks run outside the model, so they cannot be talked out of. The hook output names the failing check so the agent can act on it.

How it is built (`platform/gates/`):

- **The hook is a `Stop` hook in the run's `--settings` file.** `--bare` skips hooks from settings and from `--plugin-dir` plugins alike (both probed), so the run no longer uses it. `--setting-sources ""` still keeps the owner's settings and CLAUDE.md out, and `autoMemoryEnabled: false` stops auto-memory writing under the owner's home, which is the one other thing `--bare` was preventing. The hook runs from this repository's root, not the clone, so tsx never loads the clone's `tsconfig.json`. The agent can neither read nor edit the hook, its log, or this repository.
- **Checks come from the target repository's `package.json` as it was before the agent started.** `run-issue.sh` copies it into the run directory, out of the agent's reach, and whichever of `typecheck`, `lint` and `test` it defines run, in that order. Reading `HEAD` instead would not have been enough: the agent's sandbox left `.git` writable, so it could commit its own `package.json`. TL-6 has since moved the clone's git metadata out of the agent's reach, but the copy stays: it is simpler to trust. A repository without `package.json` passes and the PR says "none defined". One that cannot be parsed crashes the hook, which fails closed. A script that calls `npm run <other>` still reads the working copy, so the guarantee covers only the three named scripts.
- **The checks run in their own OS sandbox.** Hooks run outside Claude Code's Bash sandbox. Without one, the hook would run code the agent wrote, such as its tests, with the owner's full access, and the output would go straight back to the agent. Each check runs under `srt` (`@anthropic-ai/sandbox-runtime`, Anthropic's sandbox runtime built for Claude Code's Bash sandbox) with no network, writes only in the clone, and no reads of the paths the agent's own sandbox denies: the home directory and the API key's directory. `run-issue.sh` passes both explicitly in `gate.json`. The hook inherits the agent's `env -i` environment, which has no `TMPDIR`, so deriving the key's location from `os.tmpdir()` pointed at `/tmp` and left the key readable (found in review; now covered by a test that starts the hook the same way). `srt` is started with the hook's own `node`, and the clone's `node_modules/.bin` goes on `PATH` only inside the sandbox. Through its pnpm shim, `srt` looked `node` up on that `PATH`, so a `node` planted in the clone ran before the sandbox existed (also found in review and now tested). The clone and the Node installation stay readable. `srt` uses Seatbelt on macOS and bubblewrap on Linux. GitHub's Ubuntu runners do not allow bubblewrap's user namespaces by default, so the sandbox tests run on macOS only. TL-6's factory workflow lifts that restriction on its own runner, with the `sysctl` that srt's documentation gives, and installs bubblewrap, socat and ripgrep.
- **Exit code 2 blocks the stop.** stderr becomes the agent's next message: the failing check's name, the checks that passed, and the last 60 lines of each failure's output.
- **Five blocks, then the hook lets go.** An unfixable failure, such as a test already broken on the base branch, would otherwise spend the whole $5 budget. After five refused attempts the agent may stop, and the run opens no PR.
- **The script trusts the gate's log, not the agent.** Each attempt to finish appends a line to `gates.jsonl` in the run directory. `run-issue.sh` opens a PR only when the last line passed. A hook that crashed or timed out (600 s; 180 s per check) leaves no passing line, so it fails closed. `run.json` records `checks_passed`, `checks`, `gate_attempts` and `gate_failures`.
- **Lint is Biome** (`biome lint`, recommended rules), one pinned binary. `biome.json` only makes it honour `.gitignore`, so local run logs are not linted. Errors fail the check and warnings are only shown.

The gate stops an agent from handing in work that fails. It does not stop an agent that sets out to fool it: editing a test until it passes shows up in the diff, but a fake `node_modules/.bin/node` (now sandboxed, but still able to fake a pass) is git-ignored and would not. Catching that is review's job (TL-7) or a later gate. Known gaps, left for later stages:
- TL-6 installs the clone's dependencies before the agent starts, but only from a pnpm lockfile, so repositories using another package manager still fail any check that needs a dependency.
- `tsx` cannot run in the checks' sandbox: it opens a Unix socket for IPC, and the sandbox's network rule denies it. This repository's own `test` script uses `tsx`, so the factory cannot pass the gate here yet.
- Files the checks write into the clone end up in the PR.
- When the time limit kills `claude`, a running hook is not killed with it.
- A `node` reached through a version-manager shim under the home directory cannot run in the sandbox.

Tested by: TL-5 (`docs/notes/05-quality-gates.md`). CI runs the same `typecheck`, `lint` and `test` scripts on this repository, so a PR cannot pass locally and fail on merge.

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

One row per run, written at start and end. SQLite in `.runlog/` locally, Neon Postgres in the cloud, same schema: one SQL file (`platform/runlog/migrations/001_runs.sql`) runs unchanged on both. Columns: `factory`, `role`, `issue`, `model`, `input_tokens`, `output_tokens`, `cost_usd`, `wall_seconds`, `checks_passed`, `review_findings`, `rework` (set when a human changed the PR between hand-off and merge), `benchmark` (true for replay runs, so they stay out of production metrics).

TL-11 added the columns a run needs to be reconstructed from its row and its PR: `id`, `status`, `started_at` and `ended_at`; `factory_sha` (which definition ran); `repo`, `pr` and `head_sha` (exactly what it produced, and what `rework` compares against); and `cache_read_tokens` and `cache_write_tokens`, without which input tokens understate an agent run and cost cannot be checked. Each column is described in `platform/runlog/README.md`.

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
