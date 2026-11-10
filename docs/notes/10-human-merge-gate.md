# 10: Human merge gate (TL-10)

## Expected

Branch protection on `main` that needs one human approval and a green check, and a factory identity that can open PRs but cannot approve or merge them. Mostly configuration: two rulesets, a CI job for them to require, and a GitHub App for the factory.

## Happened

Writing the required check found that `main` could not pass it. `pnpm install` exited 1 because pnpm 12 refuses to run esbuild's build script until it is allowed, and `tsc` failed because `tsconfig.json` names `node` types that were never installed. Both were invisible because nothing ran them. `pnpm-workspace.yaml` now allows esbuild's build, and `@types/node` is a dev dependency.

Classic branch protection could not express the rule. On a personal repository it cannot restrict who merges, so an App with write access could merge as soon as a human approved. Rulesets can: an update restriction that only the admin role bypasses. Bypass is per ruleset, so the gate is two rulesets, one the owner can bypass through a pull request (review and updates) and one nobody can (the check). See `docs/ARCHITECTURE.md`.

The factory's identity was decided here rather than in TL-4 because the gate depends on it. An owner token makes the owner the author, and authors cannot approve their own PRs. Actions' `GITHUB_TOKEN` cannot trigger the check workflow on PRs it opens. A GitHub App avoids both.

`pnpm merge-gate` created both rulesets on the first run and updated them in place on the second. GitHub accepted the update restriction on a personal repository. Once the rulesets were live, this PR showed `BLOCKED` / `REVIEW_REQUIRED` with its `checks` job green.

PR #27 merged through the live gate at 15:55 UTC on 10 November, with no approving review, by the owner's pull-request bypass. GitHub's rule-suite record for that push (5024385597) shows each rule. `main: green checks` passed: the `checks` job was green, and nobody can bypass it. `main: human merges` failed on two rules, "Cannot update this protected ref." and "New changes require approval from someone other than the last pusher.", and the admin bypass let the merge through. So the gate held, and only the bypass it was built with got past it.

The factory App took three tries. The first key and App ID belonged to Throughline's reconciliation App, which is read-only. The second App was a copy of it, also read-only. Raising it to read-write on the App was not enough: the installation kept the old permissions until they were accepted under Installed GitHub Apps. Each wrong state would have given a meaningless result, so the check ran only after `GET /app` and `GET /repos/…/installation` both showed write access. The factory App is `throughline-factory-2` (App ID 5688742), with read-write Contents, Pull requests and Issues on this repository only, and no webhook events.

`pnpm check-merge-gate`, run at 18:40 UTC on 10 November:

```
opened   #37 as the factory App
refused  approve: 422 Unprocessable Entity
refused  merge: 405 Repository rule violations found

Required status check "checks" is expected.

Cannot update this protected ref.

New changes require approval from someone other than the last pusher.
ok       the factory App can neither approve nor merge its own PR
```

PR #37 shows `app/throughline-factory-2` as its author. It was closed three seconds after opening, and its branch was deleted. The merge was refused by both rulesets at once, so either would have been enough to stop it.

## What the numbers said

| Measure | Value |
| --- | --- |
| Checks `main` failed before this stage | 2 of 2 (install, typecheck) |
| Rulesets | 2 (IDs 26914609, 26914610) |
| `checks` job on this PR | pass, 15 s |
| Factory App: approve own PR | refused, 422 |
| Factory App: merge own PR | refused, 405 (3 rule violations) |
| App setups before the check could run | 3 (wrong App, read-only copy, installation not accepted) |
