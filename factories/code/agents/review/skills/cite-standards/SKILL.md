---
name: cite-standards
description: Report review findings against the standing rules, citing the rule each finding applies. Used by the review agent.
---

# Cite the standing rules

The standing rules follow these instructions. They are `standards/rules.md` from the factory's repository, which is not in your checkout. Each is a `## R-n: Title` heading, and each is a comment a human reviewer has already had to make. Check the diff against every rule before anything else, so that nobody has to make the same comment twice.

End your review with a `## Findings` section. Each finding is one list item that starts with the rule it applies, in square brackets:

```
## Findings

- [R-1] `.env.sample:4` — blocking: commits a real API key.
- [no rule] `platform/queue/queue.ts:40` — should fix: reads the labels before the claim, so two runs can both claim.
  Indented prose under a finding is fine. A nested bullet is not: it counts as a finding of its own.
```

- Cite the rule the finding applies, by its exact ID. Cite only rules listed below, and never invent an ID.
- Use `[no rule]` for a finding no rule covers. New rules come from these, so do not leave one out because no rule names it.
- Write one finding per list item, with any further detail as indented prose under it.
- Use exactly one `## Findings` section. If there are no findings, it holds only `None.`

A gate checks the section each time you try to finish. Your last message is the review. The gate refuses it while any list item under `## Findings` lacks a tag, or a tag names a rule that does not exist. If it refuses, write the whole review again as your last message.
