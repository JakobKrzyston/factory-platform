# 09: Review comments become standing rules (TL-9)

## Expected

A human should never have to leave the same review comment twice. Each acceptance criterion maps to a mechanism:

| Acceptance | Mechanism |
| --- | --- |
| A script collects review comments from merged PRs into a draft rules file | `pnpm standards collect` appends one entry per human review comment on PRs merged in the last 7 days to `standards/draft.md`. It skips comments already linked from `rules.md`, `rejected.md` or the draft. A human promotes each entry to a rule or rejects it. |
| The review agent cites the rule it applied when it flags a finding | Guidance: `run-issue.sh review` appends the `cite-standards` skill and `rules.md` to the reviewer's prompt. The skill asks for `- [R-n] path:line — severity: text`, or `[no rule]`, under `## Findings`. Gate: a Stop hook refuses the agent's finish while a finding cites nothing or an unknown ID. The script then checks the final review again and posts nothing if it fails. |

The review agent itself is TL-7's (#51), built in parallel, and the two stages agreed the findings format up front. Review of this PR asked for the gate to be wired into the real run (rule 3: guidance plus gates). So this branch is stacked on TL-7's and merges after it, and it does the wiring.

## Happened

**One file.** `platform/standards/standards.ts` holds four functions plus the CLI:

- `humanComments`: which comments count.
- `draftRules`: the draft.
- `checkReview`: the citation check.
- `reviewVerdict`: the Stop hook.

It adds no dependency.

**What counts as a review comment:** inline review comments, review summaries and conversation comments on merged PRs. The PR's author, bots and empty approvals are left out. A deleted account's comments are kept as `ghost`. The author rule matters here: the owner opens and merges every PR in this repository, so none of the 16 merged PRs has a comment from anyone but its author. Once the factory's App opens PRs, the owner's comments on them are exactly what is collected.

**The script drafts and a human decides.** The live check below shows why. A week of `cli/cli` gave "LGTM", a bare commit hash and an empty checklist alongside one real habit ("print the error like the others"). A rule is applied to every future diff, so a person picks it.

**`rules.md` starts with four rules from `CLAUDE.md`:** secrets, factories are data, one idea per PR, and re-render the plan. They are the comments the owner wrote down before any review happened. The reviewer runs with `--setting-sources ""` in a clone of the target repository, so it never sees `CLAUDE.md` or `standards/` unless the run passes them in.

**Rule IDs are never reused**, and `parseRules` refuses a duplicate, so a citation in an old review still means one thing.

Checked:

- **28 unit tests** (`pnpm test`, 84 in all, including TL-7's), as of the review fixes below.
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

  Every run also found the off-by-one, as `[no rule]`. A review with an uncited finding failed the gate with exit 1. These runs used the skill as first written. Rechecked with the fixed gate, run 1 fails: it put untagged detail in nested bullets, which now count as findings. In a real run the Stop hook would refuse that review and ask for a rewrite. The skill now says to write detail as indented prose.

**Self-review changed two things.** De-duplication was a substring test, so a rule citing `...pullrequestreview-1234` would have hidden a new comment `...pullrequestreview-123`; it now compares whole URLs, with a test that failed before. A mistyped flag such as `--repos` was ignored and fell back to the default; it is now refused.

**Code review on #49 found ten problems, all fixed here.** Each logic fix has a test. Run against the code as first opened, every one of those tests failed: the scenarios were replayed on a copy of that commit.

1. **Nested bullets and a second `## Findings` section got past the gate.** `- [no rule] several:` with an uncited `  - a.ts` under it passed, because indented lines counted as continuation. Now every list item in the section, nested or not, is a finding. A second section is refused.
2. **A review with CRLF line endings always failed.** It was reported as having no section. Line endings are now normalized before parsing, for reviews, comments and `rules.md`.
3. **The section boundary was fragile.** The section ran to the next `## ` line or the end of the review. So a closing "Overall: approve.", a horizontal rule, an h1 or `## Findings (2)` failed, and a `## ` line inside a code fence cut the section short. Now:
   - the section runs to the next heading or horizontal rule;
   - prose inside it is allowed;
   - fenced lines are skipped;
   - a suffixed heading counts.
4. **Collect overwrote `draft.md`.** Edits were lost, and a rejected comment came back every run. Collect now only appends, and skips comments linked from the draft or from `rejected.md`, a new file for turned-down comments.
5. **`Source: https://x/1.` did not match `https://x/1`.** Links are now matched as whole URLs without trailing punctuation.
6. **Comments written in GitHub's web UI left a stray `\r`** in drafted titles and quotes. They are normalized, as in 2.
7. **The skill promised a gate that nothing ran.** It also pointed the reviewer at `standards/rules.md`, which the target clone does not have. `run-issue.sh review` now:
   - appends the skill, moved under `agents/review/skills/` because only the reviewer uses it, and `rules.md` to the reviewer's system prompt;
   - installs `standards.ts review-hook` as the role's Stop hook, which logs to `gates.jsonl`, so `gate_attempts` and `gate_failures` now count review attempts too;
   - runs `check-review` on the final review before posting;
   - takes `review_findings` from that check instead of its own `awk` count.

   `agent.md`'s format line now asks for `[R-n]` or `[no rule]`.
8. **`--since` went into the search qualifier unchecked.** It must now be a real `YYYY-MM-DD` date. `--repo` must be `owner/repo`.
9. **The flag parser was hand-written.** It is now `node:util` `parseArgs` with `strict: true`, so `--repos` is refused instead of ignored.
10. **Collect made three blocking `gh api` calls per PR, one after another.** They now run concurrently, at most 8 at a time. On `cli/cli` since 2026-11-01 (23 PRs, 69 calls), the run took 33.6 s before and 2.7 s after, with the same 7 comments.

Checked after the fixes, with real `claude` and a `gh` shim, on factory-sample#3 and its PR #6. The shim served the PR as open plus a spec comment, and captured the comment instead of posting it. This is TL-7's method:

| Check | Result |
| --- | --- |
| `run-issue.sh review`, real Sonnet | exit 0. The real Stop hook ran once and passed. 2 `[no rule]` findings, `review_findings` 2, $0.04. |
| Reviewer's system prompt | `agent.md`, then the skill without its front matter, then all 4 rules |
| Block path, real `claude -p` with the hook, told to answer with an uncited bullet | Refused (`passed: false`), the model rewrote it as `[no rule]`, then passed. 2 turns, $0.02. |
| `run-issue.sh review` with a stub `claude` whose final review is uncited | exit 1, row `failed`, nothing posted, the error in `check-review.txt` |
| Collect run twice on the same window | 7 new, then 0 new. The draft was unchanged. |

Known gaps:

- **Not yet run on a real runner.** The wiring has run only locally: TL-7's chain has not run on Actions (see its note), and this branch merges after it.
- **A reviewer's `QUESTION:` is no longer posted.** TL-7 posted it as the review. It has no `## Findings` section, so the Stop hook now refuses it and the agent has to write a review. After 5 refusals the run fails without posting.
- **The rules are the factory's, not the target repository's.** Every target gets this repository's `rules.md`, including R-4, which is about this repository's roadmap.
- **The retro step is manual.** The plan's "a retro step proposes new rules from the week's comments" is the 7-day default window plus a human. No agent proposes rule text yet, and nothing runs `collect` on a schedule.
- **Recurring `[no rule]` findings are not collected.** They come from the agent's review, not from human comments, so they are not in the draft.
- **The citation is checked, not its truth.** The gate proves a cited rule exists, not that the finding actually breaks it. That is for the benchmark (TL-14 on).

## What the numbers said

| Measure | Value |
| --- | --- |
| Code | 1 file, 3 CLI commands (`collect`, `check-review`, `review-hook`), no new dependency |
| Tests | 28 for standards; 84 pass |
| Collect on `cli/cli`, 23 PRs | 33.6 s before the review fixes, 2.7 s after |
| Human review comments in this repository's history | 0 |
| Stand-in reviewer: findings that broke a rule and cited it | 6 of 6 |
| Stand-in reviewer: citations of an ID that does not exist | 0 of 22 findings |

The first number is the honest one. Until the factory opens PRs that someone other than their author reviews, the collector has nothing of this repository's to collect.
