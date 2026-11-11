# Factory Platform

A software factory built in the open, one measured stage at a time.

A software factory takes a labelled issue and returns a reviewed pull request without a person watching: a triage agent sizes the work, a spec agent plans it, an implementer builds it behind type, lint and test gates, and a reviewer with a fresh context checks the diff. This repository is the factory, the platform under it, and the record of what each stage cost and changed.

It is also the factory's own first customer. Every requirement below is a ticket the factory will eventually work, and the roadmap is kept by [Throughline](https://github.com/JakobKrzyston/throughline-roadmap), which reconciles the plan against each merged pull request.

## What is here

```
platform/      shared by every factory: the work queue, run log, gate runner, replay harness, health checks and MCP gateway
factories/     one directory per factory; copy one to create a factory, move folders to split one
  code/        the first factory: agents/, triggers/, scorers/, skills/
benchmark/     past issues with expected outcomes, replayed to judge any factory change
standards/     review comments turned into rules the review agent applies
docs/          roadmap.ts (the source of truth), PLAN.md (rendered from it), ARCHITECTURE.md, notes/
scripts/       run-issue.sh, render-plan.ts and the other one-command entry points
```

Most of these directories are empty on purpose. The plan says what goes in each and in which order.

## Run one issue

```sh
pnpm install                 # the stop hook and its sandbox run from this checkout
cp .env.example .env.local   # set ANTHROPIC_API_KEY
scripts/run-issue.sh <triage|spec|implement|review> https://github.com/<owner>/<repo>/issues/<n>
```

Needs macOS, Node 22, `claude`, `gh` (logged in), `git`, `jq` and `perl`. The role's model, tools, budget and prompt come from `factories/code/agents/<role>/agent.md`. The agent works in a temporary clone with no network and no access outside it. Triage and spec print their note or spec; review posts its findings on the issue's open factory PR, having seen only the spec and the diff. For implement, a stop hook keeps the agent working while the repository's `typecheck`, `lint` or `test` script fails, and the script opens a draft PR only when those checks passed. Every run is recorded in `.runlog/runs/` and as a row in the run log (`.runlog/runlog.db`, or Postgres when `DATABASE_URL` is set). [factory-sample](https://github.com/JakobKrzyston/factory-sample) is the practice repository.

## Queue an issue

Add the `factory:ready` label to an issue in this repository. `.github/workflows/factory.yml` runs the same script on GitHub Actions runners, once per role, and each role that succeeds adds the label that starts the next: `factory:ready` (triage), `factory:spec`, `factory:implement`, `factory:review`, then `in-review` with a draft PR and the reviewer's findings on it. A role that stops with a question moves the issue to `needs-human` with a comment. Answer in a comment and add that role's label again. Setup, once per repository: `pnpm queue setup <owner/repo>` and four secrets, described in [`platform/queue/README.md`](platform/queue/README.md).

## The five parts of a factory

Every factory here, and the ones at Warp and in Matt Pocock's course, has the same parts:

| Part    | What it is                                                | Here                                       |
| ------- | --------------------------------------------------------- | ------------------------------------------ |
| Queue   | Where work waits and where its state lives                | GitHub issue labels (`factory:*`)          |
| Workers | Agents with one role each and their own context           | `factories/<name>/agents/<role>/agent.md`  |
| Gates   | Checks that decide whether work moves forward             | Claude Code hooks running typecheck, lint, tests |
| Log     | What each run cost and produced                           | `platform/runlog` (SQLite locally, Neon in the cloud) |
| Loop    | Something that reads the log and changes the factory      | The meta-factory, gated by the benchmark   |

## Order of work

1. **One run** (TL-4): a script that gives one agent one issue and gets one PR back. The baseline.
2. **Gates** (TL-5): hooks that stop the agent finishing while a check fails.
3. **Queue** (TL-6, TL-10): a GitHub Action fired by a label, with labels as the state machine and a human merge gate.
4. **Roles** (TL-7, TL-8, TL-9): separate triage, spec, implement and review agents; PRs that explain themselves; review comments that become rules.
5. **Log** (TL-11 to TL-13): a row per run and a dashboard of cost, time, gate pass rate and rework.
6. **Benchmark** (TL-14 to TL-16): the factory's own closed issues, replayable against any version, scored automatically.
7. **Extract** (TL-17 to TL-21): the factory becomes a directory; a second factory is a copy; splitting is moving folders.
8. **Meta-factory** (TL-22 to TL-24): an agent that proposes factory changes from the log and must beat the benchmark to merge.

Each stage adds one idea, so the log shows what that idea did on its own. Stages 1 to 4 are roughly what the course teaches; 5 and 6 are Warp's contribution; 7 and 8 are this project's.

Full detail, with acceptance criteria, is in [`docs/PLAN.md`](docs/PLAN.md). The plan is rendered from [`docs/roadmap.ts`](docs/roadmap.ts), which is also what seeds the Throughline roadmap and the issue tracker, so the three never disagree.

## Rules

- **Humans merge.** No factory PR merges without a human approval, whatever the automated review said.
- **Change one thing per stage.** If two ideas land together, the numbers cannot tell them apart.
- **Write the note.** Every stage ends with a short note in `docs/notes/`: what was expected, what happened, what the log showed.
- **Guidance plus gates.** A prompt or skill makes good behaviour likely; a hook or check makes bad output impossible to hand in. Every stage needs both.
- **Factories are data.** Anything under `factories/` is a definition, validated in CI, and is the only thing the meta-factory may edit.

## Credits

The engineering discipline (domain language, specs, gates before accelerators, review as the brakes) follows Matt Pocock's *Software Factories for Real Engineers* and his [skills](https://github.com/mattpocock/skills). The factory-as-files layout and the measurement loop follow Warp's [Factories](https://docs.warp.dev/factories/) and their [examples](https://github.com/warpdotdev/warp-factory-examples). The platform-versus-product split borrows from Legora's primitives approach.

## License

MIT.
