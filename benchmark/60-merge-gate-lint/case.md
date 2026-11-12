---
issue: 60
pr: 62
base_sha: 5d7abe927640a9c9f87acf316f3abf5a089c8f8e
role: implement
stages: triage,spec,implement,review
files: scripts/check-merge-gate.ts
checks: pnpm typecheck && pnpm exec biome lint --error-on-warnings && pnpm test && ! grep -q biome-ignore scripts/check-merge-gate.ts
---
## Issue

Fix the two lint warnings in scripts/check-merge-gate.ts

````markdown
`pnpm lint` reports two warnings in `scripts/check-merge-gate.ts`: `noExplicitAny` on `api()`'s return type (line 14) and `noNonNullAssertion` on `keyPath!` (line 29). Fix both without disabling the rules. Give `api()` a typed or `unknown` body that its callers narrow, and check `keyPath` before using it, with the same error the script gives for other missing settings. Only that file changes. `pnpm exec biome lint --error-on-warnings` passes.

````

## Expected outcome

- **Triage** passes the issue on with a note, not a question. The issue names the file, both warnings, the fix for each and the command that proves it. The note should say the script needs live GitHub App credentials, so verification is lint, typecheck and tests, not a run of the script.
- **Spec** keeps the change to `scripts/check-merge-gate.ts`. It rules out `biome-ignore` comments and any change to `biome.json`. It lists every place a field of `.json` is read (the installation id, the token, the main ref's sha, the PR number, and the approve and merge `message`) and says each one is narrowed, with no cast to `any`. It keeps `api()`'s non-throwing 4xx behaviour and the `finally` that deletes the branch. It says why `appJwt()` must check `keyPath` itself: the narrowing from the top-level check does not reach inside the function. And it requires that check to throw the same message as the top-level one.
- **Implement** changes only that file. `api()` returns `json: unknown`, or a typed shape, and its callers narrow it. `appJwt()` checks `keyPath` and throws the top-level message, with no `!` left. The printed strings, the exit code and the order of API calls are unchanged. A malformed response may now throw a descriptive error where the old code sent `undefined` on, and that counts as a pass.
- **Review** has no blocking finding. A nit about how loosely `message` is narrowed, or about casts after a shared helper, is fair. A finding that asks for a run of the script against GitHub is not, because the issue rules that out.

The check runs typecheck, lint with warnings as errors, and the tests, and refuses a `biome-ignore` in the file. At `base_sha` the lint step fails on the two warnings, so the check exits 1. On the reference it exits 0. Disabling the rules in `biome.json` would also pass the lint step. The case's `files` catches that, because `biome.json` is outside them.

Reference: the factory's own run, PR #62, in four stages, on Sonnet. Implement cost $0.06 and review cost $0.04. The review raised two `[no rule]` nits and no blocking finding. Both agents reported environment trouble: implement ran the binaries directly because `pnpm` was not on its path, and review said it could not run the checks and that the clone's `.git` was broken. The checks above were confirmed outside the gate.
