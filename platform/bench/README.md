# Replay harness

Replays the benchmark through one version of a factory (TL-15). Why it works this way is in `docs/ARCHITECTURE.md`, under TL-15.

```sh
pnpm bench <factory> <git-ref>                # every case under benchmark/
pnpm bench code main --case 52                # one case: its directory name or issue number
pnpm bench code my-branch --max-usd 3         # stop starting runs once $3 is spent (default $10)
```

Needs what `scripts/run-issue.sh` needs (`claude`, `git`, `jq`, `perl`, `ANTHROPIC_API_KEY`) and `pnpm`, but not `gh`: a replay never calls GitHub. Rows go to the run log as usual, to `.runlog/runlog.db` or to Postgres when `DATABASE_URL` is set, with `benchmark` true. Run directories go to `.runlog/runs/`.

```
case                  role       outcome  checks  cost   wall time
52-stage-labels-test  spec       done     -       $0.21  52s
52-stage-labels-test  implement  done     passed  $1.37  611s
...
total                                             $1.98  801s
```

`outcome` is the row's `status`: `done`, `needs_human` (a question, or an incomplete PR description), `failed`, or `skipped` when `--max-usd` was reached. `checks` is `checks_passed`: implement's gate. A stage that does not end `done` ends its case, so later stages do not appear.

## What a case gives the harness

From `benchmark/<id>/case.md` (`cases.ts`), it reads `issue`, `base_sha`, `role`, `stages` and the `## Issue` snapshot, whose first line, without leading `#`s, is the issue's title and the rest its body. `pr`, `files`, `checks` and `## Expected outcome` are for the scorers (TL-16). A review stage needs spec and implement stages before it: the reviewer reviews the patch the replay's implement stage made, against the spec its spec stage wrote.
