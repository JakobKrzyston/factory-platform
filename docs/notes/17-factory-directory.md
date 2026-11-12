# 17: Factory definition as a directory (TL-17)

## Expected

The code factory should be fully described by `factories/code/`, with nothing about its roles, labels or chain left in `platform/` or the workflow beyond reading that directory. Behaviour should not change.

| Acceptance | Mechanism |
| --- | --- |
| The first factory is moved into this layout with no behaviour change (benchmark proves it) | `factories/code/factory.yaml` and `triggers/{ready,spec,implement,review}/` replace TL-7's `STAGES`, the label list the workflow copied from it, and the workflow's per-role comment wording. `platform/factory/factory.ts` reads them. Proof: identical comments, labels and calls against `main` (below) now; the benchmark once TL-15 exists. |
| A README documents every file and field | `factories/README.md`, with `factories/code/README.md` for this factory's chain. |

## Happened

**The format.** `factory.yaml` has two fields, `repositories` and `foreman`. Each `trigger.yaml` has `on`, `label`, `agent`, `next`, `color` and `description`, and `comment.md` beside it is the success comment. `implement/question.md` holds the one line implement's questions add. The starting sketch also had `name` and `defaults` (harness, model). Both were dropped: the folder is the name, every `agent.md` already must set its model, and there is one harness. `color` and `description` were added because `queue setup` creates the trigger labels. The reasons are in `docs/ARCHITECTURE.md`.

**The foreman** is the agent of the entry trigger, the one trigger no other leads to, and the reader checks that `foreman` names it. While the queue dispatches by label, that is triage.

**The reader checks what the queue relies on.** Each trigger's agent has an `agent.md`, labels are unique and start with `factory:`, each `next` is another trigger's label or `factory:in-review`, no chain loops, and there is exactly one entry trigger. TL-7 got "the chain ends at `in-review`" from a TypeScript type; it is now a runtime check, with a test for each refusal. Everything else (secrets in files, scorers referenced) is left to TL-20's validator.

**The workflow routes first.** An Actions `if` cannot read a file, so the hardcoded label list became a `route` job. It fires on any `factory:*` label, runs `queue route`, and the `run` job starts only if a trigger matched. The `route` job sits outside the `factory` environment and the per-issue concurrency group. This matters because GitHub keeps only the newest waiting run in a group, so the App's own `in-progress` label could otherwise displace a queued stage. The 40-line per-role `case` in the run step became one `queue report` call, which words the comment from the trigger's files and moves the issue.

**`run-issue.sh`** changed only in paths: the shared pr-description skill is read from `factories/$FACTORY/`. TL-15 makes `FACTORY` selectable, so this branch left line 30's `FACTORY=code` alone, and the workflow passes `FACTORY` ready for it. The script still branches on the four role names for inputs and publishing, which is TL-18's to move.

**Checked against `main`, with a fake `gh` that records every call** (scripts in the session's scratch area, not committed):

- **Comments.** The old run step's bash, fed the same `run-issue.sh` output, against `queue report`. The cases were success for all four roles, a question from triage, implement and review, an incomplete description, exit 1 and exit 137. All 10 gave byte-identical comments and the same target label.
- **`claim` and `set`.** Old CLI with state names against new with labels, on a fresh claim, a stale claim, a wrong-stage claim, `set needs-human` with a comment, and `set spec`. The `gh` calls were identical.
- **`setup`.** The same eight labels, colours and descriptions, except one. `factory:in-review`'s description now reads "The factory's last agent has handed its pull request to a human, who reviews and merges it." The old text named the review agent in `platform/`. This is the only visible difference.
- **Tests.** `pnpm typecheck`, `lint` and `test` pass (124 tests). A new test fails if `factory.yml` names any trigger's label outside a comment; `main`'s workflow has three such lines.

**Not checked here.** The workflow itself. `issues` events run the workflow file from `main`, so the `route` job and the `needs` wiring first run after merge. The YAML parses, and the jobs are `route`, `run` (needing `route`) and `done`.

## What the numbers said

Owed: the benchmark comparison. TL-15's `pnpm bench` is not merged yet, and TL-14's cases neither. Once both are, bench the ref before this branch (`main` at `5d7abe9`) against this branch's head, and record here what was expected, what happened and what the numbers said. The expectation is no difference beyond run-to-run noise. The agents, prompts, models and `run-issue.sh` behaviour are unchanged, and the benchmark replays `run-issue.sh`, not the workflow.

Cost of the routing: one short `route` job for every `factory:*` label added. An issue that goes through the whole chain gets nine: four trigger labels, four `in-progress` and one `in-review`. Five of those start nothing; under TL-7 they cost no runner. Each stage also starts about half a minute later, while `route` installs dependencies. The first live run will show the real figures.
