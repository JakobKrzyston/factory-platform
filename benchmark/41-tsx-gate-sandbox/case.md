---
issue: 41
pr: 44
base_sha: 787db5dc213fd7d17eb7f0381b909dd2a1494bdf
role: spec
stages: spec
files: .github/workflows/ci.yml,.github/workflows/factory.yml,docs/ARCHITECTURE.md,docs/notes/05-quality-gates.md,package.json,platform/gates/checks.ts,platform/gates/gates.test.ts
checks:
---
## Issue

Title: Quality gate: tsx cannot run inside the checks' sandbox

````markdown
TL-5's stop hook runs each check under `srt` with no network. `srt` treats Unix domain sockets as network, so it blocks them. `tsx` opens one for IPC with its child processes, so any check that runs `tsx` fails inside the gate. This repository's `test` script is `tsx --test "platform/**/*.test.ts"`, so the factory can never pass the gate here. A run on this repository ends at `factory:needs-human` ("ended without a pull request") instead of `factory:in-review`, whatever the agent did.

Reproduced on macOS against a fresh clone of `main` with its dependencies installed (as `run-issue.sh` does after #39), using the real stop hook started as Claude Code starts it:

```
typecheck  ok
lint       ok
test       exit 1
Error: listen EPERM: operation not permitted /tmp/claude/tsx-501/25841.pipe
```

The obvious fix is unsafe. On Linux, `srt` cannot allow Unix sockets by path (seccomp cannot filter by path), only all of them (`network.allowAllUnixSockets: true`). That would let agent-written test code connect to any socket the runner user can reach, including Docker's on GitHub's hosted runners, which is root on the runner.

Options:
- **Make `test` not need `tsx`'s IPC.** For example, use `node --test` with Node's built-in type stripping, or a loader registered with `--import` that opens no socket. This changes what the test script runs, and it holds only for repositories that follow suit.
- **Allow sockets only under a private directory on macOS.** The gate would create a temporary directory, add it to `allowWrite` and `allowUnixSockets`, and point the checks' `TMPDIR` at it. That leaves Linux, where the factory runs (TL-6), blocked.
- **Give the checks their own network namespace on Linux without the socket filter.** That is safe only if no host socket is visible inside it. Docker's socket and the runner's own sockets would each have to be denied by path in `denyRead`. Worth testing before relying on it.

Acceptance: the real stop hook, run on a clone of this repository with a correct change, passes `typecheck`, `lint` and `test` on macOS and on an Ubuntu Actions runner. A test written by the agent still cannot reach the network, a host socket, the home directory or the API key file.

Found while rebasing #39 (TL-6) onto TL-5 (#40). Follow-up to TL-5.

````

## Expected outcome

The spec picks the issue's first option and says why the others lose:

- **Goal:** the gate passes this repository's typecheck, lint and test checks with every denial still in place: no network, no Unix sockets, no home directory and no key file.
- **Approach:** change the `test` script so that it does not need tsx's IPC socket, for example `node --import tsx --test` or Node's own type stripping. Allowing Unix sockets is ruled out by name. On Linux, srt can only allow all of them, Docker's included.
- **Acceptance criteria:** the real stop hook passes on a clone of this repository with a correct change. A test written by the agent still cannot reach the network, a host socket, the home directory or the key file. Each criterion says how it is checked.
- **Out of scope:** `network.allowAllUnixSockets`, and any other loosening of the sandbox.

The Ubuntu runner half of the acceptance needs a workflow change under `.github/`, which the factory may not make. A good spec says that this check is one a person runs, or asks about it in a `QUESTION:`. A question about which option to choose is a miss, because the issue and the repository settle that.

Reference: PR #44 changed the test script to `node --import tsx --test`. It then found and fixed four Linux-only failures on a real runner, which no spec written before that run could have named.
