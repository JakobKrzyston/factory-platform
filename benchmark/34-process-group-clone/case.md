---
issue: 34
pr: 43
base_sha: 787db5dc213fd7d17eb7f0381b909dd2a1494bdf
role: implement
stages: spec,implement,review
files: scripts/run-issue.sh,docs/ARCHITECTURE.md
checks: bash -n scripts/run-issue.sh && pnpm typecheck && pnpm lint && pnpm test
---
## Issue

run-issue.sh: time limit leaves child processes running; clones are never removed

````markdown
Two loose ends in `scripts/run-issue.sh`, both harmless for one manual run and real once TL-6 runs it in a loop:

- The time limit is `perl alarm`, which signals only the `claude` process. A sandboxed command the agent started (a hung test, a watcher) keeps running after the limit. Run `claude` in its own process group and kill the group. The time-out path has not been exercised yet.
- Each run's clone under `mktemp -d` is kept (its path is in `run.json`) and never removed. Decide what to keep, since the transcript and PR already hold the work, and delete the rest, or rely on throwaway runners.

Found in review of PR #29 (TL-4).

````

## Expected outcome

- **Spec** settles both of the issue's open points. When the time limit passes, `claude`'s whole process group is killed, not just `claude`, and the time-out keeps an exit status `run.json`'s `timed_out` can recognise. The clone and its outside git directory are deleted when the script exits. Before that, the agent's changes are kept in the run directory as a patch, so a run that opened no PR still shows what it did.
- **Implement** does this portably. macOS has neither `timeout(1)` nor `setsid(1)`, so the reference uses a small perl wrapper. It also kills the group when `claude` exits normally and when the script is interrupted, and it deletes the clone from the existing `EXIT` trap. Nothing else in the script changes behaviour.
- **Review** has no blocking finding.

The checks prove only that the script still parses and that the existing suite passes. They pass at `base_sha` too, because nothing in this repository runs `run-issue.sh` without real GitHub and Claude Code. The behaviour is judged against the reference PR's own evidence: a wrapper run with a child and a grandchild leaves no process behind after the time-out, exits 142, and the clone directory is gone. This is the benchmark's weakest implementation case (see the README).

Reference: PR #43, 30 lines added and 7 removed.
