# Replay harness

Replays the benchmark through one version of a factory (TL-15) and scores every result (TL-16). Why it works this way is in `docs/ARCHITECTURE.md`, under TL-15 and TL-16.

```sh
pnpm bench <factory> <git-ref>                # every case under benchmark/
pnpm bench code main --case 52                # one case: its directory name or issue number
pnpm bench code my-branch --max-usd 3         # stop starting runs once $3 is spent (default $10)
```

Needs what `scripts/run-issue.sh` needs (`claude`, `git`, `jq`, `perl`, `ANTHROPIC_API_KEY`) and `pnpm`, but not `gh`: a replay never calls GitHub. Rows go to the run log as usual, to `.runlog/runlog.db` or to Postgres when `DATABASE_URL` is set, with `benchmark` true. Run directories go to `.runlog/runs/`. The version under test is cloned to `.runlog/bench-*/` and removed at the end; an interrupted bench leaves it there to delete. Run it from a checkout under your home directory, which the agents' sandbox denies: that clone holds the cases' expected outcomes.

```
case                     role       outcome      checks  cost   wall time  scores
61-plan-matches-roadmap  triage     done         -       $0.01  17s        cost 0.005
61-plan-matches-roadmap  spec       done         -       $0.03  13s        cost 0.035
61-plan-matches-roadmap  implement  done         passed  $0.05  21s        cost 0.047, scope 0, tests 1
61-plan-matches-roadmap  review     done         -       $0.03  9s         cost 0.025, findings 0
total                                                    $0.11  60s
```

`outcome` is the row's `status`: `done`, `needs_human` (a question, or an incomplete PR description), `failed`, or `skipped` when `--max-usd` was reached. `checks` is `checks_passed`: implement's gate. A stage that does not end `done` ends its case, so later stages do not appear. `scores` lists each scorer that applied, as `<scorer> <score>`; the reasons are in the run log and on the dashboard. Above, the patch passed the case's checks but put its test in a file the reference PR did not touch (`docs/notes/16-scorers.md`).

## What a case gives the harness

From `benchmark/<id>/case.md` (`cases.ts`), it reads `issue`, `pr`, `base_sha`, `role`, `stages` and the `## Issue` snapshot. The snapshot's first line, without leading `#`s, is the issue's title. The rest is its body, unwrapped from the code fence TL-14 puts around it, and the section runs to `## Expected outcome`, so the issue's own headings stay in it. `files` and `checks` are for the scorers (TL-16). The expected outcome is for a person: no scorer reads it yet.

## Scoring

After each stage, while its row is fresh, the harness runs every scorer under this checkout's `factories/<factory>/scorers/` on the result, and stores each score that applies in the run log's `scores` table (`platform/scorers/`). The scorers come from the checkout, not from the ref under test, as the cases do, so an old ref and a new one are graded by the same scorers. A stage with no row, which the script stopped before inserting, or one skipped by `--max-usd`, is not scored.

The `tests` scorer runs the case's `checks` line on the base with the patch implement handed off. It does that in a fresh clone in the system's temporary directory, with the base's dependencies installed before the patch is applied, inside the gate's sandbox, with only `PATH` and `HOME` in its environment. Inside the sandbox `pnpm` is a shell function: `pnpm <script>` runs the base's `package.json` script and `pnpm exec <bin>` runs `node_modules/.bin/<bin>`. pnpm itself is under the home directory the sandbox denies, and the patched `package.json` is agent-written. On this repository that adds two to four seconds per implement stage.

A review reviews the patch the replay's implement stage made. With no implement stage before it, it reviews the case's merged `pr` from `base_sha` to the PR's head, found from the merge commit in the local repository. It takes the spec its spec stage wrote, or, with no spec stage, the issue. A review with neither an implement stage nor a `pr` is refused.
