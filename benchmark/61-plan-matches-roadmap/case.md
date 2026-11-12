---
issue: 61
pr: 70
base_sha: cdc2e1b07dff332627e48390ed9c6d5b816d14ab
role: implement
stages: triage,spec,implement,review
files: platform/plan/plan.test.ts
checks: pnpm test && sed -i.orig 's/Benchmark set of past issues/Benchmark set of old issues/' docs/roadmap.ts && ! pnpm test; s=$?; mv docs/roadmap.ts.orig docs/roadmap.ts; exit $s
---
## Issue

Test that docs/PLAN.md matches docs/roadmap.ts

````markdown
Rule R-4 says a change to `docs/roadmap.ts` comes with `docs/PLAN.md` re-rendered, but nothing checks it. Make `scripts/render-plan.ts` export the rendering as a function (running it still writes the file), and add a test under `platform/` that fails when `docs/PLAN.md` differs from what `docs/roadmap.ts` renders. `pnpm test` passes.

````

## Expected outcome

At `base_sha`, half the issue is already done: `scripts/render-plan.ts` exports `renderPlan()` behind an entry-point guard (#63). What is left is the test. A replay must notice that and not redo the export.

- **Triage** passes the issue on with a note, not a question. The note should say that `renderPlan()` already exists, so the work is one new test file.
- **Spec** keeps the change to one new file under `platform/`, because `pnpm test` runs only `platform/**/*.test.ts`. It says the test reads `docs/PLAN.md` relative to the test file, not the working directory, and compares it with `renderPlan()`. A failure message that names `pnpm plan` is a plus, not a requirement. It leaves `render-plan.ts`, `roadmap.ts` and `PLAN.md` untouched.
- **Implement** creates `platform/plan/plan.test.ts`, or another new test file under `platform/`. It compares the committed `docs/PLAN.md` with `renderPlan()`. No other file changes. This case needs a new file, so it fails if the implement agent cannot create one (#67).
- **Review** has no blocking finding.

The check runs the tests, then renames TL-14's title in `docs/roadmap.ts` without re-rendering, requires the tests to fail, and puts the file back. At `base_sha` nothing compares the two files, so the rename breaks nothing and the check exits 1. On the reference it exits 0. The check must run in a git checkout, because `platform/bench/bench.test.ts` calls `git ls-files`.

Reference: the factory's second run on #61, PR #70, after #68 gave implement a Write tool. Implement created the file with Write, had no permission denials, passed the gate on its first attempt and cost $0.06. Review found nothing and cost $0.03. The first run, PR #63, could not create the file and merged without the test. That is why `base_sha` already has the export.
