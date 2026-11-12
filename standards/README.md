# standards

Review comments turned into rules, so a human never leaves the same comment twice (TL-9).

- `rules.md`: the standing rules, `## R-n: Title`, each with its `Source:`. The review agent checks every diff against them.
- `rejected.md`: links to drafted comments that were turned down, each with a reason.
- `draft.md`: appended to by `pnpm standards collect`, with one entry per human review comment not yet decided. It exists only while entries are waiting.

## The loop

1. **Collect.** `pnpm standards collect` reads every pull request merged in the last 7 days. `--since YYYY-MM-DD` sets another window and `--repo owner/repo` another repository. It appends each human reviewer's comment to `draft.md`: inline comments, review summaries and conversation comments. It leaves out:
   - the PR's author, bots and empty approvals;
   - comments already linked from `rules.md`, `rejected.md` or the draft itself.

   It never rewrites what is already in the draft.
2. **Decide.** For each entry, a human does one of two things, then deletes the entry from the draft:
   - turns it into a rule in `rules.md` with the next free ID, keeping its `Source:` line;
   - adds its link to `rejected.md` with a reason.

   An entry deleted without either comes back on the next collect that reaches its PR.
3. **Cite.** `scripts/run-issue.sh review` appends `factories/code/agents/review/skills/cite-standards/SKILL.md` and `rules.md` to the reviewer's prompt, since the reviewer works in a clone of the target repository. Every list item under the review's `## Findings` must start with `[R-n]` or `[no rule]`.
4. **Gate.** The review role's Stop hook (`standards.ts review-hook`) refuses to let the agent finish while its findings break that format, up to 5 times. Then the script runs `pnpm standards check-review` on the final review and posts nothing if it fails. `[no rule]` findings that keep coming back are candidates for the next rules.
