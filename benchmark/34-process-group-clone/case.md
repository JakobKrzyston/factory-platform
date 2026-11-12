---
issue: 34
pr: 43
base_sha: 787db5dc213fd7d17eb7f0381b909dd2a1494bdf
role: spec
stages: spec
files: scripts/run-issue.sh,docs/ARCHITECTURE.md
checks:
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

The spec settles both of the issue's open points, so that the implementer has nothing left to decide:

- **The time limit kills the whole process group.** When the limit passes, `claude`'s whole process group is killed, not just `claude`. The time-out keeps an exit status that `run.json`'s `timed_out` can recognise. A spec that also covers `claude` exiting normally and the script being interrupted is better. The approach has to work on macOS, which has neither `timeout(1)` nor `setsid(1)`.
- **What is kept is decided.** The clone and its outside git directory are deleted when the script exits. The spec states what survives. The reference keeps the agent's changes as a patch in the run directory, so a run that opened no PR still shows what it did. A spec that decides the transcript and PR are enough also passes, if it says so. A spec that leaves "what to keep" open is a miss.
- **Acceptance says how the time-out is checked.** For example: a stub command with a child and a grandchild leaves no process behind after the limit. Nothing in the repository exercises it otherwise.

This is a spec case, not an implementation case. At `base_sha` the `test` script is `tsx --test`, which the gate's sandbox cannot run (#41, fixed by #44 from the same commit). So an implement replay from here could never pass the gate.

Reference: PR #43, 30 lines added and 7 removed, and its Evidence section. A wrapper run with a child and a grandchild exited 142 with no process left. A separate run of a scratch copy of the script, with real Claude Code and then a stub, left no clone behind.
