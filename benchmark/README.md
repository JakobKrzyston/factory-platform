# benchmark

Ten past issues from this repository. Each one has the outcome it should have reached and the checks that prove it. A change to a factory's prompts, models or gates is judged by replaying these cases on the old and the new definition (TL-15), and the results are scored by the files under `scorers/` (TL-16). The cases are the factory's own history, so the set grows as the project does.

## Cases

| Case | Role | Stages | Reference | What it tests |
| --- | --- | --- | --- | --- |
| [52-stage-labels-test](52-stage-labels-test/case.md) | implement | triage, spec, implement, review | #53 | The factory's own end-to-end run: a test-only change with a check that the test bites. It is also the one case where triage should pass the issue on. |
| [34-process-group-clone](34-process-group-clone/case.md) | implement | spec, implement, review | #43 | A shell change with two open decisions: kill the process group, and delete the clone but keep a patch. |
| [41-tsx-gate-sandbox](41-tsx-gate-sandbox/case.md) | spec | spec | #44 | Choosing the safe option when the obvious fix opens a hole, and saying which check only a person can run. |
| [11-run-log-schema](11-run-log-schema/case.md) | spec | spec | #28 | Turning a one-paragraph requirement into a schema, including the columns that "reconstruct a run" needs. |
| [55-chain-ends-in-review](55-chain-ends-in-review/case.md) | triage | triage | none | Spotting that the asked-for test already exists. |
| [35-token-only-mcp](35-token-only-mcp/case.md) | triage | triage | #47 | Stopping on a security design choice and a deployment outside the repository. |
| [32-webhook-health-check](32-webhook-health-check/case.md) | triage | triage | #45 | Stopping on credentials, network and a `.github/` workflow. |
| [33-branch-ci-secrets](33-branch-ci-secrets/case.md) | triage | triage | #39 | Stopping on a security policy decision made in GitHub's settings. |
| [4-run-issue-review](4-run-issue-review/case.md) | review | review | #29 | Finding three defects that survived into the merged diff and were filed as #33 and #34. |
| [5-quality-gates-review](5-quality-gates-review/case.md) | review | review | #40 | Finding that the gate can never pass on this repository (#41). |

Per role: two implementation cases, two spec cases, four triage cases (plus the triage stage of #52), and two review cases.

## Case format

Each case is `benchmark/<issue>-<slug>/case.md`. TL-15's harness reads it, so a change here is a change to that contract. The settings are `key: value` lines between `---` fences, the same style as `agent.md`. All seven keys are present in this order:

| Key | Value |
| --- | --- |
| `issue` | The issue number. |
| `pr` | The merged PR that is the reference solution. It is empty only when no PR merged, which is allowed only when `stages` stop before `implement`. |
| `base_sha` | Where a replay starts: the merge-base of the PR's head and the `main` it merged into, so `git diff <base_sha> <PR head>` is exactly the PR's diff. With no PR, it is `main` when the factory first saw the issue. |
| `role` | The role this case mainly tests: `triage`, `spec`, `implement` or `review`. |
| `stages` | The roles to replay, comma-separated, in chain order. They include `role`. |
| `files` | The paths the change may touch, comma-separated. With a PR, this is exactly the PR's file list. TL-16's scope scorer reads it. |
| `checks` | One shell line, run with `bash` from the replay checkout's root after its dependencies are installed. Exit 0 means the outcome is proven. Several commands are joined with `&&`. It is required when `stages` include `implement`, and empty otherwise. |

The body has two sections:

- `## Issue`: the issue's title alone on the first line, then its body verbatim inside a four-backtick `markdown` fence. A replay takes the fence's contents as the body, not the fence itself. Issues get edited, and this is the text the factory would have seen. The fence keeps the body's own headings and code blocks from being read as the case's. None of the ten issues had been edited, according to GitHub's edit history, so each snapshot is the issue as filed. A replay that starts at `spec` or later gets no triage note or spec comments, because none of these cases has a factory-written one to replay from. Review-only cases (`stages: review`) use the issue body as their spec, and review the reference PR's diff.
- `## Expected outcome`: in plain words, what each replayed stage should produce, and what counts as a miss. For triage, spec and review, the output is a comment, so this section is what a scorer or a reader judges it against.

## How the cases were chosen

The pool was every issue and every merged PR in the repository on 2026-11-12: 21 closed issues and one open issue, and 21 merged PRs. A case had to meet four tests:

1. **The issue was written before the work,** so a replay starts from what a person actually asked for, not a description of the finished change.
2. **There is a reference outcome:** a merged PR, or a factory run whose answer the owner accepted.
3. **The expected outcome can be judged without the network or the owner's credentials.** That means a command for implementation, or a written expectation for a comment.
4. **The replay is cheap enough to run on every factory change.** Stage PRs of a few hundred lines are used only as review or spec cases, where the agent reads them but does not rebuild them.

Material is thin. Only two issues have ever gone through the factory (#52 and #55), and most of the rest are stage requirements built by hand. So the triage cases lean on issues the owner rightly kept away from the factory: their correct outcome is a question.

## Rejected candidates

| Candidate | Why not |
| --- | --- |
| #54 | A throwaway issue that checked the `done` job's labels. It describes no work. |
| #30 | It asks someone to watch Throughline after a merge and record a timing. That makes it a triage case needing outside access, the same kind #32 and #35 already cover. It was closed by hand with no PR. |
| #10 / #38 | The PR records merge-gate evidence read from GitHub's API in a note. The outcome is that evidence, which a replay cannot produce offline. |
| #1, #2, #3 / #25, #26, #36 | The work lives outside the repository: a Throughline instance, a GitHub App, and an MCP server in Throughline's own repository. Their PRs are stage notes and client configuration. |
| #6 / #39 | It is used as the reference for #33's triage case. As an implementation case it is 505 lines, and its acceptance runs on Actions. |
| #7, #8, #9, #12, #13 | Stage PRs of 390 to 840 lines. They would make spec cases of the same shape as #11, and another one adds replay cost without testing anything new. Revisit once the spec cases show spread. |
| #41 / #44 as implementation | Half of it is Linux-only fixes found on a real runner, plus `.github/` changes the factory may not make. It is kept as a spec case. |
| #35 / #47 as implementation | Done means a deployed Vercel project. It is kept as a triage case. |
| #55 / #56 as implementation | #56 was never merged. It existed to exercise the incomplete-description path. The issue is kept as a triage case. |
| #31, #42 | Roadmap and note bookkeeping with no issue behind them. |
| #33 / #39 as review | No defect is known in #39's diff to score a review against. |

## Known weaknesses

- **Only 52-stage-labels-test has a check that fails at `base_sha` and passes on the reference.** That was confirmed by running it on both commits. 34-process-group-clone's checks pass at `base_sha` too. Its outcome is behaviour (no process left after a time-out, no clone left on disk), and nothing in this repository runs `run-issue.sh` without real GitHub and Claude Code. Its expected outcome is judged against PR #43's evidence instead.
- **The review cases have no factory-written spec.** The requirement issue stands in for one. They score whether the reviewer finds defects that are known to be in the diff. They cannot score false positives, because nobody listed what was fine.
- **Every case comes from one owner, over four days, in one repository.** The factory's own future runs are the next source. An issue that goes through the factory and merges, or stops at a question the owner answers, becomes a candidate.
