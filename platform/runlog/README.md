# Run log

One row per agent run, in a table called `runs`. The schema is [`migrations/001_runs.sql`](migrations/001_runs.sql), and the same file runs on SQLite (locally, `.runlog/runlog.db`) and on Neon Postgres (in the cloud), so the two cannot drift.

```sh
pnpm runlog:migrate   # SQLite in .runlog/, or Postgres when DATABASE_URL is set (.env.local is read if present)
pnpm test             # applies the migration to a throwaway SQLite file and exercises the table and the writer
```

`runlog.ts` writes the rows. `scripts/run-issue.sh` and `.github/workflows/factory.yml` call it; it applies any pending migration before it writes, so a fresh database needs no separate step. Readers such as the dashboard (`platform/dashboard/`) open it read-only, which skips migrations.

```sh
tsx platform/runlog/runlog.ts start <id> <factory> <role> <factory_sha> <model> <owner/repo> <issue>
tsx platform/runlog/runlog.ts finish <id> <done|needs_human|failed> [run-dir]
tsx platform/runlog/runlog.ts rework <owner/repo> <issue>
```

A migration runs once: applied versions are recorded in `schema_migrations`. To change the schema, add `002_<name>.sql`; never edit a file that has been applied. On Postgres, pending migrations apply in one transaction that first takes an advisory lock, because factory runs that start together each migrate: the first applies them, and the others wait and find nothing pending.

## The cloud database

The cloud run log is a database called `runlog` in the Neon project `factory-platform`, on its `main` branch, next to Throughline's own `neondb`. It is owned by `runlog_writer`, a role created in SQL rather than in the Neon console. Console and API roles join `neon_superuser`, which can read every database; this one cannot read or create anything in `neondb`. Its connection string is the `DATABASE_URL` secret of the `factory` GitHub environment. Run as the project's owner role:

```sql
CREATE ROLE runlog_writer LOGIN PASSWORD '<generated>';
GRANT runlog_writer TO CURRENT_USER;  -- CREATE DATABASE ... OWNER needs it
CREATE DATABASE runlog OWNER runlog_writer;
```

Then `DATABASE_URL=postgresql://runlog_writer:<password>@<host>/runlog?sslmode=require pnpm runlog:migrate`.

## Lifecycle of a row

1. **Start.** `run-issue.sh` inserts the row before it does anything that can fail (clone, key file, agent), with `status = 'running'` and the identity columns. `model` is the model the script asked for, such as `sonnet`, until the run ends.
2. **End.** The script's `EXIT` trap ends the row on every exit, in one update: `done` when it opened a PR, `needs_human` when the agent asked a question, `failed` otherwise. The measurements come from the run directory: tokens, cost and the resolved model ID from `transcript.jsonl`; `checks_passed`, `pr` and `head_sha` from `run.json`.
3. **Fallback.** On Actions, the workflow's last step ends the row as `failed` if it is still `running`: the script was killed, cancelled or timed out before its trap ran. It passes the run's directory, so the row still gets the tokens the transcript recorded. `finish` leaves a row that has already ended alone, and reports only an update that ended the row, so this step is safe to run every time.
4. **Rework.** When the issue closes as completed, the workflow's `done` job runs `rework`: for each merged PR of the issue's runs, `rework` is true if the PR's head at merge is not the `head_sha` the last run on it handed off. A PR whose runs recorded no `head_sha` keeps `rework` null, since there is nothing to compare.

A row still `running` long after its start is a run that died without reporting. A workflow run with no row at all is one whose script never got as far as inserting it: the run log was unreachable, or the runner could not be set up after the claim. Either way the agent never started, and the issue moves to `needs-human` with a comment. Joining the two by id (`github-<run id>-<attempt>`) is how TL-12's "every run has a finished row or a failure row" is checked.

Tokens and cost are what Claude Code reports: the result line's `modelUsage`, summed over every model the run called, and its `total_cost_usd`, which is the cost of exactly those tokens. A run killed before its result line has its tokens counted from the transcript's assistant messages, once per message ID, and `cost_usd` null. A result line without `modelUsage` is counted the same way, but keeps its `total_cost_usd`.

## Reconstructing a run

The row says what ran (`factory` and `role` at `factory_sha`, on `model`), on what (`repo`, `issue`), what it produced (`pr` at `head_sha`), how it ended, and what it cost. The linked PR supplies the rest: the diff at `head_sha`, the check runs on that commit, the review comments, and the commits a human added before merge. Nothing needed to explain a run lives only in a log file.

## Columns

| Column | Type | Null while running | Meaning |
| --- | --- | --- | --- |
| `id` | text | no | `github-<run id>-<attempt>` for a run the factory workflow started, so the row joins to its Actions run; otherwise a UUID `run-issue.sh` generates. Text rather than an auto-increment so the same id works in SQLite and Postgres, and rows from a local run and a cloud run never collide. |
| `factory` | text | no | The factory directory name under `factories/`, such as `code`. |
| `role` | text | no | The agent role within the factory, the folder name under `agents/`, such as `triage` or `implementer`. |
| `factory_sha` | text | no | The commit of this repository whose factory definition ran. Without it a row cannot say which prompt, model setting and gates produced the result, and two benchmark runs of different definitions would look identical. A run from a checkout with uncommitted changes gets `<commit>-dirty-<12 hex>`, a hash of `git diff HEAD`, so it never shares the commit's value. Untracked files mark it dirty but are not in the hash. |
| `model` | text | no | The model ID the harness ran, such as `claude-opus-5-5`, from the transcript's first line. Until the run ends, or if it ended before the harness started, the model it asked for, such as `sonnet`. Recorded per run because the agent file can change between runs. |
| `repo` | text | no | `owner/name` of the repository the issue and PR belong to. Makes `issue` and `pr` links rather than bare numbers. |
| `issue` | integer | no | The GitHub issue number the run worked on. |
| `pr` | integer | yes | The pull request number the run opened, pushed to or reviewed. Stays null for runs that never touch a PR, such as triage or a run that failed first. |
| `head_sha` | text | yes | The PR's head commit when the run ended: what an implementer pushed, or what a reviewer reviewed. Pins the run's output exactly, and is what `rework` compares the merged PR against. |
| `benchmark` | boolean | no | True for replay runs (TL-15). Production metrics filter on `benchmark = false`. Defaults to false. |
| `status` | text | no | `running` until the run ends, then `done` (the role finished its work), `needs_human` (it stopped with a question, matching the `factory:needs-human` label) or `failed` (it crashed, timed out or its gates never passed). A check constraint keeps `status = 'running'` exactly when `ended_at` is null. |
| `started_at` | timestamptz | no | When the harness started, in UTC. Writers pass ISO 8601 strings (`Date#toISOString()`), which SQLite stores as sortable text. |
| `ended_at` | timestamptz | yes | When the harness exited, in UTC. |
| `wall_seconds` | integer | yes | Elapsed seconds from start to end. Derivable from the timestamps, but stored so the dashboard does no date arithmetic, which differs between SQLite and Postgres. |
| `input_tokens` | integer | yes | Uncached input tokens, the API's `input_tokens`. |
| `output_tokens` | integer | yes | Output tokens. |
| `cache_read_tokens` | integer | yes | Input tokens read from the prompt cache. Agent runs read most of their context from cache, so `input_tokens` alone understates a run's size by orders of magnitude. |
| `cache_write_tokens` | integer | yes | Input tokens written to the prompt cache. With the three input counts, cost can be recomputed from list prices and checked against `cost_usd` (TL-12 must match the provider within 5%). |
| `cost_usd` | numeric(10,6) | yes | The run's cost in US dollars as the harness reports it. Exact decimal in Postgres; SQLite stores it as a float. |
| `checks_passed` | boolean | yes | True if every gate check passed when the run ended, false if any failed. Null for a role that runs no gates. Which checks ran, and their output, are the check runs on `head_sha`. |
| `review_findings` | integer | yes | For a reviewer run, the number of findings it raised. Null for other roles; an implementer's findings are those of the reviewer runs on the same `pr`. |
| `rework` | boolean | yes | Set on a PR's runs when the PR merges: true if a human changed it between hand-off (`head_sha` of the last factory run) and merge, false if it merged as handed off. Null until then, for runs with no PR, and for runs that recorded no `head_sha`. |

## Dialect differences

The SQL is the same; what comes back is not quite. SQLite returns booleans as `1`/`0` and `cost_usd` as a float; the Postgres driver returns `true`/`false` and `cost_usd` as a string such as `"4.271350"`. SQLite also does not enforce column types (the table is not `STRICT`, because `STRICT` only accepts SQLite's own type names). Readers and writers convert at the boundary.
