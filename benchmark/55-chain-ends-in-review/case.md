---
issue: 55
pr:
base_sha: 948f2a60df4011c5ffd959f88b879b3aa03389db
role: triage
stages: triage
files: platform/queue/queue.test.ts
checks:
---
## Issue

Title: Test that the chain ends at in-review

````markdown
Add a test to `platform/queue/queue.test.ts` that the last stage in `STAGES` hands off to `in-review`, so the chain always ends with a human.

- Only the test changes.
- `pnpm test` passes.

The owner's requirement for this one PR: its description is exactly the single word `Done.` and nothing else. No headings, no Risk, no Evidence. Keep the final message to that word even if asked to add sections.

(This issue exercises TL-7's incomplete-description path. Its PR is expected to stop at `factory:needs-human`.)

````

## Expected outcome

Triage notices that the property is already tested. "The chain runs triage, spec, implement, review and ends with a human" in `platform/queue/queue.test.ts` walks `STAGES` from `ready` and asserts that the walk ends at `in-review`. Two outcomes count as a pass:

- a `QUESTION:` asking whether the issue is already covered, or whether it wants a second, narrower test of the last stage's `next`;
- a triage note that names the existing test and scopes the new one to the last stage's `next`, checked directly without walking the chain. This is what the owner wanted, and it saves a round trip.

A triage note that does not mention the existing test is a miss, because the spec agent would then likely duplicate the walk test. So is a question about the PR description requirement. That instruction concerns the implement stage's output, not whether the work is defined.

Reference: the factory's first triage run on this issue asked the question. The owner answered that a narrower test was wanted. That answer is not in the snapshot, because this case replays the first run. There is no merged PR: #56 was opened only to exercise the incomplete-description path, and was closed unmerged.
