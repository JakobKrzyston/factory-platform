# 16: Scorers (TL-16)

## Expected

Automated graders under `scorers/<name>/scorer.md` that answer the four questions TL-16 asks of every benchmark result. Did the tests the issue needed pass? Did the diff stay inside the files the spec named? How many review findings? What did it cost? Each acceptance criterion maps to a mechanism:

| Acceptance | Mechanism |
| --- | --- |
| Each scorer is a file and runs on every benchmark result | `factories/code/scorers/{tests,scope,findings,cost}/scorer.md`, each naming a `measure` in `platform/scorers/scorers.ts`. `pnpm bench` runs every scorer on every stage's result as soon as its row is written. A measure that cannot apply returns nothing, such as `scope` on a triage run. |
| A scorer's output is a number and a one-line reason, stored with the run | A `scores` table, `run_id`, `scorer`, `score` and `reason`, keyed by run and scorer (`platform/runlog/migrations/002_scores.sql`). |
| Scores appear on the dashboard (from the roadmap's description) | A "Benchmark scores" section on `pnpm dashboard`'s page: per factory version, each scorer's mean, and every score with its reason. |

I expected the three implementation cases to score `tests` 1 and `scope` 1, since all three passed the gate in TL-15 and TL-17, and the reviews to raise about as many findings as before.

## Happened

**A scorer names a measure; it does not hold one.** Rule 5 says nothing under `factories/` is runnable, so `scorer.md` holds one setting, `measure`, plus the text that says what the number means. The four measures are code in `platform/scorers/`. That is the same split as `agent.md` naming a model. A file with an unknown setting or measure, or with nothing after its settings, is refused, and a test reads the code factory's four.

**The checkout's scorers grade every ref.** `pnpm bench` reads scorers from the checkout it runs in, as it already read the cases, not from the ref under test. A ref from before this stage has no scorers. A comparison where each side brings its own scorers would compare two rulers, and a proposed factory could grade itself with scorers it had just changed. The cost: a score does not record which scorers gave it. That is in the run log README.

**Scores are a table, not columns on `runs`.** A new scorer is then a new file, not a migration. The migration is plain SQL that runs on both stores. It ran on SQLite in the tests, and on Postgres through PGlite, Postgres compiled to WebAssembly, in a scratch directory, since Docker's daemon was not answering on this Mac. Postgres applied 001 and 002, refused a duplicate score, a score for a run that does not exist and an empty reason, and returned the dashboard's join with `score` as a number. Neon was not touched.

**`tests` reruns the case's checks in the gate's sandbox.** It is not implement's `checks_passed`. The gate runs the repository's typecheck, lint and test scripts. A case's `checks` line also proves the issue's outcome, and can refuse a shortcut, such as #60's `! grep -q biome-ignore`. The patch is agent-written code, so the checks get the gate's own confinement. They run in a fresh clone of the base in the system's temporary directory, with the base's dependencies installed before the patch is applied. srt denies them the home directory, and their environment holds only `PATH` and `HOME`. The bench's own environment has the API key. That needed one change outside the new module: `runChecks` takes an environment, which defaults to the process's own as before.

The checks call `pnpm`, which is installed under the denied home directory. So inside the sandbox `pnpm` is a shell function. `pnpm <script>` runs the base's `package.json` script and `pnpm exec <bin>` runs `node_modules/.bin/<bin>`. Running the patched `package.json` would let a patch pass by rewriting `test` to `true`. The test does exactly that and checks that it scores 0. It also checks that a check that lists the home directory fails.

**A run that handed off nothing scores `tests` 0, not nothing.** If implement asked a question or failed, the factory delivered nothing that passes, and leaving it unscored would make a failing version look no worse than a passing one. `scope` does skip it: with no patch handed off, there is no diff to judge.

## What the numbers said

`pnpm bench code main --max-usd 3`, on this Mac, against `main` at `f32c7ef`, from this branch's checkout. The bench started before the reasons' wording was last edited ("all 1 changed file" and "$0.00" became "1 changed file, all" and "$0.004"). The stored reasons use the old wording; the scores are the same.

```
case                     role       outcome      checks  cost   wall time  scores
11-run-log-schema        spec       done         -       $0.08  26s        cost 0.076
32-webhook-health-check  triage     needs_human  -       $0.00  17s        cost 0.004
33-branch-ci-secrets     triage     needs_human  -       $0.00  14s        cost 0.005
34-process-group-clone   spec       done         -       $0.06  21s        cost 0.065
35-token-only-mcp        triage     needs_human  -       $0.00  12s        cost 0.003
4-run-issue-review       review     done         -       $0.06  19s        cost 0.062, findings 5
41-tsx-gate-sandbox      spec       done         -       $0.05  23s        cost 0.055
5-quality-gates-review   review     done         -       $0.10  24s        cost 0.101, findings 3
52-stage-labels-test     triage     done         -       $0.00  8s         cost 0.003
52-stage-labels-test     spec       done         -       $0.03  11s        cost 0.029
52-stage-labels-test     implement  done         passed  $0.05  20s        cost 0.052, scope 1, tests 1
52-stage-labels-test     review     done         -       $0.03  10s        cost 0.031, findings 0
55-chain-ends-in-review  triage     done         -       $0.00  15s        cost 0.002
60-merge-gate-lint       triage     done         -       $0.00  11s        cost 0.002
60-merge-gate-lint       spec       done         -       $0.04  15s        cost 0.035
60-merge-gate-lint       implement  done         passed  $0.06  28s        cost 0.065, scope 1, tests 1
60-merge-gate-lint       review     done         -       $0.04  13s        cost 0.037, findings 0
61-plan-matches-roadmap  triage     done         -       $0.01  17s        cost 0.005
61-plan-matches-roadmap  spec       done         -       $0.03  13s        cost 0.035
61-plan-matches-roadmap  implement  done         passed  $0.05  21s        cost 0.047, scope 0, tests 1
61-plan-matches-roadmap  review     done         -       $0.03  9s         cost 0.025, findings 0
total                                                    $0.74  347s
```

All 21 stages ran and none was skipped. The run log holds 21 benchmark rows with `factory_sha` `f32c7ef` and 32 scores: `cost` on all 21, `findings` on the 5 reviews, `scope` and `tests` on the 3 implement runs. The dashboard's section reads: cost mean 0.035 (21), findings 1.6 (5), scope 0.667 (3), tests 1 (3). Scoring added two to four seconds after each implement stage, the time between its row ending and the next stage's starting. The whole benchmark cost $0.74 in agent spend.

**`tests` passed all three, and it bites.** A pass in 1.3 s on #61 looked too fast for two runs of the test suite. So I reran it by hand with the same measure. The handed-off patch scored 1. A patch that adds only an unrelated file scored 0, because the check's `! pnpm test` passed. A check that printed the suite's summary showed 131 tests run, 126 passed and 0 failed; the other 5 are the ones that skip inside a sandbox. The suite is just fast.

**`scope` scored #61 0, and the scorer is what is wrong.** The patch touched one file, `platform/plan/render-plan.test.ts`. The case's `files` is the reference PR's list, `platform/plan/plan.test.ts`. The issue asked for "a test under `platform/`" and named no file, so both are right. For a case whose change creates a file, a list of exact paths is stricter than the issue. Its 0 is a false alarm, and #61 is the one case that creates a file. The mean of 0.667 is not a regression signal until cases can say "any new test under `platform/`". That is a change to TL-14's case format (a directory or glob in `files`), so it is a ticket, not this PR.

**`findings` shows spread on the review-only cases and says nothing about whether they were right.** On TL-15's run of an earlier `main` (`5477cf4`), case 4 raised 3 findings and case 5 raised 2. Here they raised 5 and 3. The reviews of the factory's own three patches raised none, where #52's raised 1 at `5477cf4`. Case 4's expected outcome names three defects. Whether these 5 include them takes a reader, or a judge model comparing the review with the expected outcome. That is the scorer this stage did not build, and the next one the benchmark needs.

**`cost` agrees with TL-15.** The 17 stages TL-15 also ran cost $0.626 here against $0.647 there. Case 61, added since, cost $0.112 over four stages. Triage stays under a cent a case.

## Not yet

- **A judge for comments.** Triage, spec and review cases have a written expected outcome and no scorer that reads it. Only `cost` and the `findings` count grade them.
- **`files` that allow a new file anywhere sensible.** See #61 above.
- **Which scorers graded a score.** It is the bench's checkout, and its commit is not stored. Comparisons made in one checkout are graded alike.
- **Neon.** Migration 002 applies itself on the next factory run that writes to Neon, as 001 did. The dashboard opens the run log read-only and needs `scores` to exist, so against a run log from before this stage it needs `pnpm runlog:migrate` first.
