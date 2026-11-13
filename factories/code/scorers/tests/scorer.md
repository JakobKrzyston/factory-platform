---
measure: tests
---
Did the tests the issue needed pass? 1 if the case's `checks` line exits 0 on the case's base with the patch the implement run handed off, 0 if it does not.

It grades implement runs of cases that have `checks`. A run that handed off no patch, because it asked a question or failed, scores 0: the factory delivered nothing that passes. The checks run in the gate's sandbox, in a fresh clone of the base, with the base's dependencies and the base's `package.json` scripts, so a patch cannot make them pass by rewriting what `pnpm test` runs.

This is not implement's own gate (`checks_passed`). The gate runs the repository's typecheck, lint and test scripts; the case's checks also prove the outcome the issue asked for, and can refuse a shortcut, such as a suppressed lint rule.

The reason gives how long the checks took, or the last line they printed when they failed.
