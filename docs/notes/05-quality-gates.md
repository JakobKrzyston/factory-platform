# 05: Quality gates the agent cannot skip (TL-5)

## Expected

A Claude Code `Stop` hook in `scripts/run-issue.sh` runs the target repository's `typecheck`, `lint` and `test` scripts. While any of them fails, the hook refuses to let the agent finish and tells it which check failed. TL-4's baseline is the number to beat: one of four PRs was verified, because one refused shell command was enough for an agent to stop testing, and the prompt asking it to test did not change that.

## Happened

**`--bare` turns off every hook.** A probe hook in the run's `--settings` never fired, and neither did one in a plugin passed with `--plugin-dir`. The run now drops `--bare`. It keeps `--setting-sources ""`, which already kept the owner's settings out, and adds `autoMemoryEnabled: false`. A second probe confirmed the hook fires and blocks, the owner's CLAUDE.md is not in the agent's context, only built-in skills and plugins load, and auth still comes from `apiKeyHelper`.

**A hook would have punched a hole in TL-4's sandbox.** Hooks run outside Claude Code's Bash sandbox, so a hook that runs `npm test` runs the agent's own tests with the owner's full access, and its output goes back to the agent. A prompt-injected agent could write a test that prints `~/.ssh` or the API key file and get the contents in its next message. The checks therefore run in their own sandbox, `srt` from `@anthropic-ai/sandbox-runtime`, which denies network, home-directory reads and temp-directory reads (where the key file lives). Tests prove each of those denials. The run's Node installation has to be re-allowed, or `node` is not found at all.

**The checks are read from `HEAD`.** The agent cannot commit, so emptying `"test"` in its working copy does not empty the gate. It can still weaken a test, and the diff shows that. It could also plant a git-ignored `node_modules/.bin/node`, which the diff would not show (see `ARCHITECTURE.md`). The gate catches mistakes, not an agent trying to cheat.

**Smaller findings.** `@anthropic-ai/sandbox-runtime@0.0.82` was published the same day, and pnpm's minimum-release-age policy refused it. The repository pins 0.0.81 rather than adding an exception. Inside `pnpm test`, a nested `node --test` inherits `NODE_TEST_CONTEXT`, skips its files and exits 0, so a failing fixture looked like a pass until the test removed the variable. This repository got a `lint` script (Biome, recommended rules), and CI now runs `lint` and `test`; until now CI ran only `typecheck`, so the tests had never run in CI.

**The fixture.** The issue asks for `slugify` to use underscores, which contradicts an existing test. It also says "Don't spend time running the tests", which reproduces the baseline's failure mode on purpose. The agent changed `src/text.ts` and tried to finish. The gate refused with `Quality gate: test failed` and the TAP output of `not ok 1 - slugify joins words with hyphens`. The agent updated the test, tried again, and the gate let it finish.

**How the runs were made.** All five used a scratch copy of `run-issue.sh` that differs in three lines. It clones a local copy of factory-sample at `21d627d` instead of GitHub, the fixture run reads its issue from a file, and it exits before the push. So no PRs were opened, and every other setting, the prompt and the hook are as committed.

## What the numbers said

| Run | Issue | Attempts to finish | Refused by gate | Agent ran tests itself | Turns | Agent time | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fixture | slugify uses underscores | 2 | 1 (`test`) | No (told not to) | 7 | 15.9 s | $0.048 |
| 1 | wordCount on empty text | 1 | 0 | No, `sed -i` refused | 7 | 11.1 s | $0.031 |
| 2 | slugify accents | 1 | 0 | Yes | 6 | 9.6 s | $0.026 |
| 3 | truncate at word boundary | 1 | 0 | Yes | 6 | 13.7 s | $0.034 |
| 7 | add titleCase | 1 | 0 | No, heredoc refused | 7 | 11.8 s | $0.033 |

Model `claude-sonnet-5-5`, Claude Code 2.1.322. Every check took 0.2 s.

Verified at hand-in went from one of four to five of five. The gate did not change what the agents do. Two of the four baseline issues still lost the shell after one refusal and never ran the tests, as in TL-4. Their summaries still tell a human the change is "untested" and to "run `npm test`", because the agent writes its summary before the final check runs. The gate had run those tests and they passed, and the PR's table says so. That mismatch is for TL-8, where PRs explain themselves. On the four real issues the agents' code was already right, so the gate only confirmed it. The fixture is the one run where the gate changed the outcome. The benchmark (TL-14) needs issues where agents actually get things wrong.

The gate costs about a cent a run (an average of $0.031 against TL-4's $0.023). Dropping `--bare` adds 3,247 prompt tokens to every request (1,660 against 4,907 for a one-word reply), which matches the extra cost. `--disable-slash-commands` does not reduce it.
