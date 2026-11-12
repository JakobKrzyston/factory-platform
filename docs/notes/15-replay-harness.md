# 15: Replay harness (TL-15)

## Expected

A command that replays the benchmark through a named factory version, writes benchmark rows to the run log, and publishes nothing. Each acceptance criterion maps to a mechanism:

| Acceptance | Mechanism |
| --- | --- |
| `pnpm bench <factory> <git-ref>` runs every benchmark issue and prints a summary table | `platform/bench/bench.ts` clones this repository at the ref and runs that version's own `scripts/run-issue.sh` on each case's `stages`, handing each stage's output to the next. It prints case, role, outcome, checks, cost and wall time, read back from each run's row. |
| Benchmark runs are excluded from production metrics by a flag | Replay rows are written with `benchmark` true (`runlog.ts start ... benchmark`). The dashboard has read only `benchmark = false` since TL-13. |

The brief added two more: no GitHub writes during a replay, covered by a test, and a spending cap with a way to run one case.

## Happened

**The replay is a mode of `run-issue.sh`, not a copy of it.** With `REPLAY` set to a JSON file, the script fetches the clone from the local repository at the case's `base_sha`. It takes the issue and comments from the file, and stops just before each GitHub write. Implement prints the path of its `changes.patch` instead of pushing and opening a PR, and review prints the path of its `review.md` instead of commenting. Everything up to that point, including the confinement, the gates and the run log row, is the production code path. The diff to the script is about 60 lines, most of it `if [[ -n $REPLAY ]]` around the five GitHub calls. `FACTORY` is now an environment variable defaulting to `code`, for TL-17.

**A ref runs its own script.** The harness clones the ref, installs its dependencies, and links the clone's `.runlog` to this checkout's, so rows and run directories outlive the clone. A ref whose `run-issue.sh` has no replay mode is refused, because it would fetch the live issue and publish. That is every ref before this PR, `main` included until it merges (checked: `pnpm bench code main` refuses). `.gitignore` now says `.runlog` with no trailing slash. Otherwise the link would be an untracked file, the clone would count as dirty, and `factory_sha` would get a `-dirty` suffix. The rows below carry the plain commit.

**Self-review found that the first version leaked the answer.** It cloned the whole local repository, so the agent's clone held every later commit, including the PR that closed the issue: `git show origin/main:<file>` would have given it the solution. The clone now fetches only `base_sha` and its history. The test plants a later commit and checks that `git log --all` in the agent's clone shows only the base. The harness's own clone of the ref holds `benchmark/`, with every expected outcome, and all history. It started out in `$TMPDIR`, which the agent's sandbox can read. It now goes under this checkout's `.runlog/`, inside the home directory the sandbox denies, and the harness refuses to run from a checkout outside the home directory.

**Stages hand work on through files.** The harness feeds the triage note and the spec to the next stage as comments, with the bodies the workflow would post. The implement run's patch is committed onto the base and becomes the PR the reviewer reviews. A stage that does not end `done` ends its case. A review stage therefore needs spec and implement stages before it, and `cases.ts` refuses a case without them. TL-14 owns the case format; the manager has the two rules this adds (the first snapshot line is the title, and review needs spec and implement before it).

**Spending.** Each run keeps its role's `budget_usd`. `--max-usd` (default 10) stops starting runs once the benchmark has spent that much, so the most it can overshoot is one run's budget, at most $5 for implement today. `--case` takes a directory name or an issue number.

**The test.** `platform/bench/bench.test.ts` runs the real `run-issue.sh` in replay mode for implement and then review. It uses a copy of this checkout, a two-commit target repository, a fake `claude`, a `gh` that fails and logs every call, and a `git` that logs every call. It asserts no `gh` call at all, no `git push`, no later commit in the agent's clone, two rows with `benchmark` set, and that the dashboard's `readRuns` returns none of them. Run against `main`'s `run-issue.sh` and `runlog.ts`, it fails (checked). It skips inside the gate, because the script starts tsx's CLI, whose socket the sandbox denies. Also tested: parsing a fixture case in the brief's format and refusing bad ones, and the summary table.

## What the numbers said

One real case, made by hand from issue #52 (PR #53, base `e69b9b5`; TL-14's cases had not merged), with stages spec, implement, review, run on Sonnet:

```
case                  role       outcome      checks  cost   wall time
52-stage-labels-test  spec       done         -       $0.03  12s
52-stage-labels-test  implement  needs_human  failed  $0.10  41s
total                                                 $0.13  53s
```

That is the run at `2004fde`. A first run at `33df4cb`, before the history fix, came out the same: $0.04 and $0.13, $0.18 in all.

**The first real replay found a real problem: implement cannot pass the gate on macOS.** At the base, and on `main` today, `platform/mcp-gateway/gateway.test.ts` binds `127.0.0.1`. The gate's sandbox on macOS refuses that (`listen EPERM`), so `pnpm test` exits 1 even though no test fails. Both implement runs got the new test passing, saw the cancelled gateway tests, correctly did not touch files the issue ruled out, and asked whether the gate should allow local binding. The production run behind PR #53 passed on an Actions runner, where bubblewrap gives the checks a network namespace with its own loopback. So a local benchmark of this repository's implement cases cannot pass until the gate allows local binding or those tests skip in the sandbox. That is a ticket, not this PR.

**The review replay, run directly** (`REPLAY=... scripts/run-issue.sh review`, with that spec and PR #53's real diff as the patch), ended `done` in 12 s for $0.04. It raised two findings, both `[no rule]` nits the spec had asked for, and posted nothing. Its row has `review_findings` 2 and `benchmark` true.

Real spend for this PR: $0.35 over five agent runs, all on the local SQLite run log. No cloud rows were written.

## Not yet

- **The full benchmark run** waits for TL-14's cases. Until it runs, TL-15 stays `in_progress` in the roadmap.
- **A full spec → implement → review chain on real agents**: implement stops at the gate on macOS (above). The review hand-off is covered by the test, with a fake agent, and by the direct review replay.
- **Postgres**: replay rows go through the same `startRun` as production rows. A benchmark row has not yet been written to Neon.
- Cases replay against this repository only, one at a time.
