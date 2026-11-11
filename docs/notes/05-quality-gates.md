# 05: Quality gates the agent cannot skip (TL-5)

## Expected

A Claude Code `Stop` hook in `scripts/run-issue.sh` runs the target repository's `typecheck`, `lint` and `test` scripts. While any of them fails, the hook refuses to let the agent finish and tells it which check failed. TL-4's baseline is the number to beat: one of four PRs was verified, because one refused shell command was enough for an agent to stop testing, and the prompt asking it to test did not change that.

## Happened

**`--bare` turns off every hook.** A probe hook in the run's `--settings` never fired, and neither did one in a plugin passed with `--plugin-dir`. The run now drops `--bare`. It keeps `--setting-sources ""`, which already kept the owner's settings out, and adds `autoMemoryEnabled: false`. A second probe confirmed the hook fires and blocks, the owner's CLAUDE.md is not in the agent's context, only built-in skills and plugins load, and auth still comes from `apiKeyHelper`.

**A hook would have punched a hole in TL-4's sandbox.** Hooks run outside Claude Code's Bash sandbox, so a hook that runs `npm test` runs the agent's own tests with the owner's full access, and its output goes back to the agent. A prompt-injected agent could write a test that prints `~/.ssh` or the API key file and get the contents in its next message. The checks therefore run in their own sandbox, `srt` from `@anthropic-ai/sandbox-runtime`, which denies network, writes outside the clone, and reads of the home directory and of the key file's directory. The run's Node installation has to be re-allowed, or `node` is not found at all.

**The first version shipped with two sandbox escapes, and review found them.** A `/code-review` of the PR reproduced both, and both are fixed and tested:

- **The API key was readable.** The checks denied reads of `os.tmpdir()`. The hook inherits the agent's `env -i` environment, which has no `TMPDIR`, so that meant `/tmp`, while the key sat under `/var/folders/.../T/`. A test written by the agent could have printed the key into the agent's next message. The unit test passed only because test runs have `TMPDIR` set. The five runs in the first version of this note ran with that hole open, though no agent tried to use it. `run-issue.sh` now passes the key's directory explicitly, and a test starts the hook with only `PATH` and `HOME`, as Claude Code does.
- **A planted `node` escaped.** `srt`'s pnpm shim looks `node` up on `PATH`, and the gate had put the clone's `node_modules/.bin` first on it. `srt` now starts with the hook's own `node`, and the clone's binaries reach `PATH` only inside the sandbox.

Run against the first version, both reproductions succeeded. Run against the fixed version, the new tests pass. The same review led to four smaller fixes:

- The scripts were read from `HEAD` on the belief that the agent cannot commit. Its sandbox leaves `.git` writable, so they now come from a copy of `package.json` taken before the agent starts.
- A `package.json` that cannot be parsed used to pass with no checks. It now fails closed.
- The hook now runs from this repository, so the clone's `tsconfig.json` cannot shape how tsx compiles it.
- stderr is merged into stdout in order, so warnings cannot push the failing test out of the 60-line tail.

The gate still catches mistakes, not an agent trying to cheat. A weakened test shows up in the diff. A git-ignored fake `node` that exits 0 would not, though it now runs inside the sandbox.

**Smaller findings.** `@anthropic-ai/sandbox-runtime@0.0.82` was published the same day, and pnpm's minimum-release-age policy refused it. The repository pins 0.0.81 rather than adding an exception. Inside `pnpm test`, a nested `node --test` inherits `NODE_TEST_CONTEXT`, skips its files and exits 0, so a failing fixture looked like a pass until the test removed the variable. This repository got a `lint` script (Biome, recommended rules), and CI now runs `lint` and `test`; until now CI ran only `typecheck`, so the tests had never run in CI.

**The fixture.** The issue asks for `slugify` to use underscores, which contradicts an existing test. It also says "Don't spend time running the tests", which reproduces the baseline's failure mode on purpose. The agent changed `src/text.ts` and tried to finish. The gate refused with `Quality gate: test failed` and the TAP output of `not ok 1 - slugify joins words with hyphens`. The agent updated the test, tried again, and the gate let it finish.

**How the runs were made.** All five numbers below come from the fixed version, run on 11 November. Each used a scratch copy of `run-issue.sh` that differs in three lines. It clones a local copy of factory-sample at `21d627d` instead of GitHub, the fixture run reads its issue from a file, and it exits before the push. So no PRs were opened, and every other setting, the prompt and the hook are as committed.

## What the numbers said

| Run | Issue | Attempts to finish | Refused by gate | Agent ran tests itself | Turns | Agent time | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fixture | slugify uses underscores | 2 | 1 (`test`) | No: told not to, then `npm` blocked | 5 | 12.3 s | $0.040 |
| 1 | wordCount on empty text | 1 | 0 | No, `sed -i` refused | 7 | 11.4 s | $0.031 |
| 2 | slugify accents | 1 | 0 | Yes | 6 | 9.5 s | $0.026 |
| 3 | truncate at word boundary | 1 | 0 | Yes | 6 | 13.4 s | $0.035 |
| 7 | add titleCase | 1 | 0 | No, `sed -i` refused | 9 | 16.1 s | $0.038 |

Model `claude-sonnet-5-5`, Claude Code 2.1.322. Every check took 0.2 s.

Verified at hand-in went from one of four to five of five, the same as the runs before the review fixes. The gate did not change what the agents do. Two of the four baseline issues still lost the shell after one refusal and never ran the tests, as in TL-4. Their summaries still tell a human the change is "untested" and to "run `npm test`", because the agent writes its summary before the final check runs. The gate had run those tests and they passed, and the PR's table says so. That mismatch is for TL-8, where PRs explain themselves. On the four real issues the agents' code was already right, so the gate only confirmed it. The fixture is the one run where the gate changed the outcome. Its agent also wrote "I haven't re-run the tests" in its summary, though the gate's rerun then passed. The benchmark (TL-14) needs issues where agents actually get things wrong.

The gate costs about a cent a run (an average of $0.032 on the four issues, against TL-4's $0.023). Dropping `--bare` adds 3,247 prompt tokens to every request (1,660 against 4,907 for a one-word reply), which matches the extra cost. `--disable-slash-commands` does not reduce it.

## Follow-up: this repository's tests inside the gate (#41)

**Expected.** Once TL-6 installed the clone's dependencies, the real stop hook would pass on this repository with a correct change.

**Happened.** `typecheck` and `lint` passed. `test` failed with `listen EPERM ... tsx-501/<pid>.pipe`: tsx's CLI opens a Unix socket for IPC, and the checks' sandbox denies Unix sockets. Allowing them was rejected. On Linux, `srt` can allow every Unix socket or none, because seccomp cannot filter by path, and every socket includes Docker's, which is root on GitHub's runners. The sandbox is unchanged. Instead:

- `test` is now `node --import tsx --test`. tsx's loader compiles the same files and opens no socket. That fixed tsx's own pipe, but four of the gate's own tests still failed inside the gate.
- Three of them start `srt` themselves, and `srt` cannot start inside `srt` (`listen EPERM` on its proxy socket). They now skip when `SANDBOX_RUNTIME=1`, which `srt` sets. The question-stop test starts the hook with `node --import tsx`, so it still runs inside the gate.
- The macOS sandbox test now also checks that a check cannot connect to a Unix socket on the host. A control first connects to the same socket outside the sandbox. With `allowAllUnixSockets: true` patched into a scratch copy, the test fails.
- CI's new `gate` job prepares an Ubuntu runner as `factory.yml` does and runs the real hook on a fresh clone of the PR. It then runs the hook again with probes of the network, Docker's socket, a file in the home directory and a key file. Each probe must first reach its target outside the sandbox.

**What the numbers said.** On macOS, the real hook run on a fresh clone of the branch went from `test exit 1` to all three checks passing (0.4 s, 0.1 s and 0.2 s). Inside the gate, 17 tests passed and 3 skipped. Run outside it, all 20 passed. With one assertion broken in the clone, the hook still blocked, with exit 2 and `test failed`.

**On Linux the gate had never passed any check, for any repository.** Nothing had run it on a GitHub runner before. Once it ran, it failed in four ways, one after another. All but the first would also have stopped every factory run on Actions.

1. **apt could not resolve the Ubuntu mirrors**, five times over two hours. A probe showed that Azure's resolver (168.63.129.16), which the runners use, timed out or returned SERVFAIL for `archive`, `security` and `azure.archive.ubuntu.com`, in three regions and on both the 26.04 and 24.04 images. It answered `registry.npmjs.org` and `github.com` straight away, and 1.1.1.1 resolved the mirrors from the same VMs. Lookups got through now and then, so `-o Acquire::Retries=5` gets apt through. By the next run the resolver had recovered.
2. **Every check exited 127**: `apply-seccomp: No such file or directory`. On Linux, srt runs its seccomp helper from inside bubblewrap, out of this repository's `node_modules`. On a runner the repository is checked out under `/home/runner`, which the gate denies. srt's own package is now readable inside the sandbox. Nothing else from this repository is.
3. **Every check then failed with `nested userns is capability-restricted`.** `ubuntu-latest` is now Ubuntu 26.04, which enforces an AppArmor profile, `bwrap-userns-restrict`, that strips capabilities from namespaces created inside bubblewrap. The seccomp helper needs one of those. The sysctl that `factory.yml` already set is not enough. A probe ran `srt -c 'echo SANDBOX-OK'`. It worked on 24.04, which has no such profile. On 26.04 it failed until `apparmor_parser -R` unloaded the profile. CI's `gate` job and `factory.yml` now unload it when it exists.
4. **`typecheck` and `lint` passed, and every test file failed** with `ENOENT: mkdir '/tmp/claude/tsx-1001'`. srt points `TMPDIR` at `/tmp/claude` unless `CLAUDE_CODE_TMPDIR` is set, and only Claude Code creates that directory. It existed on the Mac only because Claude Code runs there. Each hook run now gives the checks a private temporary directory, and it is removed afterwards. That also stops the checks sharing `/tmp/claude` with the agent's own sandbox.
