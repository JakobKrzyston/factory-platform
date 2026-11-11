---
name: pr-description
description: How a factory pull request explains itself (TL-8). The implementer writes the description from the pull request template; the reviewer checks it against the diff.
---

# Pull request description

Every factory pull request fills in the sections of the repository's pull request template (`.github/pull_request_template.md`), so a reviewer can judge it without rerunning the work.

## Writing it (implementer)

Your final message is the description, starting at its first heading. Fill in every section; delete the `<!-- -->` hints.

- **What was built**: the change in the user's terms, then the files or modules it touches.
- **How to try it**: commands or steps a reviewer can follow from a clean checkout, with what they should see.
- **Risk**: say "one-way door" or "two-way door" and why. Two-way means a plain revert undoes it. Migrations, deleted or rewritten data, changed public interfaces, and anything published or sent are one-way. Then "Blast radius:" and what breaks, and for whom, if the change is wrong.
- **Evidence**: the tests you added or changed and what they cover, and the commands you ran with their results. For a UI change, say what you looked at, or that nobody has looked at it yet. Claim only what you ran in this run.
- Keep the last line, `Implements TL-n`, only when the issue names a TL requirement. Otherwise delete it.

`scripts/run-issue.sh` checks the Risk and Evidence sections (`platform/gates/pr-description.ts`). If either is missing, or Risk names no door or no blast radius, the pull request still opens but the issue goes to `factory:needs-human`, not `factory:in-review`.

## Checking it (reviewer)

Report each of these as a review finding, citing the section:

- **What was built** leaves out a file or behaviour the diff changes, or claims something the diff does not do.
- **How to try it** cannot be followed from a clean checkout of the branch.
- **Risk** calls a change a two-way door when a revert would not undo it (see the one-way list above), or the blast radius leaves out something the diff touches.
- **Evidence** claims a test or check that the diff or the run's checks do not show; a behaviour change has no test; a UI change has nothing about how it looks.
