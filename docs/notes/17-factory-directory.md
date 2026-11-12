# 17: Factory definition as a directory (TL-17)

## Expected

The code factory should be fully described by `factories/code/`, with nothing about its roles, labels or chain left in `platform/` or the workflow beyond reading that directory. Behaviour should not change.

| Acceptance | Mechanism |
| --- | --- |
| The first factory is moved into this layout with no behaviour change (benchmark proves it) | `factories/code/factory.yaml` and `triggers/{ready,spec,implement,review}/` replace TL-7's `STAGES`, the label list the workflow copied from it, and the workflow's per-role comment wording. `platform/factory/factory.ts` reads them. Proof: identical comments, labels and calls against `main` (below) now; the benchmark once TL-15 exists. |
| A README documents every file and field | `factories/README.md`, with `factories/code/README.md` for this factory's chain. |

## Happened

**The format.** `factory.yaml` has two fields, `repositories` and `foreman`. Each `trigger.yaml` has `on`, `label`, `agent`, `next`, `color` and `description`, and `comment.md` beside it is the success comment. `implement/question.md` holds the one line implement's questions add. The starting sketch also had `name` and `defaults` (harness, model). Both were dropped: the folder is the name, every `agent.md` already must set its model, and there is one harness. `color` and `description` were added because `queue setup` creates the trigger labels. The reasons are in `docs/ARCHITECTURE.md`.

**The foreman** is the agent of the entry trigger, the one trigger no other leads to, and the reader checks that `foreman` names it. While the queue dispatches by label, that is triage.

**The reader checks what the queue relies on.** Each trigger's agent has an `agent.md`, labels are unique and start with `factory:`, each `next` is another trigger's label or `factory:in-review`, no chain loops, and there is exactly one entry trigger. TL-7 got "the chain ends at `in-review`" from a TypeScript type; it is now a runtime check, with a test for each refusal. Everything else (secrets in files, scorers referenced) is left to TL-20's validator.

**The workflow routes first.** An Actions `if` cannot read a file, so the hardcoded label list became a `route` job. It fires on any `factory:*` label, runs `queue route`, and the `run` job starts only if a trigger matched. The `route` job sits outside the `factory` environment and the per-issue concurrency group. This matters because GitHub keeps only the newest waiting run in a group, so the App's own `in-progress` label could otherwise displace a queued stage. The 40-line per-role `case` in the run step became one `queue report` call, which words the comment from the trigger's files and moves the issue.

**`run-issue.sh`** changed only in paths: the shared pr-description skill is read from `factories/$FACTORY/`. TL-15 makes `FACTORY` selectable, so this branch left line 30's `FACTORY=code` alone, and the workflow passes `FACTORY` ready for it. The script still branches on the four role names for inputs and publishing, which is TL-18's to move.

**Checked against `main`, with a fake `gh` that records every call** (scripts in the session's scratch area, not committed):

- **Comments.** The old run step's bash, fed the same `run-issue.sh` output, against `queue report`. The cases were success for all four roles, a question from triage, implement and review, an incomplete description, exit 1 and exit 137. All 10 gave byte-identical comments and the same target label.
- **`claim` and `set`.** Old CLI with state names against new with labels, on a fresh claim, a stale claim, a wrong-stage claim, `set needs-human` with a comment, and `set spec`. The `gh` calls were identical.
- **`setup`.** The same eight labels, colours and descriptions, except one. `factory:in-review`'s description now reads "The factory's last agent has handed its pull request to a human, who reviews and merges it." The old text named the review agent in `platform/`. This is the only visible difference.
- **Tests.** `pnpm typecheck`, `lint` and `test` pass (124 tests). A new test fails if `factory.yml` names any trigger's label outside a comment; `main`'s workflow has three such lines.

**Not checked here.** The workflow itself. `issues` events run the workflow file from `main`, so the `route` job and the `needs` wiring first run after merge. The YAML parses, and the jobs are `route`, `run` (needing `route`) and `done`.

## What the numbers said

### The benchmark comparison

**Expected.** Bench `main` just before this branch merged (`e2fdf32`) against its merge (`d844acd`). The ref this branch started from, `5d7abe9`, cannot be the baseline: it predates TL-15, so its `run-issue.sh` has no replay mode and `pnpm bench` refuses it. `e2fdf32` adds TL-15 (#58) and the fixes for #60 and #61, none of which touch the factory's agents or prompts, so the comparison still isolates this change. The expectation is no difference beyond run-to-run noise. The agents, prompts, models and `run-issue.sh` behaviour are unchanged, and the benchmark replays `run-issue.sh`, not the workflow.

**Method: the gate fix as an overlay.** Neither ref has #69, and `pnpm bench` runs each ref's own gate, so on macOS every implement replay would stop at the gate (#64). So each ref was benched with #69's one change on top: two local branches, each the ref plus `network.allowLocalBinding: true` in `platform/gates/checks.ts`, and nothing else. `checks.ts` is identical at `e2fdf32`, `d844acd` and #69's parent, so it is the same hunk on both. `git diff <ref> <branch> --stat` shows only that file. #57 does not touch `platform/gates/`, so the overlay cannot mask its effect. The branches were never pushed and were deleted after the runs. The rows carry their commits as `factory_sha`: `8d17d82` is `e2fdf32` plus the fix, and `33c1480` is `d844acd` plus the fix.

Each overlay ran all 11 cases twice, in the order `e2fdf32`, `d844acd`, `e2fdf32`, `d844acd`, one bench at a time on the same Mac. The cases came from a checkout of `main` at `130435a`, and the factory came from each ref. Columns are pass 1 / pass 2. `findings` is the row's `review_findings`.

`e2fdf32` plus the gate fix:

| case | role | outcome | checks | cost | wall time | findings |
| --- | --- | --- | --- | --- | --- | --- |
| 11-run-log-schema | spec | done / done | - | $0.07 / $0.06 | 30s / 30s | - |
| 32-webhook-health-check | triage | needs_human / needs_human | - | $0.00 / $0.00 | 18s / 13s | - |
| 33-branch-ci-secrets | triage | needs_human / needs_human | - | $0.00 / $0.00 | 10s / 10s | - |
| 34-process-group-clone | spec | done / done | - | $0.08 / $0.09 | 33s / 39s | - |
| 35-token-only-mcp | triage | needs_human / needs_human | - | $0.00 / $0.00 | 15s / 14s | - |
| 4-run-issue-review | review | done / done | - | $0.05 / $0.05 | 17s / 19s | 3 / 2 |
| 41-tsx-gate-sandbox | spec | done / done | - | $0.06 / $0.07 | 24s / 31s | - |
| 5-quality-gates-review | review | done / done | - | $0.09 / $0.09 | 18s / 22s | 4 / 3 |
| 52-stage-labels-test | triage | done / done | - | $0.00 / $0.00 | 10s / 8s | - |
| 52-stage-labels-test | spec | done / done | - | $0.03 / $0.03 | 13s / 11s | - |
| 52-stage-labels-test | implement | done / done | passed / passed | $0.05 / $0.08 | 23s / 31s | - |
| 52-stage-labels-test | review | done / done | - | $0.03 / $0.03 | 11s / 9s | 0 / 0 |
| 55-chain-ends-in-review | triage | done / done | - | $0.00 / $0.00 | 11s / 14s | - |
| 60-merge-gate-lint | triage | done / done | - | $0.00 / $0.00 | 13s / 12s | - |
| 60-merge-gate-lint | spec | done / done | - | $0.03 / $0.04 | 14s / 15s | - |
| 60-merge-gate-lint | implement | done / done | passed / passed | $0.05 / $0.06 | 19s / 28s | - |
| 60-merge-gate-lint | review | done / done | - | $0.04 / $0.04 | 15s / 15s | 0 / 1 |

`d844acd` (this branch's merge) plus the gate fix:

| case | role | outcome | checks | cost | wall time | findings |
| --- | --- | --- | --- | --- | --- | --- |
| 11-run-log-schema | spec | done / done | - | $0.08 / $0.08 | 30s / 34s | - |
| 32-webhook-health-check | triage | needs_human / needs_human | - | $0.00 / $0.00 | 11s / 15s | - |
| 33-branch-ci-secrets | triage | needs_human / needs_human | - | $0.00 / $0.00 | 11s / 12s | - |
| 34-process-group-clone | spec | done / done | - | $0.07 / $0.07 | 31s / 27s | - |
| 35-token-only-mcp | triage | needs_human / needs_human | - | $0.00 / $0.00 | 17s / 15s | - |
| 4-run-issue-review | review | done / done | - | $0.06 / $0.05 | 21s / 17s | 4 / 5 |
| 41-tsx-gate-sandbox | spec | done / done | - | $0.06 / $0.07 | 28s / 29s | - |
| 5-quality-gates-review | review | done / done | - | $0.09 / $0.10 | 18s / 20s | 3 / 3 |
| 52-stage-labels-test | triage | done / done | - | $0.00 / $0.00 | 8s / 10s | - |
| 52-stage-labels-test | spec | done / done | - | $0.03 / $0.03 | 12s / 11s | - |
| 52-stage-labels-test | implement | done / done | passed / passed | $0.06 / $0.05 | 26s / 23s | - |
| 52-stage-labels-test | review | done / done | - | $0.03 / $0.03 | 9s / 11s | 0 / 0 |
| 55-chain-ends-in-review | triage | **needs_human** / done | - | $0.00 / $0.00 | 10s / 16s | - |
| 60-merge-gate-lint | triage | done / done | - | $0.00 / $0.00 | 14s / 14s | - |
| 60-merge-gate-lint | spec | done / done | - | $0.03 / $0.03 | 13s / 12s | - |
| 60-merge-gate-lint | implement | done / done | passed / passed | $0.07 / $0.09 | 33s / 36s | - |
| 60-merge-gate-lint | review | done / done | - | $0.03 / $0.03 | 14s / 14s | 2 / 2 |

Totals per bench:

| | `e2fdf32` pass 1 | `e2fdf32` pass 2 | `d844acd` pass 1 | `d844acd` pass 2 |
| --- | --- | --- | --- | --- |
| stages run | 17 | 17 | 17 | 17 |
| `done` | 14 | 14 | 13 | 14 |
| `needs_human` | 3 | 3 | 4 | 3 |
| implement gate passed | 2 of 2 | 2 of 2 | 2 of 2 | 2 of 2 |
| cost | $0.586 | $0.651 | $0.634 | $0.639 |
| wall time (sum of runs) | 294s | 321s | 306s | 316s |

**What the numbers said.**

- **The agents got the same input.** In all 68 runs, every case's first-stage `prompt.md` and every run's `settings.json` were byte-identical between the two refs once temporary paths and run ids were masked. Model, tools, budget and time limit in `run.json` were the same too. Later stages' prompts differ only in the earlier stage's text, which varies run to run.
- **Outcomes.** 16 of 17 stages ended the same way in all four benches, and every implement run passed the gate. The one difference is 55-chain-ends-in-review's triage on `d844acd`'s first pass, which asked a question instead of passing the issue on. Its prompt was byte-identical to the other three, and the same ref passed the issue on in its second pass. All four answers named the existing chain test. The question is the first of the two outcomes the case accepts, and it is what the factory's real first run on #55 did. That is run-to-run noise.
- **Cost.** `d844acd`'s two passes averaged $0.018 more than `e2fdf32`'s. `e2fdf32`'s own two passes differ by $0.065. The largest per-case gap is 60-merge-gate-lint's implement, $0.05 / $0.06 against $0.07 / $0.09. The transcripts trace it to the spec stage. The specs disagreed on the fix: both `e2fdf32` implement runs made `api()` generic, and both `d844acd` runs returned `unknown` with narrowing helpers, which took more turns and, once, a second gate attempt for the PR description's door wording. The TL-15 run at `5477cf4`, which includes this branch, also took the `unknown` route, for $0.05. 60-merge-gate-lint's review findings (0 / 1 against 2 / 2) follow from those different patches. 4-run-issue-review's findings (3 / 2 against 4 / 5) came from byte-identical inputs; the TL-15 run got 3.
- **Wall time.** 615s against 622s over 34 runs each.

**Verdict: no behaviour change.** The benchmark shows no difference between `e2fdf32` and `d844acd` beyond run-to-run noise. Each difference either came from identical inputs or traces to an earlier stage's sampling. Two passes per ref can only show large differences, but the agents' inputs were byte-identical, so a difference could only come from sampling. Two limits remain. The benchmark replays `run-issue.sh`, not the workflow, so the `route` job is still checked only by the fake-`gh` comparisons above and by its first live run. Whether the outcomes were right is TL-16's to score.

Spend: $2.510 for the four benches (68 runs). DATABASE_URL was unset, so the rows went to the local SQLite run log. No cloud rows were written.

Cost of the routing: one short `route` job for every `factory:*` label added. An issue that goes through the whole chain gets nine: four trigger labels, four `in-progress` and one `in-review`. Five of those start nothing; under TL-7 they cost no runner. Each stage also starts about half a minute later, while `route` installs dependencies. The first live run will show the real figures.
