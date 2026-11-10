# 10: Human merge gate (TL-10)

## Expected

Branch protection on `main` that needs one human approval and a green check, and a factory identity that can open PRs but cannot approve or merge them. Mostly configuration: two rulesets, a CI job for them to require, and a GitHub App for the factory.

## Happened

Writing the required check found that `main` could not pass it. `pnpm install` exited 1 because pnpm 12 refuses to run esbuild's build script until it is allowed, and `tsc` failed because `tsconfig.json` names `node` types that were never installed. Both were invisible because nothing ran them. `pnpm-workspace.yaml` now allows esbuild's build, and `@types/node` is a dev dependency.

Classic branch protection could not express the rule. On a personal repository it cannot restrict who merges, so an App with write access could merge as soon as a human approved. Rulesets can: an update restriction that only the admin role bypasses. Bypass is per ruleset, so the gate is two rulesets, one the owner can bypass through a pull request (review and updates) and one nobody can (the check). See `docs/ARCHITECTURE.md`.

The factory's identity was decided here rather than in TL-4 because the gate depends on it. An owner token makes the owner the author, and authors cannot approve their own PRs. Actions' `GITHUB_TOKEN` cannot trigger the check workflow on PRs it opens. A GitHub App avoids both.

<!-- TODO before merge: results of applying the rulesets, this PR's own merge through the gate, and `pnpm check-merge-gate`. -->

## What the numbers said

| Measure | Value |
| --- | --- |
| Checks `main` failed before this stage | 2 of 2 (install, typecheck) |
| Rulesets | 2 |
