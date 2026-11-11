# 06: A label-driven work queue on GitHub Actions (TL-6)

## Expected

Adding `factory:ready` to an issue in this repository starts `.github/workflows/factory.yml`. The workflow runs TL-4's `scripts/run-issue.sh` on an Actions runner and reports back on the issue through its one `factory:*` label. The design is in `platform/queue/README.md`. Each acceptance criterion maps to a mechanism:

| Acceptance | Mechanism |
| --- | --- |
| Every state transition is a label change, visible in the timeline | `platform/queue/queue.ts set` adds the new state's label and removes every other `factory:*` label, using the factory App's token. The timeline shows the App adding one label and removing the other. |
| A run that hits a question stops with `needs-human` and a comment stating the question | The system prompt tells the agent to end with `QUESTION:` instead of guessing. `run-issue.sh` then opens no PR and exits 3 with the question on stdout. The workflow quotes it in a comment, then sets `needs-human`. Failures and timeouts also end at `needs-human`, with a comment saying which. |
| Two runs on the same issue cannot happen at once | Job concurrency grouped by issue number, never cancelling a run in progress: GitHub runs at most one at a time. A waiting run claims the issue only if it is still open and `factory:ready`, so a duplicate does nothing. |

Two things had to change for the factory to run on this repository rather than on factory-sample:

- **#33**: the factory pushes its branches here, so CI on its PRs runs agent-written code. The Anthropic key and the App key are therefore secrets of a `factory` environment that deploys from `main` only. No workflow on `push` or `pull_request` names a repository secret.
- **Linux sandbox**: Claude Code sandboxes Bash with bubblewrap and socat on Linux. Ubuntu 24.04's AppArmor default blocks the user namespaces bubblewrap needs, and Claude Code's own error message gives the `sysctl` fix the workflow applies. `sandbox.failIfUnavailable` turns a missing sandbox into a failed run instead of unsandboxed Bash. On Linux the sandbox gives Bash its own PID namespace and `/proc` (`--unshare-pid`, `--proc /proc` in the bubblewrap arguments), so the agent cannot read the token in the script's environment.

The human answers in a comment. Only comments from the owner, members and collaborators reach the next prompt, because those are the people who can add the label, plus the factory App's own question, which GitHub reports with author association `NONE`. Anyone else's comments stay out.

Review of the PR found three things the runner changes:
- The script's post-run git commands, which run unsandboxed and now hold the App token, used a `.git` inside the clone the agent could edit. The git metadata now lives outside the clone.
- A failed claim was hidden inside `echo "claimed=$(…)"`, so the step stayed green. It is now assigned first, and a failed claim also reports to `needs-human`.
- The prompt was passed as one argument, which Linux caps at 128 KiB. It now goes in on stdin.

TL-5's quality gate merged first. Combining the two needed three changes beyond the textual merge:
- TL-5's stop hook would have refused a `QUESTION:` stop while any check failed. It now lets one through without running the checks, since a question opens no PR.
- The gate runs the clone's own `tsc`, `biome` and `tsx`, and TL-5 left installing them to TL-6. `run-issue.sh` now runs `pnpm install --frozen-lockfile --ignore-scripts` in the clone before the agent starts, with only `PATH` and `HOME`.
- The gate's `srt` sandbox needs ripgrep on Linux as well as bubblewrap and socat, so the runner installs all three.

## Happened

Before merge, without a runner (GitHub runs `issues` workflows only from the default branch):

- `queue.ts` label arithmetic and claim rule: 7 unit tests, `pnpm test`.
- `run-issue.sh`, using a stub `claude` that returns a scripted result, against factory-sample issue #1 (clone and read only):
  - A result starting `QUESTION:` exits 3 with the question on stdout and records `question` in `run.json`.
  - An ordinary summary with no changes exits 1.
  - `QUESTION:` in the middle of a summary is not a question.
  - The stub also showed that `env -i` stripped its own environment variables.
- The comment filter kept the owner's and a collaborator's comments and dropped one from an outsider (`authorAssociation` `NONE`).
- The workflow's "Run the agent" step, using stubs for the script and `pnpm`: exit 0 sets `in-review`, exit 3 posts the quoted question and sets `needs-human`, and exit 1 posts the failure comment, sets `needs-human` and fails the job.
- `pnpm queue` on a throwaway issue against the real API ([factory-sample#9](https://github.com/JakobKrzyston/factory-sample/issues/9), using the owner's `gh` login, not the App):
  - `claim` refused an issue without `factory:ready`, then took it to `in-progress`, then refused the duplicate.
  - `set needs-human` posted the comment before the label appeared in the timeline.
  - Re-adding `factory:ready` alongside `needs-human` was claimed, and the stale label was removed.
  - `in-review` and `done` each left exactly one `factory:*` label and kept the unrelated `bug` label. A repeated `set done` changed nothing.
  - The timeline shows all 15 label and comment events.
- After review, using the same stub:
  - The prompt arrives on stdin.
  - The clone's `.git` is a pointer to a directory outside it.
  - An edit under `.github/` still counts as a workflow change and opens no PR.
  - A local commit through the outside git directory includes the agent's files.
  - The comment filter keeps the App's question when `FACTORY_BOT` is set and drops other bots.
  - `claude -p` read a real prompt from stdin.
- After rebasing onto TL-5:
  - The new hook let a `QUESTION:` stop through without writing a gate line; TL-5's hook blocked the same stop with exit 2.
  - An ordinary stop with a failing check is still blocked.
  - Run against a fresh clone of this repository with its dependencies installed, the real stop hook passed `typecheck` and `lint`.
  - `test` failed with `listen EPERM` on `tsx`'s IPC pipe: the checks' sandbox denies Unix sockets. Until that is fixed (#41), factory runs here end at `needs-human`, not `in-review`.
- Not yet checked: the workflow on a real runner (bubblewrap under the AppArmor change, the App's commit identity, the App token's permissions for the label calls) and the three acceptance criteria end to end.

## What the numbers said

Pending the first live runs after merge: a small issue through to `in-review`, an ambiguous one to `needs-human` and back, and `factory:ready` added twice in a row to show the second run stopping at the claim.
