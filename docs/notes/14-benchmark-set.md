# 14: Benchmark set of past issues (TL-14)

## Expected

Ten to twenty closed issues, each with its merged PR, a written expected outcome and the checks that prove it, with at least two per role. The main risk was material. Only one merged PR had been made by the factory (#53 for #52). The other merged PRs were hand-built stage PRs, most of them large. If the history could not supply two cases per role, the plan was to draft small real chores for the owner to file.

The case format was agreed before this stage, because TL-15's harness, built in parallel, reads it. The plan was to keep that format and settle only what it left open.

## Happened

**Ten cases, with implementation one short.** The four tests a case had to pass, and the candidates rejected with reasons, are in `benchmark/README.md`. Three moves made the thin history go further:

- **Triage cases from issues the owner kept away from the factory.** #32, #33 and #35 each needed credentials, a deployment or a security choice outside the repository. Their correct triage outcome is a question, and that is worth testing: a triage agent that passes such an issue on wastes a spec and an implementation run.
- **Review cases from defects known to survive into a merged diff.** The owner's review of #29 filed #33 and #34 as follow-ups instead of fixing them, so the merged diff still holds three known defects. #41 was found only after #40 merged. A reviewer that sees those diffs has something concrete to find.
- **Spec-only replays of stage requirements.** A spec replay is capped at the spec agent's $2 budget, while rebuilding a 275-line stage would cost far more. #11's requirement does not list the columns its own acceptance needs, so a spec has to work them out.

**34-process-group-clone started as the second implementation case and became a spec case.** An independent review of the cases pointed out that at its `base_sha` the `test` script was still `tsx --test`. That is exactly #41's bug: the gate's sandbox denies tsx's socket, so an implement replay could never hand in. The case's own check passed only because it ran outside the gate. Every other implementation candidate branched before #44 fixed the script, or needs a deployment or an Actions runner. So `benchmark/README.md` drafts two small chores, a lint fix and a test that keeps `PLAN.md` in step with `roadmap.ts`. Each has a check that fails on today's `main`. Filing them spends money and writes to GitHub, so they wait for the owner.

The same review corrected several smaller claims and loosened four expectations a scorer could not fairly apply:

- 34's spec need not keep a patch, as long as it decides what is kept.
- 41's spec may ask the owner to choose between the first and third options.
- 5's review is not credited for repeating a gap `ARCHITECTURE.md` already documented.
- 11's extra columns count in a spec's favour rather than against it.

**What the agreed format left open, now settled** (TL-15 follows these; the seven keys and their order are unchanged):

- `pr` may be empty only when the stages stop before `implement`. #55 is the one such case: its only PR was closed unmerged.
- `checks` is one `bash` line, required with `implement` and empty otherwise. A triage, spec or review stage produces a comment, and a command cannot judge a comment.
- `base_sha` is the merge-base with the `main` the PR merged into, not the PR's first parent. #29 and #47 merged `main` in mid-branch. Their first parent would add unrelated commits to the reference diff.
- The issue snapshot is the title alone on the first line, which is the line TL-15 reads as the title. The body follows in a four-backtick fence, because #41's body has its own code fence and the bodies could hold headings.
- A review-only case uses the issue body as its spec. No case has a factory-written spec except #52 and #55, and their cases replay from triage.

**#55's expected outcome is broader than the brief suggested.** The brief treated #55 as a case whose right outcome is a question, since the factory's first triage run asked one. The owner's answer, though, was that the narrower test was wanted, which the issue already allowed. So either the question or a note that names the existing test passes the case. What fails it is not noticing the existing test.

## What the numbers said

| | |
| --- | --- |
| Candidates surveyed | 22 issues (21 closed, plus the open #55), 21 merged PRs. The 11 unbuilt roadmap issues are not candidates. |
| Cases | 10: 1 implement, 3 spec, 4 triage, 2 review |
| Drafted chores for the implementation gap | 2, each with a check that fails on `main` |
| Triage expectations | 3 must stop, 1 may stop or pass on, 1 must pass on (#52's triage stage) |
| With a merged reference PR | 9 of 10 |
| Made by the factory | 2 (#52, #55) |
| Issue snapshots differing from the current issue | 0 (GitHub shows no edits on any of the ten) |
| Checks that fail at `base_sha` and pass on the reference | 1 of 1 |

The implementation row is the weak spot. 52-stage-labels-test's check exits 1 at `e69b9b5` and 0 at the reference merge `948f2a6`. It renames a label in the workflow and requires the tests to fail, so a green suite without the new test does not pass. 34-process-group-clone's old check exited 0 on both its commits, which was the first sign that it was a weak implementation case. Every `base_sha`, `pr` and `files` value was checked against GitHub and `git merge-base`, by a throwaway script that is not committed. The harness that reads the cases belongs to TL-15.

The cost of replaying the set is not known yet. #52's implement and review stages cost $0.09 together, and that is the only measured figure. TL-15's first run will give the rest.
