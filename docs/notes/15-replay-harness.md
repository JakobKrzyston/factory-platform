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

**Stages hand work on through files.** The harness feeds the triage note and the spec to the next stage as comments, with the bodies the workflow would post. The implement run's patch is committed onto the base and becomes the PR the reviewer reviews. A stage that does not end `done` ends its case. TL-14 owns the case format. Its cases put the title alone on the snapshot's first line and fence the body, which `cases.ts` unwraps. Two of them (#4 and #5) are review-only: they score the reviewer on defects known to be in the diffs of PRs #29 and #40 as merged, which a freshly implemented diff would not have. A review with no implement stage before it therefore reviews the case's `pr`, from `base_sha` to the PR's head, the second parent of its local merge commit. With no spec stage before it, it takes the issue as its spec. A review with neither an implement stage nor a `pr` is refused.

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

**TL-14's review-only case 4** (PR #29, TL-4's `run-issue.sh`), through the harness at `3372816`:

```
case                role    outcome  checks  cost   wall time
4-run-issue-review  review  done     -       $0.07  28s
total                                        $0.07  28s
```

The reviewer saw the issue as its spec and PR #29's diff as merged, 4 files, and posted nothing. It raised 5 findings. Of the three defects the case says are still in that diff, it caught one, the clone that is never removed, and called it a nit. It missed the two that matter most: the pushed branch runs the target's CI with its secrets (#33), and the time limit leaves child processes running (#34). It also flagged host-side git running on a clone whose `.git` the agent might write, which TL-6 later hardened. Scoring that properly is TL-16's job. One run says only that the harness can now measure it.

Real spend for this PR: $0.42 over six agent runs, all on the local SQLite run log. No cloud rows were written.

## The full benchmark run

**Expected.** `pnpm bench code <ref>` replays all 11 of TL-14's cases (2 implement, 3 spec, 4 triage, 2 review) and prints one row per stage. Every implement stage should pass the gate. That needs #69 (`tl/64-gate-local-binding`), which sets `network.allowLocalBinding` in the gate's sandbox, so the ref is that branch and not `main`. The owner approved running agent-written checks locally with that setting.

**Happened.** `pnpm bench code tl/64-gate-local-binding --max-usd 6`, at `5477cf4`, on this Mac, from a checkout of `main` at `130435a` (the cases come from the checkout, the factory from the ref):

```
case                     role       outcome      checks  cost   wall time
11-run-log-schema        spec       done         -       $0.07  25s
32-webhook-health-check  triage     needs_human  -       $0.00  18s
33-branch-ci-secrets     triage     needs_human  -       $0.00  11s
34-process-group-clone   spec       done         -       $0.07  33s
35-token-only-mcp        triage     needs_human  -       $0.00  15s
4-run-issue-review       review     done         -       $0.06  15s
41-tsx-gate-sandbox      spec       done         -       $0.06  30s
5-quality-gates-review   review     done         -       $0.08  16s
52-stage-labels-test     triage     done         -       $0.00  10s
52-stage-labels-test     spec       done         -       $0.03  12s
52-stage-labels-test     implement  done         passed  $0.10  37s
52-stage-labels-test     review     done         -       $0.04  17s
55-chain-ends-in-review  triage     done         -       $0.00  16s
60-merge-gate-lint       triage     done         -       $0.00  17s
60-merge-gate-lint       spec       done         -       $0.03  14s
60-merge-gate-lint       implement  done         passed  $0.05  25s
60-merge-gate-lint       review     done         -       $0.03  10s
total                                                    $0.65  321s
```

All 17 stages ran and none was skipped. Both implement cases now go triage → spec → implement → review on real agents, and both implement runs passed the gate. The bench took 5 min 27 s end to end, including the clone and `pnpm install`. The run log has 17 rows, all with `benchmark` true and `factory_sha` `5477cf4`. Triage ran on Haiku, the rest on Sonnet.

**What the numbers said.** The whole benchmark costs $0.647, so it is cheap enough to run on every factory change, as TL-14 asked. Triage costs under a cent a case. The three triage cases whose right answer is a question (32, 33, 35) asked one, and the two that should pass the issue on (52, 60) did. Case 55's triage passed the issue on with a note that names the existing chain test, which its expected outcome counts as a pass. The reviews raised 3 findings on case 4, 2 on case 5, 1 on 52 and 0 on 60. Whether those are the right findings, and whether each implement patch passes its case's `checks`, is TL-16's to score: the `checks` column is implement's gate, not the case's `checks` line. One run says nothing about spread. TL-17's comparison (`docs/notes/17-factory-directory.md`) runs the set four more times.

DATABASE_URL was unset, so the rows went to the local SQLite run log, `.runlog/runlog.db`. No cloud rows were written.

## Not yet

- **A bench of `main` as it is now.** #69 merged as `cdc2e1b` after this run, so `main` now passes the gate on macOS. `main` also has #68, which gives implement a Write tool. The run above does not include #68, so it is not yet a baseline for `main`.
- **Scoring**: the table reports outcomes, not whether they were right. That is TL-16.
- **Postgres**: replay rows go through the same `startRun` as production rows. A benchmark row has not yet been written to Neon.
- Cases replay against this repository only, one at a time.
