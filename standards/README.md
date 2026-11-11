# standards

Review comments turned into rules, so a human never leaves the same comment twice (TL-9).

- `rules.md`: the standing rules, `## R-n: Title`, each with its `Source:`. The review agent checks every diff against them.
- `draft.md`: written by `pnpm standards collect`. One entry per human review comment on recently merged pull requests that is not yet a rule's source.

## The loop

1. **Collect.** `pnpm standards collect` reads every pull request merged in the last 7 days (`--since YYYY-MM-DD` for another window, `--repo owner/repo` for another repository) and writes each human reviewer's comment to `draft.md`: inline comments, review summaries and conversation comments. It leaves out the PR's author, bots, empty approvals, and comments already cited as a rule's `Source:`.
2. **Promote.** A human turns each entry worth keeping into a rule in `rules.md` with the next free ID and keeps its `Source:` line, then deletes the draft. A comment about one pull request, not a habit, stays out.
3. **Cite.** The review agent follows `factories/code/skills/cite-standards/SKILL.md`: every finding starts with the rule it applies, `[R-n]`, or `[no rule]`.
4. **Gate.** `pnpm standards check-review <review.md>` exits 1 if a finding cites nothing or an ID that is not in `rules.md`. `[no rule]` findings that keep coming back are the next rules.
