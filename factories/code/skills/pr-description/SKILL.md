---
name: pr-description
description: How a factory pull request explains itself (TL-8). The implementer writes the description from the pull request template; the reviewer checks it against the diff.
---

# Pull request description

Every factory pull request fills in the sections of the repository's pull request template (`.github/pull_request_template.md`), so a reviewer can judge it without rerunning the work.

## Writing it (implementer)

Your final message is the description, from its first heading, with nothing before it. Answer each section's `<!-- -->` hint, then delete the hints. Beyond what the hints say:

- **Risk** uses the words "one-way door" or "two-way door", and "Blast radius". Migrations, deleted or rewritten data, changed public interfaces, and anything published or sent are one-way.
- **Evidence** names each command you ran with its result. For a UI change, say what you looked at, or that nobody has looked at it yet.
- Keep the last line, `Implements TL-n`, only when the issue names a TL requirement.

The stop hook checks Risk and Evidence (`platform/gates/pr-description.ts`). While either is missing, or Risk names no door or no blast radius, it refuses to let you finish. After you fix a failing check, write the whole description again as your final message.

## Checking it (reviewer)

Report each of these as a review finding, citing the section:

- **What was built** leaves out a file or behaviour the diff changes, or claims something the diff does not do.
- **How to try it** cannot be followed from a clean checkout of the branch.
- **Risk** calls a change a two-way door when a revert would not undo it (see the one-way list above), or the blast radius leaves out something the diff touches.
- **Evidence** claims a test or check that the diff or the run's checks do not show; a behaviour change has no test; a UI change has nothing about how it looks.
