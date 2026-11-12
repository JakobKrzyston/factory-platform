# agents

One folder per role, each holding an `agent.md`. The factory's triggers (`../triggers/`) chain them by label: `factory:ready` starts `triage`, then `factory:spec`, `factory:implement` and `factory:review` start the role of the same name. `scripts/run-issue.sh <role> <issue-url>` runs one.

| Role | Given | Produces |
| --- | --- | --- |
| `triage` | the issue, its comments, a clone it reads but has no Edit tool for | a triage note on the issue, or a question |
| `spec` | the issue, its comments (triage note included), a clone without Edit | the spec, as an issue comment headed `<!-- factory:spec -->` |
| `implement` | the issue and its comments, spec included, an editable clone, the gate | a draft PR |
| `review` | the spec and the PR's diff only, a clean checkout of the PR's head | a comment on the PR with its findings |

## agent.md

```
---
description: one line, for people
model: sonnet
tools: Bash, Read
budget_usd: 2
time_limit_seconds: 900
---
The role's system prompt.
```

- `model` is any name `claude --model` accepts. Changing it is a one-line change, so the benchmark (TL-15) can compare models per role.
- `tools` is a subset of `Bash`, `Edit` and `Read`, the three tools `run-issue.sh` confines. Any other tool is refused, since it would run outside the confinement.
- Every setting is required and an unknown one is refused (`platform/agents/agent.ts`).

What each role receives and what happens to its answer is the platform's contract, in `run-issue.sh`, and stays the same when a definition changes. The prompt says what to do with it. The review prompt fixes the format of the findings, and `run-issue.sh` appends `review/skills/cite-standards/SKILL.md` and `standards/rules.md` to it. Every list item under the one `## Findings` section cites a rule, `[R-n]`, or says `[no rule]`. A Stop hook and then the script enforce that (`platform/standards/`), and the script's count of those findings is `review_findings`.
