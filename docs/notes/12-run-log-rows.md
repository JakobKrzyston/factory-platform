# 12: Every agent run writes its log row (TL-12)

## Expected

TL-11's `runs` table gets its first writer. A row is inserted when a run starts and ended when it stops, with tokens and cost from Claude Code's own output, and `rework` set when the PR merges. Each acceptance criterion maps to a mechanism:

| Acceptance | Mechanism |
| --- | --- |
| 100% of runs started by the workflow have a finished row or a failure row | `run-issue.sh` inserts the row before anything that can fail, and ends it from an `EXIT` trap on every exit. The workflow's last step ends any row still `running` as `failed`, for a script killed before its trap ran. Workflow rows are named `github-<run id>-<attempt>`, so rows and Actions runs join one to one. |
| Cost per run matches the provider's usage report within 5% | `cost_usd` is the result line's `total_cost_usd`. The four token columns sum the result line's `modelUsage` over every model the run called, which are the tokens that cost is for, so the cost can also be recomputed from list prices. |

The plan said "hooks and the workflow write a row". The script writes it instead of a Claude Code hook. Hooks run in the agent's environment, which `run-issue.sh` empties to `PATH` and `HOME` so that no secret can end up in a public PR. A hook that wrote rows would need `DATABASE_URL` there. The script already has everything a row needs, too: the transcript, the gate log and the PR.

## Happened

**The writer is one file**, `platform/runlog/runlog.ts`, with three commands: `start`, `finish` and `rework`. It applies pending migrations before it writes, so a fresh SQLite file or Neon database needs no separate step. `finish` leaves an ended row alone, so the workflow's fallback can run after every run. It refuses an id that has no row, so a missing row turns the step red.

**Two changes outside the writer kept the 100% honest:**

- **The trap keeps the exit status.** The first end-to-end run showed a missing API key exiting 0, which the workflow reads as "PR opened". The trap's last command had replaced the status, and macOS's bash 3.2 also reports 0 to an `EXIT` trap after a failed `${VAR:?}`. The trap now saves `$?` and exits with it, and the key check is an explicit `exit 1`.
- **The artifact carries the SQLite file.** Without `DATABASE_URL`, the workflow's rows would go to a SQLite file on the runner, which the run's artifact now includes.

**Killed runs still count tokens.** A run stopped by the time limit writes no result line, so the writer counts tokens from the transcript's assistant messages instead. Claude Code streams each message once per content block, with the same usage on each, so every message ID is counted once. Its `cost_usd` stays null instead of being estimated.

**Code review changed ten things before merge** (`/code-review high` on #46):

- **The runner is prepared after the claim again.** This branch had moved it first, so that every claimed run reached the script's insert. But a runner that failed setup then left the issue at `factory:ready` with no comment and no new run, and every unclaimed duplicate paid for the installs. A setup failure now ends at `needs-human` with a comment, as before, and has no row (see known gaps).
- **The fallback reads the run's directory.** It ended rows with no measurements, although a killed run's transcript was on disk.
- **Postgres migrations take an advisory lock.** Every `start` migrates, so runs that start together raced. On a local Postgres, 4 concurrent migrations of a fresh database failed 3 of 4 times on each of 5 databases (a duplicate key in `pg_type`). With all migrations in one transaction behind `pg_advisory_xact_lock` there were 0 failures, and 4 concurrent `start`s each wrote their row.
- **The trap is set only after the insert succeeds.** A reused `RUN_LOG_ID` failed the insert, and the trap then ended the other run's row as `failed`. That happened when the old script was run on a copy; the new one leaves the row `running`.
- **`finish` reports only an update that ended the row** (`RETURNING id`), so two finishers cannot both log an ending.
- **A result line without `modelUsage` keeps its cost.**
- **Rework skips a PR whose run recorded no `head_sha`**, instead of always counting it as reworked.
- **`factory_sha` marks a dirty checkout** as `<commit>-dirty-<hash of git diff HEAD>`, so a local run with an edited prompt is not credited to the committed definition. Two different edits got different values.
- **The writer reuses `gh` from `queue.ts`** instead of a fourth copy.

**Rework** is recorded by the `done` job when the issue closes. For each merged PR of the issue's runs, it is true if the PR's head at merge differs from the `head_sha` the last run handed off. `run.json` now records that `head_sha`.

**The cloud run log is isolated from Throughline.** The Neon project's `main` branch is Throughline's production database. The run log is a separate `runlog` database there, owned by a `runlog_writer` role created in SQL. Roles created in the console join `neon_superuser`, which can read every database. As `runlog_writer`, reading Throughline's `proposals` and `requirements` and creating a table in `neondb` were each denied. Its connection string is the `factory` environment's `DATABASE_URL` secret. The setup is in `platform/runlog/README.md`.

Checked before merge:

- **7 new unit tests** (`pnpm test`, 34 in all):
  - Measurements from a result line, shaped like a real one from Claude Code 2.1.322 (captured with a one-word `claude -p` run).
  - A killed run's transcript with a repeated message and a truncated last line.
  - Start then finish with a run directory.
  - The fallback on an ended row and on a missing one.
  - Rework for an unchanged, a changed and an unmerged PR, and one with no `head_sha`.
  - A result line without `modelUsage`, and a finish that loses a race to another. These two and the `head_sha` case failed before the review fixes.
- **`run-issue.sh` end to end**, with stub `claude` and `gh` and a local origin repository (no GitHub writes):

  | Path | Exit | Row |
  | --- | --- | --- |
  | Opened a PR | 0 | `done`, `pr` and `head_sha` match the pushed branch |
  | Asked a question | 3 | `needs_human` |
  | Agent crashed | 1 | `failed`, tokens counted, cost null |
  | No API key | 1 | `failed`, the requested model |
  | Run log unreachable | 1 | none; the agent never started |

  Each row carried the 40-character `factory_sha` and the resolved model ID.
- **Postgres**, on a throwaway Neon branch (`tl-12-runlog-check`, deleted afterwards):
  - `start`, `finish`, the fallback and `rework` behaved as on SQLite.
  - The check constraint rejected a finished row with no end time.
  - The driver returned `cost_usd` as `"4.271350"` and booleans as `true` and `false`, as README.md says.
- **After the review fixes**, on a copy of the repository with SQLite and on a local Postgres: a clean and a dirty `factory_sha`, a reused `RUN_LOG_ID`, the fallback's `.runlog/runs/*/` with a killed run's transcript and with no run directory, concurrent migrations, and a repeated `finish`.
- **Not checked before merge:** the workflow on a real runner (the step conditions, the fallback step, the `done` job's PR read) and both acceptance criteria. They need live runs.

Known gaps:

- **Cost of a killed run.** Its cost is unknown, so it cannot match the provider's.
- **A failed final write.** If the trap's write fails on a run that opened a PR, the workflow's fallback then ends that row as `failed`, though with its PR and measurements.
- **A runner that cannot be set up.** The issue was claimed, but the agent never starts, so there is no row. The issue gets a `needs-human` comment and the Actions run is red. Rows are counted against Actions runs that reached the agent step.
- **The "Update branch" button.** Clicking it on a factory PR counts as rework, although nobody changed the work.

## What the numbers said

| Measure | Value |
| --- | --- |
| Writer | 1 file, 3 commands, no new dependency |
| Tests | 7 new; 34 pass |
| End-to-end paths through `run-issue.sh` | 6 checked: 4 rows written, 1 refused before the agent, fallback no-op on an ended row |
| Bugs found by the end-to-end run | 1: a missing key exited 0, which the workflow would have reported as a PR |
| Code review findings | 10, all fixed |
| Concurrent migrations of a fresh Postgres database that failed | 15 of 20 before the lock, 0 of 20 after |
| First `start` on a fresh Neon database | 1.3 s, including the migration |
| Writer role's attempts on Throughline's database | 3 of 3 denied |
| Model cost of this stage | Not measured: this stage was built in an interactive session, not by the factory |

Pending the first live runs: the share of workflow runs with an ended row (target 100%), and `cost_usd` against the Anthropic Console's cost for the same runs (target within 5%).
