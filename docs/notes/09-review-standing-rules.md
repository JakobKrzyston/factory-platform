# 09: Review comments become standing rules (TL-9)

## Expected

A human should never have to leave the same review comment twice. Each acceptance criterion maps to a mechanism:

| Acceptance | Mechanism |
| --- | --- |
| A script collects review comments from merged PRs into a draft rules file | `pnpm standards collect` writes one entry per human review comment on PRs merged in the last 7 days to `standards/draft.md`, skipping comments already cited as a rule's `Source:`. A human promotes entries to `standards/rules.md`. |
| The review agent cites the rule it applied when it flags a finding | Guidance: the `cite-standards` skill asks for `- [R-n] path:line — severity: text`, or `[no rule]`, under `## Findings`. Gate: `pnpm standards check-review` fails a review with a finding that cites nothing or an unknown ID. |

The review agent itself is TL-7's, built in parallel. The two stages agreed the findings format up front. TL-7's reviewer writes it, and whichever of the two merges second wires `rules.md`, the skill and the gate into `factories/code/agents/review/agent.md`.

## Happened

**One file, three exports.** `platform/standards/standards.ts` holds `humanComments` (which comments count), `draftRules` (the draft) and `checkReview` (the gate), plus the CLI. It reuses `gh` from `queue.ts` and adds no dependency.

**What counts as a review comment:** inline review comments, review summaries and conversation comments on merged PRs. The PR's author, bots and empty approvals are left out. A deleted account's comments are kept as `ghost`. The author rule matters here: the owner opens and merges every PR in this repository, so none of the 16 merged PRs has a comment from anyone but its author. Once the factory's App opens PRs, the owner's comments on them are exactly what is collected.

**The script drafts and a human decides.** The live check below shows why. A week of `cli/cli` gave "LGTM", a bare commit hash and an empty checklist alongside one real habit ("print the error like the others"). A rule is applied to every future diff, so a person picks it.

**`rules.md` starts with four rules from `CLAUDE.md`:** secrets, factories are data, one idea per PR, and re-render the plan. They are the comments the owner wrote down before any review happened. The reviewer runs with `--setting-sources ""` in a clone of the target repository, so it never sees `CLAUDE.md` or `standards/` unless the run passes them in.

**Rule IDs are never reused**, and `parseRules` refuses a duplicate, so a citation in an old review still means one thing.

Checked:

- **14 unit tests** (`pnpm test`, 56 in all): the comment filter (author, bots, empty, null body, outdated inline line, deleted account), the draft (quoting, place, source, de-duplication against `rules.md` by whole URL, long titles, entries that are not yet rules), and the gate (known rule, `no rule`, indented continuation lines, `None.`, unknown ID, malformed ID, uncited line, missing or empty section).
- **The collector against GitHub:**

  | Repository | Window | Merged PRs | Human comments |
  | --- | --- | --- | --- |
  | factory-platform | all time | 16 | 0 (all by the PR's author) |
  | factory-sample | all time | 0 | 0 |
  | cli/cli (public, read only) | 2026-11-04 to 11 | 18 | 7: 3 inline, 3 review summaries, 1 conversation; dependabot left out |

- **Citations from a stand-in reviewer.** TL-7's agent is not on `main` yet. Instead, a headless `claude -p --setting-sources ""` with only the skill, `rules.md`, a spec and a diff ran 3 times on a diff that commits a token (R-1), puts queue code under `factories/` (R-2), and has an off-by-one. It then ran once on a control diff that breaks no rule.

  | Diff | Runs | Cited R-1 | Cited R-2 | Unknown IDs | Passed the gate |
  | --- | --- | --- | --- | --- | --- |
  | Breaks R-1 and R-2 | 3 | 3 | 3 | 0 | 3 |
  | Breaks no rule | 1 | 0 | 0 | 0 | 1 (3 findings, all `[no rule]`) |

  Every run also found the off-by-one, as `[no rule]`. A review with an uncited finding failed the gate with exit 1.

**Self-review changed two things.** De-duplication was a substring test, so a rule citing `...pullrequestreview-1234` would have hidden a new comment `...pullrequestreview-123`; it now compares whole URLs, with a test that failed before. A mistyped flag such as `--repos` was ignored and fell back to the default; it is now refused.

Known gaps:

- **No reviewer cites a rule in production yet.** That needs the wiring agreed with TL-7.
- **The retro step is manual.** The plan's "a retro step proposes new rules from the week's comments" is the 7-day default window plus a human. No agent proposes rule text yet, and nothing runs `collect` on a schedule.
- **Recurring `[no rule]` findings are not collected.** They come from the agent's review, not from human comments, so they are not in the draft.
- **The citation is checked, not its truth.** The gate proves a cited rule exists, not that the finding actually breaks it. That is for the benchmark (TL-14 on).

## What the numbers said

| Measure | Value |
| --- | --- |
| Code | 1 file, 2 CLI commands, no new dependency |
| Tests | 14 new; 56 pass |
| Human review comments in this repository's history | 0 |
| Stand-in reviewer: findings that broke a rule and cited it | 6 of 6 |
| Stand-in reviewer: citations of an ID that does not exist | 0 of 22 findings |

The first number is the honest one. Until the factory opens PRs that someone other than their author reviews, the collector has nothing of this repository's to collect.
