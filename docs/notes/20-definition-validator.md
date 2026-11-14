# 20: Definition validator (TL-20)

## Expected

One command that says whether a factory directory is fit to merge, and CI refusing a pull request when it is not. TL-17's reader already refused a broken chain. TL-20 adds the two checks it left out, scorers referenced and no secrets in files, and gathers every check on one factory into one place.

| Acceptance | Mechanism |
| --- | --- |
| `pnpm validate-factory factories/<name>` fails with a named reason on each broken fixture | `platform/factory/validate.ts`. It prints one line per problem, naming the file (and the line, for a secret), and exits 1. `validate.test.ts` has eleven broken fixtures, one per check, each expecting exactly one problem with its reason. |
| CI blocks a PR that breaks a factory definition | A `factory definitions` step in CI's `checks` job, the required check on `main`. The job runs on every pull request. A `paths: factories/**` filter would leave the required check unrun on other PRs, so there is none. |

## Happened

**"One foreman" and "every trigger names an existing agent" were already there.** `readFactory` refuses both, so the validator calls it rather than checking them a second time. It stops at its first error, so a factory with two chain problems shows them one run at a time. The validator's own checks all run and report together.

**"Every scorer is referenced" means a scorer's reference resolves.** Nothing in a factory names a scorer: `pnpm bench` runs every one it finds. So the check runs the other way. Each folder under `scorers/` must hold a `scorer.md` whose `measure` names code in `platform/scorers/scorers.ts`. `readScorers` skips a folder without a `scorer.md`, so a misnamed file would have dropped a scorer from the benchmark without any error.

**Secrets are found by shape, never printed.** Anthropic keys, GitHub tokens, PEM private keys and database URLs with a password have recognisable shapes. The Vercel bypass secret and the MCP token do not, so they are caught only when assigned to their `.env.example` variable. A problem names the kind of secret and the line, never the value. The test fixtures build their fake key at runtime, so the repository holds no string a secret scanner would flag.

**The checks that were tests are now the validator.** `definitions.test.ts` used to check that each agent parses, that a `pull-request` agent has its skill, that each scorer parses and that a factory holds no code. Those checks moved into `validate.ts`, and the test now asserts that the validator finds nothing in each real factory. `pnpm test` is what the stop hook runs, so an agent that breaks a factory is still refused before it hands in.

## What the numbers said

- `pnpm validate-factory factories/*/` on `factories/code`: valid, exit 0.
- A copy of `factories/code` with six breaks: a renamed agent, the wrong foreman, an unknown measure, a scorer folder with no `scorer.md`, a script, and `ANTHROPIC_API_KEY=` in a comment. Exit 1, with five named problems. The wrong foreman appeared only after the agent was fixed, as above.
- `pnpm typecheck`, `lint` and `test` pass (161 tests).
