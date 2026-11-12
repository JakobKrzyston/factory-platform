# Replay harness

Replays the benchmark through one version of a factory (TL-15). Why it works this way is in `docs/ARCHITECTURE.md`, under TL-15.

```sh
pnpm bench <factory> <git-ref>                # every case under benchmark/
pnpm bench code main --case 52                # one case: its directory name or issue number
pnpm bench code my-branch --max-usd 3         # stop starting runs once $3 is spent (default $10)
```

Needs what `scripts/run-issue.sh` needs (`claude`, `git`, `jq`, `perl`, `ANTHROPIC_API_KEY`) and `pnpm`, but not `gh`: a replay never calls GitHub. Rows go to the run log as usual, to `.runlog/runlog.db` or to Postgres when `DATABASE_URL` is set, with `benchmark` true. Run directories go to `.runlog/runs/`. The version under test is cloned to `.runlog/bench-*/` and removed at the end; an interrupted bench leaves it there to delete. Run it from a checkout under your home directory, which the agents' sandbox denies: that clone holds the cases' expected outcomes.

```
case                  role       outcome      checks  cost   wall time
52-stage-labels-test  spec       done         -       $0.03  12s
52-stage-labels-test  implement  needs_human  failed  $0.10  41s
total                                                 $0.13  53s
```

`outcome` is the row's `status`: `done`, `needs_human` (a question, or an incomplete PR description), `failed`, or `skipped` when `--max-usd` was reached. `checks` is `checks_passed`: implement's gate. A stage that does not end `done` ends its case, so later stages do not appear. Above, the implement agent asked a question because the gate's sandbox on macOS could not yet run this repository's MCP gateway tests (`docs/notes/15-replay-harness.md`, fixed by #64).

## What a case gives the harness

From `benchmark/<id>/case.md` (`cases.ts`), it reads `issue`, `pr`, `base_sha`, `role`, `stages` and the `## Issue` snapshot. The snapshot's first line, without leading `#`s, is the issue's title. The rest is its body, unwrapped from the code fence TL-14 puts around it, and the section runs to `## Expected outcome`, so the issue's own headings stay in it. `files`, `checks` and the expected outcome are for the scorers (TL-16).

A review reviews the patch the replay's implement stage made. With no implement stage before it, it reviews the case's merged `pr` from `base_sha` to the PR's head, found from the merge commit in the local repository. It takes the spec its spec stage wrote, or, with no spec stage, the issue. A review with neither an implement stage nor a `pr` is refused.
