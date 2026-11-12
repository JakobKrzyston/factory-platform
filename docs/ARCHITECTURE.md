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

`.github/workflows/factory.yml` fires when `factory:ready` is added, claims the issue, runs `scripts/run-issue.sh` on an Actions runner and moves the issue to `in-review` or `needs-human`. Merging the PR closes the issue, which moves it to `done`. The agent asks a question by ending its run with `QUESTION:`. TL-5's stop hook lets that stop through without running the checks: a question opens no PR, so there is nothing for the gate to protect. The human answers in a comment and re-adds `factory:ready`. The next prompt includes comments only from people who could have added the label, and from the App itself. Exclusion is GitHub's job concurrency, grouped by issue: one run at a time, others wait. A waiting run claims the issue only if it is still `factory:ready`. A run that dies still ends at `needs-human`, through an `always()` step. The platform side is `platform/queue/`. TL-7 replaced the single run with a chain of four, one per label from `factory:ready` to `factory:in-review` (below and `platform/queue/README.md`). Since then the `done` job accepts any factory state but needs the factory's own PR to have merged, and a closed issue moves only to `done`.

The workflow's secrets live in a `factory` environment that deploys from `main` only. The factory pushes its branches to this repository, so CI on its PRs runs code an agent wrote. That code can reach the network, but the environment rule means it cannot read the Anthropic key or the App key, and no workflow on `push` or `pull_request` names a repository secret (#33).

Tested by: TL-6 (`docs/notes/06-label-queue.md`). Revisit if two factories need to share work or ordering matters, when a table in the run log database can take over.

### An unattended run is one confined headless Claude Code call (TL-4)

`scripts/run-issue.sh` clones the target repository into a temporary directory and runs `claude -p` there, with `--setting-sources ""` so none of the owner's settings, CLAUDE.md, skills or plugins load. (TL-4 used `--bare`, which also skips every hook, so TL-5 replaced it; see below.) Permissions are settled before the run, because nobody can answer a prompt: `dontAsk` mode denies anything not pre-approved, `Read` and `Edit` are allowed inside the clone only, and Bash runs in Claude Code's OS sandbox with no network, no writes outside the clone and no reads of the home directory. The agent is started with only `PATH` and `HOME` in its environment; Claude Code reads the API key through `apiKeyHelper` from a temporary file the agent is denied. The agent gets no git or GitHub access: the script commits, pushes and opens a draft PR, and refuses to when the run ended in an error or changed `.github/`. A pushed branch still runs the target repository's CI. That is safe only while that CI cannot read secrets: the sample repository has none, and this repository keeps the factory's secrets in an environment that deploys from `main` only (#33, TL-6). Each run's settings, transcript, outcome and the agent's changes as `changes.patch` are written to `.runlog/runs/<run-id>/`, and since TL-12 the run is also a row in the run log table. The clone is deleted when the script exits, so a run that opened no PR leaves its work only in that patch. The time limit runs `claude` in its own process group and kills the whole group when the limit passes, when `claude` exits, or when the script is interrupted, so a hung test or a watcher the agent or the stop hook started does not outlive the run (#34). A process that leaves the group with `setsid` escapes it. On Linux the sandbox's own commands do, but bubblewrap, which stays in the group, kills them when it dies.

Tested by: TL-4 (`docs/notes/04-run-issue.md`). TL-6 runs the same script on GitHub Actions runners. It keeps the home-directory rule there, since the runner's home holds the workflow's checkout. It adds `sandbox.failIfUnavailable`, so a runner without bubblewrap fails the run instead of running Bash unsandboxed. It also moves the clone's git metadata outside the clone, since the script's git commands now run with the App's write token. The agent cannot commit or plant a hook or config there. The prompt goes in on stdin, because Linux caps a single argument at 128 KiB.

### Gates are Claude Code hooks (TL-5)

A stop hook runs typecheck, lint and tests and refuses to let the agent end its turn while any fail. Hooks run outside the model, so they cannot be talked out of. The hook output names the failing check so the agent can act on it.

How it is built (`platform/gates/`):

- **The hook is a `Stop` hook in the run's `--settings` file.** `--bare` skips hooks from settings and from `--plugin-dir` plugins alike (both probed), so the run no longer uses it. `--setting-sources ""` still keeps the owner's settings and CLAUDE.md out, and `autoMemoryEnabled: false` stops auto-memory writing under the owner's home, which is the one other thing `--bare` was preventing. The hook runs from this repository's root, not the clone, so tsx never loads the clone's `tsconfig.json`. The agent can neither read nor edit the hook, its log, or this repository.
- **Checks come from the target repository's `package.json` as it was before the agent started.** `run-issue.sh` copies it into the run directory, out of the agent's reach, and whichever of `typecheck`, `lint` and `test` it defines run, in that order. Reading `HEAD` instead would not have been enough: the agent's sandbox left `.git` writable, so it could commit its own `package.json`. TL-6 has since moved the clone's git metadata out of the agent's reach, but the copy stays: it is simpler to trust. A repository without `package.json` passes and the PR says "none defined". One that cannot be parsed crashes the hook, which fails closed. A script that calls `npm run <other>` still reads the working copy, so the guarantee covers only the three named scripts.
- **The checks run in their own OS sandbox.** Hooks run outside Claude Code's Bash sandbox. Without one, the hook would run code the agent wrote, such as its tests, with the owner's full access, and the output would go straight back to the agent. Each check runs under `srt` (`@anthropic-ai/sandbox-runtime`, Anthropic's sandbox runtime built for Claude Code's Bash sandbox) with no network, writes only in the clone, and no reads of the paths the agent's own sandbox denies: the home directory and the API key's directory. `run-issue.sh` passes both explicitly in `gate.json`. The hook inherits the agent's `env -i` environment, which has no `TMPDIR`, so deriving the key's location from `os.tmpdir()` pointed at `/tmp` and left the key readable (found in review; now covered by a test that starts the hook the same way). `srt` is started with the hook's own `node`, and the clone's `node_modules/.bin` goes on `PATH` only inside the sandbox. Through its pnpm shim, `srt` looked `node` up on that `PATH`, so a `node` planted in the clone ran before the sandbox existed (also found in review and now tested). The clone, the Node installation and srt's own package stay readable. On Linux, srt runs its seccomp helper from that package inside the sandbox, and on a runner the package is under the denied home directory. The checks get a private `TMPDIR`, removed after each attempt: srt's default, `/tmp/claude`, exists only where Claude Code has created it, and the agent's own sandbox writes there. `srt` uses Seatbelt on macOS and bubblewrap on Linux. GitHub's Ubuntu runners do not allow bubblewrap's user namespaces by default, so the sandbox tests run on macOS only, and they skip inside the gate because `srt` cannot start inside `srt`. TL-6's factory workflow lifts that restriction on its own runner, with the `sysctl` that srt's documentation gives, and installs bubblewrap, socat and ripgrep. From Ubuntu 26.04, which `ubuntu-latest` now is, an AppArmor profile, `bwrap-userns-restrict`, also strips the nested namespace srt's seccomp helper needs, so the workflow unloads it (#41). CI's `gate` job does the same, runs the real hook on this repository, and checks that a check reaches neither the network, Docker's socket, the home directory nor a key file.
- **Exit code 2 blocks the stop.** stderr becomes the agent's next message: the failing check's name, the checks that passed, and the last 60 lines of each failure's output.
- **Five blocks, then the hook lets go.** An unfixable failure, such as a test already broken on the base branch, would otherwise spend the whole $5 budget. After five refused attempts the agent may stop, and the run opens no PR.
- **The script trusts the gate's log, not the agent.** Each attempt to finish appends a line to `gates.jsonl` in the run directory. `run-issue.sh` opens a PR only when the last line passed. A hook that crashed or timed out (600 s; 180 s per check) leaves no passing line, so it fails closed. `run.json` records `checks_passed`, `checks`, `gate_attempts` and `gate_failures`.
- **Lint is Biome** (`biome lint`, recommended rules), one pinned binary. `biome.json` only makes it honour `.gitignore`, so local run logs are not linted. Errors fail the check and warnings are only shown.

The gate stops an agent from handing in work that fails. It does not stop an agent that sets out to fool it: editing a test until it passes shows up in the diff, but a fake `node_modules/.bin/node` (now sandboxed, but still able to fake a pass) is git-ignored and would not. Catching that is review's job (TL-7, which sees the diff but not git-ignored files) or a later gate. Known gaps, left for later stages:
- TL-6 installs the clone's dependencies before the agent starts, but only from a pnpm lockfile, so repositories using another package manager still fail any check that needs a dependency.
- `tsx`'s CLI cannot run in the checks' sandbox: it opens a Unix socket for IPC, and the sandbox denies Unix sockets. `node --import tsx` loads the same compiler without the socket, so this repository's `test` script uses it (#41). Allowing the socket was rejected: on Linux `srt` can allow all Unix sockets or none, and all would include Docker's, which is root on GitHub's runners. A target repository whose checks call `tsx` directly still fails the gate.
- Files the checks write into the clone end up in the PR.
- A `node` reached through a version-manager shim under the home directory cannot run in the sandbox.

Tested by: TL-5 (`docs/notes/05-quality-gates.md`). CI runs the same `typecheck`, `lint` and `test` scripts on this repository, so a PR cannot pass locally and fail on merge.

### One agent per role, one file per agent (TL-7)

`factories/code/agents/<role>/agent.md` holds one role's model, tools, budget, time limit and system prompt: `key: value` lines between `---` fences, then the prompt. Model choice is a one-line change, so the benchmark can compare models per role. `platform/agents/agent.ts` parses it and refuses a missing or unknown setting, and any tool other than `Bash`, `Edit` and `Read`. Those are the three `run-issue.sh` confines, so a definition cannot hand an agent an unconfined tool such as `WebFetch`.

The four roles are triage (Haiku), spec, implement and review (Sonnet). The queue chains them by label (since TL-17, the factory's `triggers/`): each is a separate workflow run on a fresh runner, and its success adds the label that starts the next. They hand work on through GitHub, not through a shared disk. The triage note and the spec are issue comments from the factory App, the implementation is a draft PR, and the review is a comment on that PR.

`run-issue.sh <role>` keeps one confinement for every role and adds what differs, which is the platform's contract rather than the definition's:

- **Inputs.** Triage, spec and implement get the issue and its trusted comments, the spec included.
- **The gate.** Only implement hands in changes, so only implement gets the stop hook, which since TL-8 also checks the PR description. `run-issue.sh` appends the pr-description skill and the PR template to implement's prompt, because that check enforces them; a definition cannot drop them.
- **The reviewer's isolation.** It gets a fresh clone, detached at the head commit of the issue's newest open factory PR from this repository. It is also denied the clone's git metadata, which holds the commit message, and with it the issue's title, as well as earlier attempts on other branches. Its prompt holds only the latest App-or-maintainer comment headed `<!-- factory:spec -->` and `git diff base...head`: no issue, no other comments, no PR description, and no transcript, which lives on another runner. It checks out the PR's head only after installing the base branch's dependencies, because pnpm runs a `.pnpmfile.cjs` from an agent-written branch even with `--ignore-scripts`, outside any sandbox. Its review is posted as a comment, never a review, so the factory still cannot approve (TL-10). The run log counts its `## Findings` bullets as `review_findings`. A `QUESTION:` from it is posted as its review, since nobody could answer it.

Not yet: skills a definition chooses, and MCP servers. Every run still uses `--setting-sources ""` and `--strict-mcp-config`, so no role loads either. The role contracts live in `scripts/run-issue.sh`, by role name, so a second factory with different roles needs a branch there (TL-18). TL-17 moved the chain itself into the factory's triggers. A blocking finding does not send the PR back to implement; a human reads it.

Tested by: TL-7 (`docs/notes/07-role-agents.md`), then the benchmark in TL-15.

### A pull request states its risk and evidence, or a person sees it first (TL-8)

The repository's one pull request template, `.github/pull_request_template.md`, is also the factory's: What was built, How to try it, Risk (one-way or two-way door, blast radius) and Evidence. Its hints are HTML comments, so an unfilled section reads as empty. The guidance is a shared skill, `factories/code/skills/pr-description/SKILL.md`, with one part for the implementer and one for the reviewer. `run-issue.sh` puts the skill and the template in the implement role's system prompt, and the agent's final message becomes the description. TL-7's review agent does not run the reviewer part: it sees only the spec and the diff, never the description, so that the author's account of the change cannot steer the review. A person still checks the description's claims against the diff.

The gate is the stop hook. Claude Code gives it the agent's final message, and `platform/gates/pr-description.ts` checks that message: a Risk section naming the door and the blast radius, and an Evidence section that is not empty. While either fails, the hook refuses the stop, the same way it refuses a failing check, and tells the agent to write the whole description again. Putting the check here matters because a refused stop changes the final message. After fixing a lint failure, an agent tends to end with "Fixed the lint error", and only that message becomes `.result`. A check that ran after the agent finished would send a good PR to a person; the hook makes the agent rewrite its description first. Each line of `gates.jsonl` records `description_problems`, and these refusals count toward the same `MAX_BLOCKS` as failing checks. `passed` still means the checks alone.

The fallback is for a run whose hook gave up refusing. `run-issue.sh` reads the last gate line's `description_problems` with `jq`, after the push, so deciding the label cannot lose the work. If the list is not empty, the draft PR still opens, since filling in a section costs less than a rerun. The script exits 4, and the workflow labels the issue `needs-human` instead of `factory:review`, with a comment listing what is missing, so the review agent never runs on a PR a person must fix first. The person fills the description in, then adds `factory:review` or merges. The `done` job accepts any factory state, `needs-human` included, and moves the issue to `done` when the factory's PR merged, so merging that PR after fixing its description still reaches `done` and records rework.

Tested by: TL-8 (`docs/notes/08-self-explaining-prs.md`).

### Review comments become numbered rules the reviewer must cite (TL-9)

`standards/rules.md` holds the standing rules as `## R-n: Title` headings, each with the `Source:` it came from. `pnpm standards collect` (`platform/standards/standards.ts`) reads the pull requests merged in the last week and appends every human reviewer's comment to `standards/draft.md`: inline comments, review summaries and conversation comments, without the PR's author or bots. It skips a comment whose link is already in `rules.md`, `rejected.md` or the draft, and never rewrites the draft, so a decision or an edit is never lost. A human promotes each entry to a rule or rejects it. The script does not write rules itself. Most review comments are about one PR, not a habit, and a rule the reviewer applies to every diff should be one a person chose.

The review agent cites rules through guidance and a gate, both wired into `scripts/run-issue.sh review`:

- **Guidance.** The reviewer works in a clone of the target repository, which has no `standards/`. So its system prompt is `agent.md` followed by `agents/review/skills/cite-standards/SKILL.md` and `rules.md`. Every list item under `## Findings` starts with `[R-n]` or `[no rule]`.
- **Gate.** A Stop hook (`standards.ts review-hook`) checks the agent's last message, which is the review, and refuses the stop with the errors while the findings break that format, as the implement role's hook does with failing checks. The review hook runs no code from the clone, so it needs no sandbox. After 5 refusals it lets go. The script then runs `check-review` on the final review itself, and posts nothing if it fails. `review_findings` comes from that same check.

A finding is any list item, nested or not, in the one `## Findings` section. The section ends at the next heading or horizontal rule, and code fences are skipped, so trailing prose or a quoted heading changes nothing. IDs are never reused, so old citations stay unambiguous. `[no rule]` findings are where the next rules come from.

Tested by: TL-9 (`docs/notes/09-review-standing-rules.md`).

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

The writer is `platform/runlog/runlog.ts`, called by the script and the workflow rather than by Claude Code hooks (TL-12). Hooks run in the agent's environment, which `run-issue.sh` empties to `PATH` and `HOME` so nothing secret can reach a public PR; a hook that wrote rows would need `DATABASE_URL` there. The script also already holds what a row needs: the transcript, the gate log and the PR. It inserts the row first, before anything that can fail, and ends it from an `EXIT` trap, so every exit writes an outcome. The workflow's last step ends any row still running as `failed`, with whatever the run's directory holds, for a script that was killed or cancelled, and its `done` job sets `rework` by comparing each merged PR's head with the commit the run handed off. A workflow run's row id is `github-<run id>-<attempt>`, so rows and Actions runs join directly. Tokens and cost are Claude Code's own report, summed over every model the run called.

Tested by: TL-11, TL-12 (`docs/notes/12-run-log-rows.md`). The dashboard (TL-13) only reads this table.

### The dashboard is a static page rendered from the run log (TL-13)

`pnpm dashboard` reads the `runs` table and writes one self-contained HTML file: inline SVG charts and a table, with no scripts, no chart library and no server. A hosted app would need its own deploy, its own read access to Neon, and Vercel authentication. That is more moving parts than four weekly charts need, and none of it would change what the numbers say. A file can be opened locally, attached to a stage note, or published by any static host later.

The page groups ended production runs by factory and by the UTC week they started, and computes every metric in TypeScript rather than SQL. Week arithmetic differs between SQLite and Postgres, and the run log's rule is one query that runs on both. The same rows give byte-identical pages from either database. What each metric counts is defined in `platform/dashboard/README.md`.

Tested by: TL-13 (`docs/notes/13-cost-rework-dashboard.md`). Revisit when someone other than the owner needs to see it without running a command: then a scheduled workflow renders it from Neon and publishes it behind authentication.

### Benchmark from the repository's own history (TL-14)

The benchmark is past issues from this repository, most with a merged PR, and a written expected outcome for each. It grows as the project does. A factory change is judged by replaying the benchmark on the old and new definition, scored by the files under `scorers/`.

Each case is `benchmark/<issue>-<slug>/case.md`. Its settings are `key: value` lines between `---` fences, like `agent.md`:

- `issue` and `pr`: the issue, and the reference PR.
- `base_sha`: the commit the replay starts from.
- `role`: the role the case mainly tests.
- `stages`: the roles to replay.
- `files`: the files the change may touch.
- `checks`: one shell line that proves the outcome.

The body is a verbatim snapshot of the issue, followed by the expected outcome in plain words. Triage, spec and review produce comments, not code. So their cases carry no checks, and the expected outcome is what a scorer judges the comment against. A review-only case reviews the reference PR's diff, with the issue as its spec. The rules for each field, and why each case was chosen, are in `benchmark/README.md`.

Tested by: TL-14 to TL-16, then every meta-PR (TL-23).

### A replay runs a factory version in its own clone and publishes nothing (TL-15)

`pnpm bench <factory> <git-ref>` (`platform/bench/`) clones this repository into a temporary directory, detaches it at the ref, installs that version's dependencies, and runs that version's own `scripts/run-issue.sh` with `FACTORY=<factory>`. An old ref and a new ref each run their own script, definitions and gates, which is what lets TL-17 bench the layout before and after its move. A ref whose `run-issue.sh` has no replay mode is refused: it would fetch the live issue and publish a PR. The clone's `.runlog` is a link to this checkout's, so run directories and SQLite rows outlive the clone. That is why `.gitignore` says `.runlog` without a trailing slash: a link is not a directory, and an untracked one would mark the clone dirty and change `factory_sha`.

The replay is a mode of `run-issue.sh`, not a second script, so a replay runs the production code path up to the point where it would publish. With `REPLAY` set to a JSON file the harness writes, the script clones the local repository at the case's `base_sha` instead of GitHub's default branch, takes the issue from the case's snapshot and the comments from the file, and stops before every GitHub write: implement prints the path of its `changes.patch` instead of pushing and opening a PR, and review prints the path of its `review.md` instead of commenting. Triage and spec never wrote to GitHub; the workflow posts their output. The harness chains a case's `stages` as the queue would, through local files instead of GitHub: the triage note and the spec become comments for the next stage, and the implement run's patch, committed onto the base, is the PR the reviewer reviews. A stage that does not end `done` ends its case. A review with no implement stage before it reviews the case's merged PR instead: `base_sha` to the PR's head, the second parent of its merge commit, found in the local repository. With no spec stage before it, the issue is its spec. That lets a case score the reviewer against known defects in a diff that really merged, which a freshly implemented diff does not have.

The row is written by the script, as for every run, with `benchmark` true (`runlog.ts start ... benchmark`). The dashboard already reads only `benchmark = false`. No migration: the column has existed since TL-11.

Spending: each run is still capped by its role's `budget_usd`. `--max-usd` (default 10) stops starting runs once the runs so far cost that much, so a benchmark overshoots it by at most one run's budget. `--case` runs one case.

Not yet: scorers (TL-16) and the cases themselves (TL-14). Cases replay against this repository only, since the clone source is the local repository. A run is sequential and takes as long as its agents; parallel replays would need one clone per case, which the design allows.

Tested by: TL-15 (`docs/notes/15-replay-harness.md`).

### Factories are directories (TL-17)

Following Warp's layout: a resource's name is its path, exactly one agent per factory is the foreman, skills at the factory root apply to every agent and skills under an agent apply to that agent only. Creating a factory is copying a directory; splitting one is moving agent folders. A validator (TL-20) runs in CI. Every file and field is in `factories/README.md`.

`factories/<name>/factory.yaml` names the repositories the factory serves and its foreman. Each `triggers/<trigger>/trigger.yaml` names a label, the agent it starts and the label its success moves to, with the label's colour and description; `comment.md` beside it is the success comment. `platform/factory/factory.ts` reads them. The queue (`platform/queue/`) keeps only the states every factory shares (`in-progress`, `in-review`, `needs-human`, `done`). So TL-7's `STAGES`, the label list the workflow copied from it, and the workflow's per-role `case` that worded each comment are now data under `factories/`. The platform's wording for a question, a failure and an incomplete description is `report` in `queue.ts`, tested.

- **The foreman, while the queue dispatches.** No agent dispatches another yet: the queue does, by label. So the foreman is the agent of the entry trigger, the one trigger no other trigger's `next` leads to: triage, which decides whether an issue goes on at all. The reader checks that `foreman` names that agent, so the field cannot drift from the chain. When an agent dispatches the others, the field already says which.
- **Every chain ends with a human.** TL-7 had this from the type of `STAGES`. Now the reader checks it: each `next` is another trigger's label or `factory:in-review`, and following `next` never loops.
- **The workflow routes before it runs.** A GitHub Actions `if` cannot read a file, so the `run` job can no longer list its labels. A `route` job, with no environment and no concurrency group, fires on any `factory:*` label, runs `queue route`, and the `run` job runs only when it found a trigger. Filtering inside the `run` job was rejected: the App's own `in-progress` and `needs-human` labels would then queue in the issue's concurrency group, where GitHub keeps only the newest waiting run, and each would create a deployment of the `factory` environment. The cost is a short runner job, about half a minute of install, for each of those labels (TL-7 had avoided it by copying the list).
- **The repository picks the factory.** `queue route` takes the factory whose `repositories` lists the issue's repository and has a trigger on the label, and refuses two. Nothing in the workflow names `code`. `run-issue.sh` is given `FACTORY` but still sets it to `code` until TL-15 makes it selectable.
- **Fewer fields than first sketched.** No `name`, because the folder is the name and the run log records it. No `defaults` (model, harness), because every `agent.md` must set its model and there is one harness; a field nothing reads would only drift. `trigger.yaml` gained `color` and `description`, because `queue setup` creates the trigger labels and their GitHub descriptions should not change.
- **A subset of YAML, read without a dependency.** `key: value` lines, quoted values and `[a, b]` lists are all the files need, the same shape `agent.md` already uses, and a 20-line reader keeps each error message naming the file. A YAML 1.2 parser reads them the same, so TL-20 can use one.

Not yet: `run-issue.sh` still branches on the four role names for what each is given and how its answer is published (TL-18), and its usage still lists them. Triggers other than a label (a schedule, a PR opened) are an `on` value nothing accepts yet.

Tested by: `platform/factory/factory.test.ts` and `platform/queue/queue.test.ts`; the benchmark comparison of the refs before and after (`docs/notes/17-factory-directory.md`) once TL-15's replay harness exists. TL-19 makes a second factory by copying.

### The meta-factory edits only definitions (TL-22)

The meta-agent reads the run log, picks the worst metric and opens a PR against `factories/`. Branch rules and the validator stop it touching `platform/`. The benchmark gate (TL-23) must pass before a human sees the PR.

Tested by: TL-22, TL-23.

### Throughline keeps the roadmap (TL-1 to TL-3)

`docs/roadmap.ts` is the source of truth. It renders `docs/PLAN.md`, seeds the Throughline `factory` project, and creates the tickets. PRs say `Implements TL-n`; Throughline reconciles them on merge.

Agents reach Throughline through its MCP server (TL-3), registered in `.mcp.json`: `get_requirement` reads the requirement being implemented and `propose_link` proposes the PR's link to it. The server lives in Throughline (`/api/mcp`), not in `platform/`, because it is a way into Throughline's graph and must go through Throughline's own proposal code; a copy here would have to write to its database directly. It authenticates with a bearer token plus the Vercel protection bypass, and has no tool that approves anything: an agent's link is a pending proposal labelled "Proposed by an agent" until the owner approves it. The bypass secret is the weak point. Throughline has no sign-in of its own, so the secret opens the whole instance, and an agent holding it could approve proposals on the review page. For now only interactive sessions the owner watches get it; they already hold the owner's GitHub login, which can merge, so it gives them nothing new. An unattended agent gets a way in that carries only the MCP token: the MCP gateway (`platform/mcp-gateway/`, #35), a separate Vercel project with protection off and one function. It forwards POSTs to Throughline's `/api/mcp` and adds the bypass secret server-side, so its caller holds nothing that opens the review page. It has no other route to expose, so it fails closed. It cannot run on the runner, where the agent has a shell. The `throughline` skill in `.claude/skills/` tells an agent when to call each tool.

Tested by: TL-3, and the gateway by #35 (`docs/notes/03-mcp-gateway.md`): a headless `claude -p` holding only the gateway's address and the MCP token called both tools. Unattended runs (TL-4) load no `.mcp.json`; passing the gateway config with `--mcp-config` gives them the tools. Which runs get it belongs to their agent definition; TL-7's definitions do not have an MCP setting yet.

## Non-goals

- Not a general agent framework. It runs Claude Code and, later, whatever harness a factory file names.
- Not a tracker. Linear or GitHub issues hold tickets; Throughline holds the roadmap; this repository holds the factory.
- No user accounts. One owner, protected by GitHub permissions and Vercel authentication on the dashboard.
