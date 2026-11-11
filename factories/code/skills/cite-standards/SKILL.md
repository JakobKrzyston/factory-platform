---
name: cite-standards
description: Report review findings against the standing rules in standards/rules.md, citing the rule each finding applies. Use when reviewing a pull request.
---

# Cite the standing rules

`standards/rules.md` holds the rules a human reviewer has already had to state. Each is a `## R-n: Title` heading. Check the diff against every rule before anything else: a human should never have to leave the same comment twice.

End your review with a `## Findings` section. Each finding is one bullet that starts with the rule it applies in square brackets:

```
## Findings

- [R-1] `.env.sample:4` — blocker: commits a real API key.
- [no rule] `platform/queue/queue.ts:40` — major: reads the labels before the claim, so two runs can both claim.
```

- Cite the rule the finding applies, by its exact ID. Cite only rules that are in `standards/rules.md`; never invent an ID.
- Use `[no rule]` for a finding no rule covers. Those are how new rules are found, so do not hold one back because no rule names it.
- One finding per bullet. Indent any further lines of the same finding.
- With no findings, the section holds only `None.`

The run checks the section with `pnpm standards check-review`, and refuses a review with a finding that cites nothing or cites an ID that does not exist.
