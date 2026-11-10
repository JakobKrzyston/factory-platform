# 03: The run log has a schema (TL-11)

## Expected

A `runs` table with the twelve columns `docs/ARCHITECTURE.md` already named, a migration that creates it in SQLite locally and in Neon Postgres in the cloud, and a page describing each column. Schema only: writing rows is TL-12, reading them is TL-13.

## Happened

**One SQL file for both databases.** The plan said "same schema"; the simplest way to make that true is for both databases to run the same file. SQLite accepts Postgres type names (`TIMESTAMPTZ`, `BOOLEAN`, `NUMERIC(10, 6)`) and maps them to its own affinities, so `001_runs.sql` runs unchanged on both. The cost is that SQLite does not enforce those types, and the two drivers return booleans and decimals differently; `platform/runlog/README.md` records both.

**Twelve columns became twenty-two.** The acceptance criterion "a run can be reconstructed from its row and the linked PR" is what added them. The original list says what a run cost, but not which run it was or what it produced:

- `id`, `status`, `started_at`, `ended_at`: a row is written at start and finished at end, so it needs an identity and a state. A check constraint ties `status = 'running'` to `ended_at IS NULL`, so a row cannot claim to be finished without an end time.
- `factory_sha`: which version of the factory definition ran. Without it, two benchmark runs of different prompts are indistinguishable, which would defeat TL-15 and the meta-factory.
- `repo`, `pr`, `head_sha`: what the run produced, pinned to a commit. `head_sha` is also what `rework` needs: TL-12 compares the merged PR with the commit the factory handed off.
- `cache_read_tokens`, `cache_write_tokens`: an agent run reads almost all of its context from the prompt cache, so `input_tokens` alone is a small fraction of the real input, and TL-12's "cost within 5% of the provider" cannot be checked without the cached counts.

**The migration runner is small.** Numbered `.sql` files, a `schema_migrations` table, one transaction per file. SQLite through Node's built-in `node:sqlite`; Postgres through `postgres` (one dependency, no transitive ones). `pnpm runlog:migrate` picks Postgres when `DATABASE_URL` is set, as `.env.example` already promised.

**Two pieces of setup.** pnpm 12 refused to finish installing until esbuild's install script was approved (`pnpm-workspace.yaml`, its own commit). `tsconfig.json` already asked for Node's types but `@types/node` was not installed, so nothing type-checked against Node until now. The package is now `"type": "module"` so the migration script can use top-level `await`; the existing scripts were already ES modules in all but name.

**Verified on Neon.** On a branch of the `factory-platform` project (`tl-11-schema-check`), the same migration applied, a second run was a no-op, a full row inserted and updated, and the same two bad updates the SQLite test rejects (a finished status with no end time, an unknown status) were rejected by the same constraints.

## What the numbers said

| Measure | Value |
| --- | --- |
| Columns planned / shipped | 12 / 22 |
| Schema files | 1, used unchanged by both databases |
| SQLite migration, fresh file | 0.15 s, 20 KB database |
| Neon migration, apply then no-op | 1.96 s for both runs, including connection set-up |
| Tests | 3, against a throwaway SQLite file: applies once, start-then-finish row, constraints reject bad rows |
| Bad updates rejected | SQLite 3 of 3, Neon 2 of 2, by the same constraints |
| Dependencies added | `postgres` (runtime), `@types/node` (dev) |
| Model cost of this stage | Not measured: nothing writes the run log until TL-12 |

The number to watch is the first row. Ten of the twenty-two columns exist because of one acceptance sentence; every one of them is something the dashboard or the meta-factory would otherwise have had to guess.
