# Run log

One row per agent run, in a table called `runs`. The schema is [`migrations/001_runs.sql`](migrations/001_runs.sql), and the same file runs on SQLite (locally, `.runlog/runlog.db`) and on Neon Postgres (in the cloud), so the two cannot drift.

```sh
pnpm runlog:migrate   # SQLite in .runlog/, or Postgres when DATABASE_URL is set (.env.local is read if present)
pnpm test             # applies the migration to a throwaway SQLite file and exercises the table
```

A migration runs once: applied versions are recorded in `schema_migrations`. To change the schema, add `002_<name>.sql`; never edit a file that has been applied.

## Lifecycle of a row

The writer (TL-12) inserts the row when the run starts, with `status = 'running'` and the identity columns. When the run ends it sets the outcome, the measurements and `ended_at` in one update. `rework` is filled in later still, when the PR merges. A row still `running` long after its start is a run that died without reporting: the evidence TL-12's "finished row or failure row" check looks for.

## Reconstructing a run

The row says what ran (`factory` and `role` at `factory_sha`, on `model`), on what (`repo`, `issue`), what it produced (`pr` at `head_sha`), how it ended, and what it cost. The linked PR supplies the rest: the diff at `head_sha`, the check runs on that commit, the review comments, and the commits a human added before merge. Nothing needed to explain a run lives only in a log file.

## Columns

| Column | Type | Null while running | Meaning |
| --- | --- | --- | --- |
| `id` | text | no | A UUID the writer generates. Text rather than an auto-increment so the same id works in SQLite and Postgres, and rows from a local run and a cloud run never collide. |
| `factory` | text | no | The factory directory name under `factories/`, such as `code`. |
| `role` | text | no | The agent role within the factory, the folder name under `agents/`, such as `triage` or `implementer`. |
| `factory_sha` | text | no | The commit of this repository whose factory definition ran. Without it a row cannot say which prompt, model setting and gates produced the result, and two benchmark runs of different definitions would look identical. |
| `model` | text | no | The model ID the harness ran, such as `claude-opus-5-5`. Recorded per run because the agent file can change between runs. |
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
| `rework` | boolean | yes | Set on a PR's runs when the PR merges: true if a human changed it between hand-off (`head_sha` of the last factory run) and merge, false if it merged as handed off. Null until then, and for runs with no PR. |

## Dialect differences

The SQL is the same; what comes back is not quite. SQLite returns booleans as `1`/`0` and `cost_usd` as a float; the Postgres driver returns `true`/`false` and `cost_usd` as a string such as `"4.271350"`. SQLite also does not enforce column types (the table is not `STRICT`, because `STRICT` only accepts SQLite's own type names). Readers and writers convert at the boundary.
