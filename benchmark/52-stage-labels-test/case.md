---
issue: 52
pr: 53
base_sha: e69b9b58d03324d348a3de837e965f72f4cc29b2
role: implement
stages: triage,spec,implement,review
files: platform/queue/queue.test.ts
checks: pnpm typecheck && pnpm lint && pnpm test && sed -i.orig 's/"factory:review"\]/"factory:reviewed"]/' .github/workflows/factory.yml && ! pnpm test; s=$?; mv .github/workflows/factory.yml.orig .github/workflows/factory.yml; exit $s
---
## Issue

Test that factory.yml's stage labels match STAGES

````markdown
The `run` job in `.github/workflows/factory.yml` lists the labels that queue a role (`factory:ready`, `factory:spec`, `factory:implement`, `factory:review`). That list is copied by hand from `STAGES` in `platform/queue/queue.ts`, and a comment says to change both together. Nothing checks it.

Add a test to `platform/queue/queue.test.ts` that reads `factory.yml`, finds that list, and fails when it differs from the labels of `STAGES`' keys.

- Only the test changes. Do not edit the workflow.
- Use the standard library to read the file. No YAML dependency for one list.
- `pnpm test` passes.

````

## Expected outcome

- **Triage** passes the issue on with a note, not a question: the issue says what done looks like and the repository settles the rest.
- **Spec** keeps the change to `platform/queue/queue.test.ts`. It reads the workflow with the standard library, adds no YAML dependency, leaves `factory.yml` untouched, and makes the test fail with a clear message if the label list cannot be found.
- **Implement** adds one test that reads `.github/workflows/factory.yml` from a path resolved against the test file, not the working directory. It extracts the `fromJSON('[...]')` label list from the `run` job and compares it with `label()` applied to every key of `STAGES`. Only the test file changes.
- **Review** has no blocking finding.

The checks run typecheck, lint and the tests, then rename `factory:review` in the workflow's list and require the tests to fail, and put the workflow back. At `base_sha` the rename breaks nothing, so the check fails there. It proves that a test was added and that the test bites, not only that the suite is green.

Reference: the factory's own run, PR #53, in four stages. Implement cost $0.06 and review cost $0.03. The review found nothing. The implementer did not finish its mutation check by hand, and the case's check does it instead.
