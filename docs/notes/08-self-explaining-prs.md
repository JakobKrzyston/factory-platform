# 08: Pull requests that explain themselves (TL-8)

## Expected

Every factory PR states what changed, how to try it, its risk (one-way or two-way door) and blast radius, and its evidence. Design rule 3 asks for guidance and a gate together. The design is in `docs/ARCHITECTURE.md`, under "A pull request states its risk and evidence".

| Acceptance | Mechanism |
| --- | --- |
| The implementer fills in the PR template, and the reviewer checks it | One template for people and the factory: `.github/pull_request_template.md`, with its hints turned into HTML comments. One shared skill, `factories/code/skills/pr-description/SKILL.md`, says how to write each section and what a reviewer reports against it. `run-issue.sh`, today's implementer, puts the skill and the template in its system prompt. |
| A PR missing the risk or evidence sections is labelled `needs-human`, not `in-review` | `platform/gates/pr-description.ts` lists what the agent's description lacks. `run-issue.sh` opens the draft PR anyway, records `description_problems` in `run.json`, ends the run log row as `needs_human` and exits 4. `factory.yml` posts the list and sets `needs-human`. |

The reviewer half is written, but nothing runs it yet. The reviewer agent is TL-7's (`factories/code/agents/reviewer/`), and TL-7 had no commits when this stage started. TL-7 should list `pr-description` in both its implementer's and its reviewer's skills. Until then, the person reviewing the PR is the reviewer.

The gate checks structure, not truth. "Two-way door" on a database migration passes it. Catching that is the reviewer's job, and the skill lists it as a finding.

## Happened

- **The trailer and the footer.** The first test run of the template itself passed Evidence. The template's last line, `Implements TL-`, sits under Evidence, and so does everything `run-issue.sh` appends: the run table and `Closes #N`. The check now ignores the `Implements TL-n` line and runs on the agent's message alone.
- **Unit tests**: 8 in `platform/gates/pr-description.test.ts`. A filled description passes. The unfilled template fails on both sections, because hints are comments. A plain summary, a vague Risk, the trailer alone, a top-level heading cutting a section short, and heading case and prefix are each covered. Another test runs the CLI.
- **`run-issue.sh` end to end**, with a stub `claude` that returns a scripted final message and records the system prompt, and stubs for `gh pr create` and `git push`, against factory-sample issue #1 (clone and read only):
  - A plain summary: exit 4, the PR URL then `There is no Risk section.` and `There is no Evidence section.` on stdout, `description_problems` in `run.json`, and the run log row ended `needs_human` with its PR recorded.
  - A filled-in template: exit 0, `description_problems: []`, and the row ended `done`.
  - The system prompt the agent received held both the skill and the template.
- **The workflow's "Run the agent" step**, extracted and run with stubs for the script and `pnpm`. Exit 4 posts "The factory opened <PR>, but its description is not ready for review:" with the list, sets `needs-human`, and leaves the step green. Exits 0, 3 and 1 behave as before.
- `pnpm typecheck`, `pnpm lint` and `pnpm test` (50 tests) pass.
- **CI's gate job failed the first push.** The CLI test started `tsx`'s CLI, which opens a Unix socket that the checks' sandbox denies (#41, the reason `pnpm test` uses `node --import tsx`). The test now does the same, and the gate passes. The gate prints only the last 60 lines of test output, which did not include the failing test, so the cause was found by reading the diff.
- Not yet checked: a live run on Actions, and a real model following the skill.

## What the numbers said

Run against the agent's part of every factory PR so far (factory-sample #4, #5, #6 and #8), the check fails all 4, each for both sections. The descriptions were written to the old prompt, "a short summary: what changed, how you checked it, and anything left undone", so this is the baseline, not a regression. They did contain evidence in prose: #8 says which tests ran and that the new one had not. None of them said anything about risk.

The numbers that matter come from the first live runs after merge: how many factory PRs reach `in-review` rather than `needs-human` on their description, and whether the prompt's extra length changes the cost per run in the run log.
