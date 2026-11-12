# 08: Pull requests that explain themselves (TL-8)

## Expected

Every factory PR states what changed, how to try it, its risk (one-way or two-way door) and blast radius, and its evidence. Design rule 3 asks for guidance and a gate together. The design is in `docs/ARCHITECTURE.md`, under "A pull request states its risk and evidence".

| Acceptance | Mechanism |
| --- | --- |
| The implementer fills in the PR template, and the reviewer checks it | One template for people and the factory: `.github/pull_request_template.md`, with its hints turned into HTML comments. One shared skill, `factories/code/skills/pr-description/SKILL.md`, says how to write each section and what a reviewer reports against it. `run-issue.sh`, today's implementer, puts the skill and the template in its system prompt. |
| A PR missing the risk or evidence sections is labelled `needs-human`, not `in-review` | The stop hook runs `platform/gates/pr-description.ts` on the agent's final message and refuses the stop while Risk or Evidence is missing. If the hook gives up after `MAX_BLOCKS` refusals, `run-issue.sh` opens the draft PR anyway, ends the run log row as `needs_human` and exits 4. `factory.yml` posts what is missing and sets `needs-human`. |

The reviewer half is written, but nothing runs it yet. The reviewer agent is TL-7's (`factories/code/agents/reviewer/`), and TL-7 had no commits when this stage started. TL-7 should list `pr-description` in both its implementer's and its reviewer's skills. Until then, the person reviewing the PR is the reviewer.

The gate checks structure, not truth. "Two-way door" on a database migration passes it. Catching that is the reviewer's job, and the skill lists it as a finding.

## Happened

- **The trailer and the footer.** The first test run of the template itself passed Evidence. The template's last line, `Implements TL-`, sits under Evidence, and so does everything `run-issue.sh` appends: the run table and `Closes #N`. The check now ignores the `Implements TL-n` line and runs on the agent's message alone.
- **Unit tests**: 8 in `platform/gates/pr-description.test.ts`. A filled description passes. The unfilled template fails on both sections, because hints are comments. A plain summary, a vague Risk, the trailer alone, a top-level heading cutting a section short, and heading case and prefix are each covered. Another test ran the CLI, which the review's fixes removed.
- **`run-issue.sh` end to end**, with a stub `claude` that returns a scripted final message and records the system prompt, and stubs for `gh pr create` and `git push`, against factory-sample issue #1 (clone and read only):
  - A plain summary: exit 4, the PR URL then `There is no Risk section.` and `There is no Evidence section.` on stdout, `description_problems` in `run.json`, and the run log row ended `needs_human` with its PR recorded.
  - A filled-in template: exit 0, `description_problems: []`, and the row ended `done`.
  - The system prompt the agent received held both the skill and the template.
- **The workflow's "Run the agent" step**, extracted and run with stubs for the script and `pnpm`. Exit 4 posts "The factory opened <PR>, but its description is not ready for review:" with the list, sets `needs-human`, and leaves the step green. Exits 0, 3 and 1 behave as before.
- **CI's gate job failed the first push.** The CLI test started `tsx`'s CLI, which opens a Unix socket that the checks' sandbox denies (#41, the reason `pnpm test` uses `node --import tsx`). The test now does the same, and the gate passes. The gate prints only the last 60 lines of test output, which did not include the failing test, so the cause was found by reading the diff.
- **Code review moved the gate into the stop hook.** The first version checked the description after the agent had finished. A review of PR #48 found eleven problems, and each was confirmed before it was fixed:
  - **The check was in the wrong layer.** After the hook refuses a stop, only the agent's next message becomes `.result`. A real `claude -p` run on Haiku confirmed it: a Stop hook refused the first stop with a lint failure, and `.result` held only the message written after it. That message happened to repeat the description, behind a preamble. Agents often end with "Fixed the lint error; all checks pass." instead, which the old check would have sent to `needs-human` with a good PR. The stop hook now refuses a final message that fails the check, unless it starts with `QUESTION:`. The old hook let "Fixed the lint error" through (exit 0), and the new one refuses it (exit 2). Exit 4 is now only the fallback for a hook that gave up.
  - **The check could lose the work.** It ran `tsx` under `set -e` before the commit and push, so a crash would have dropped a passing run. The fallback now reads the last line of `gates.jsonl` with `jq`, after the push.
  - **A merged PR could skip `done`.** The `done` job required `factory:in-review`, so a PR merged straight from `needs-human` never reached `done` or rework. The job now accepts `needs-human` too.
  - **Four parsing bugs**, each reproduced on the old code first:
    - `# to revert` in a code fence ended the Risk section.
    - "only works one way" passed as a door, while "blast-radius" and non-breaking or en-dash hyphens failed.
    - "Implements TL-8." and "**Implements TL-8**" counted as evidence.
    - A repeated `## Evidence` heading erased the first one's text.
  - **Smaller items.** `.result` was parsed twice. The skill repeated the template's hints, so every prompt carried them twice; it now adds only what the hints leave out. The README did not describe the exit-4 path.
- **Found while fixing them.** `gate_failures`, which the PR footer shows as "N of M attempts to finish refused", counted failing checks only, so a description refusal showed as 0. It now counts both. CI's `gate` job fed the hook `{}`, which the new check fails closed on, so it now passes a valid description.
- **Tests.** There are 56: 10 for the description check and 4 new stop-hook tests. One of those starts the real hook on "Fixed the lint error", sees it refused, then sees the full description accepted. Run against the code before the review, the parser tests for each bug fail, and `gates.test.ts` fails to load (`blocked` does not exist there).
- **`run-issue.sh` end to end again.** This time the stub `claude` drove the real stop hook from the run's `settings.json` against factory-sample#1, whose `node --test` ran in the sandbox. A fix-note followed by the full description was refused once, then exited 0 with `description_problems: []` and the row ended `done`. A fix-note every time was refused 5 times, let through on the 6th, and exited 4, with the row ended `needs_human`.
- Not yet checked: a live run on Actions, and a real model following the skill through a refusal.

## What the numbers said

Run against the agent's part of every factory PR so far (factory-sample #4, #5, #6 and #8), the check fails all 4, each for both sections. The descriptions were written to the old prompt, "a short summary: what changed, how you checked it, and anything left undone", so this is the baseline, not a regression. They did contain evidence in prose: #8 says which tests ran and that the new one had not. None of them said anything about risk.

The numbers that matter come from the first live runs after merge: how many stops the hook refuses for the description alone (`description_problems` in `gates.jsonl`), how many runs still end at exit 4, and whether those extra turns and the longer prompt change the cost per run in the run log.
