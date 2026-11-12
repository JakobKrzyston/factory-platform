# 07: Separate triage, spec, implement and review agents (TL-7)

## Expected

One agent with one context did everything. It read the issue, decided what done meant, built it and summarised its own work. Splitting it into four roles should do three things. Triage should catch an unfit issue cheaply. The spec should write down what done means before anyone builds. The reviewer, who never sees the implementer's reasoning, should catch what the author could not.

| Acceptance | Mechanism |
| --- | --- |
| Four agent definitions exist and the workflow chains them by label | `factories/code/agents/{triage,spec,implement,review}/agent.md`. `STAGES` in `platform/queue/queue.ts` maps `factory:ready` → triage → `factory:spec` → spec → `factory:implement` → implement → `factory:review` → review → `factory:in-review`. `factory.yml` runs one role per labelled event and adds the next label on success. |
| The review agent runs from a clean checkout of the PR branch with only the diff and the spec | A separate workflow run on a fresh runner clones the repository and detaches at the PR's head commit. Its prompt is the spec comment and `git diff base...head`, and nothing else. |
| Per-role model choice is a one-line change in the agent file | `model: haiku` in `agent.md`; `platform/agents/agent.ts` reads it. |

Decisions:
- **Roles hand work on through GitHub, not files.** The triage note and spec are issue comments, the implementation is a PR, and the review is a PR comment. Each stage is visible in the timeline, a human can step in at any label, and nothing is shared between runners.
- **The definition holds what to ask; the platform holds what goes in and comes out.** The prompt, model, tools, budget and time limit are in `agent.md`. Which inputs a role gets, whether it is gated and where its answer goes are in `run-issue.sh`. A meta-factory editing definitions (TL-22) can then change how a role works but not what it can see.
- **Tools are limited to Bash, Edit and Read.** Those are the three the script confines. The parser refuses others, so a one-line edit cannot add an unconfined `WebFetch`.
- **The reviewer checks out the PR head only after installing dependencies from the base branch.** pnpm runs a `.pnpmfile.cjs` even with `--ignore-scripts`, outside the sandbox, and the PR branch is agent-written.
- **Models:** Haiku for triage, Sonnet for the rest. These are starting points, not results; TL-15's benchmark decides.
- **The role names match the labels** (`implement`, not TL-12's `implementer`), so older rows in the run log say `implementer`.

## Happened

- Unit tests: 7 for the parser (every setting required, unknown settings refused, unconfined tools refused, Read required), 4 that the real definitions parse, 2 for the chain and per-stage claims, 2 for the closed-issue and merged-PR rules, and 1 for `review_findings` reaching the row without a `head_sha`. `pnpm test`: 58 pass. Typecheck and lint are clean.
- Live, against [factory-sample#3](https://github.com/JakobKrzyston/factory-sample/issues/3), with real `claude` and real model calls, read-only on GitHub:
  - **Triage** ran on `claude-haiku-5-5` with `Read(./**)` and sandboxed Bash, no stop hook and `checks_passed` null. It produced a sound note: it flagged the unnamed option, the ellipsis counting toward `max`, and the "no whole word fits" case. 6 turns, $0.002.
  - **Spec** ran on Sonnet and produced 9 checkable criteria, an approach, tests and out-of-scope items, under the spec marker. 4 turns, $0.04.
  - **Review** ran on Sonnet against the real branch of factory-sample#6, the closed PR the single-agent factory opened for this issue. A `gh` shim stood in for "PR is open" and the spec comment, and captured the comment instead of posting it.
    - The prompt held the spec and the diff. It did not hold an owner comment planted on the issue, a fake spec from a non-collaborator, or the issue's title and body.
    - A newer cross-repository PR with a matching branch name was ignored.
    - It raised one blocking finding: `truncate("   abcdef", 4, { wordBoundary: true })` returns a bare `"…"` where the spec's criterion 8 requires the hard cut. I confirmed it by running the branch's code. The single-agent run never had that criterion written down, so this shows the spec and the reviewer working together, not a bug against the original issue. It also found missing tests for three criteria. 2 turns, $0.04. `review_findings` was 2 on the row, with `pr` 6 and the reviewed `head_sha`.
  - **Implement** ran with a stub `claude`. It got the same flags and Stop hook as before, now read from its definition, and the no-changes run ended with no PR.
- An independent review of the change found four problems, now fixed:
  - **A merge before the review agent finished never reached `done`.** That covers a review that failed, or a human who merged first. The `done` job now accepts every state a PR can be open in.
  - **A `QUESTION:` from the reviewer asked for an answer it could never see.** It is now posted as the review.
  - **Review rows recorded `head_sha`.** A second review after a human edit would then have hidden the rework. They now record `reviewed_sha` in `run.json` only.
  - **The reviewer could read the issue's title through the clone's git metadata,** in the commit message, and earlier attempts on other branches. Its sandbox now denies that directory. A live probe with the same settings showed sandboxed Bash refused (`Operation not permitted`) with the rule, and listing it without.
  - Also fixed:
    - A triage note can no longer start with the spec marker.
    - A definition must include `Read`.
    - The reviewer is told its dependencies come from the base branch.

  A second live review after the fixes found the same two problems, grading the first `should fix` rather than `blocking`. The severity varies between runs; the findings did not.
- A second code review found ten problems; nine are fixed and one got a comment:
  - **A run that ended after the issue closed put a label back on it**, overwriting `done`, and implement could open a `Closes #N` PR for a closed issue. A closed issue now moves only to `done` (`moveRefusal`), and implement re-reads the issue's state before pushing.
  - **An issue a human closed without a factory PR, such as one a question had parked, became `done`.** The `done` job now looks for the factory's merged PR first (`mergedFactoryPr`).
  - **An invalid `agent.md` ended the run without a row.** The row now starts before the parse, with model `unknown`.
  - **Implement was told to follow a maintainer over the spec, which the reviewer would flag.** Implement now asks instead, the spec follows the maintainer, and the question comment says to re-add `factory:spec` when an answer changes the spec.
  - **A push between the clone and the PR listing left the reviewed commit out of the clone.** It is now fetched by SHA.
  - **`description` was not required, and `budget_usd: Infinity` reached `claude` as `null`.** Both are refused now.
  - Smaller: dead `Read` check removed, the review-run test now uses the shape a review writes (`reviewed_sha`, no `head_sha`), and the queue README and ARCHITECTURE describe the chain.
  - Checked by running them: `run-issue.sh triage` with `budget_usd: Infinity` left a row with model `unknown`, ended `failed`, and one with a valid definition and no API key left a row too. Fetching by SHA a closed PR's head commit, absent from a fresh clone, then switching to it, worked against GitHub.
  - Commented, not restructured: the run job's list of stage labels is copied from `STAGES`. Matching any `factory:*` label instead would start a runner job for every `in-progress`, `in-review`, `needs-human` and `done` the App adds, each queueing in the issue's concurrency group. The list now says to change both together; the `done` job no longer lists labels at all.
- Not checked before merge: the chain on real runners. `issues` workflows run only from the default branch, and the `factory` environment deploys from `main` only. That includes whether a label the App adds starts the next workflow run. GitHub says events from an App token do, unlike `GITHUB_TOKEN`, but it has not been seen here.

## What the numbers said

On one issue, triage, spec and review together cost $0.08, against a $5 cap for the implementer alone. The spec turned an open question in the issue, what happens when no whole word fits, into a criterion. The reviewer then found in 16 seconds that the single-agent PR did not meet it. That is one result, not a measurement (rule 6). TL-15's benchmark is where review findings per PR, and the rework they save, get measured. Pending the first live chain after merge: an issue from `factory:ready` to `in-review`, its four rows, and their cost per role.
