# benchmark

Eleven past issues from this repository. Each one has the outcome it should have reached and the checks that prove it. A change to a factory's prompts, models or gates is judged by replaying these cases on the old and the new definition (TL-15), and the results are scored by the files under `scorers/` (TL-16). The cases are the factory's own history, so the set grows as the project does.

## Cases

| Case | Role | Stages | Reference | What it tests |
| --- | --- | --- | --- | --- |
| [52-stage-labels-test](52-stage-labels-test/case.md) | implement | triage, spec, implement, review | #53 | The factory's own end-to-end run: a test-only change with a check that the test bites. It is also the one case where triage must pass the issue on. |
| [60-merge-gate-lint](60-merge-gate-lint/case.md) | implement | triage, spec, implement, review | #62 | A factory run on a drafted chore: a type-only lint fix whose check fails at the base and refuses a suppressed rule. |
| [34-process-group-clone](34-process-group-clone/case.md) | spec | spec | #43 | Settling the issue's two open decisions: kill the process group, and choose what to keep once the clone is deleted. |
| [41-tsx-gate-sandbox](41-tsx-gate-sandbox/case.md) | spec | spec | #44 | Choosing the safe option when the obvious fix opens a hole, and saying which check only a person can run. |
| [11-run-log-schema](11-run-log-schema/case.md) | spec | spec | #28 | Turning a one-paragraph requirement into a schema, including the columns that "reconstruct a run" needs. |
| [55-chain-ends-in-review](55-chain-ends-in-review/case.md) | triage | triage | none | Spotting that the asked-for test already exists. |
| [35-token-only-mcp](35-token-only-mcp/case.md) | triage | triage | #47 | Stopping on a security design choice and a deployment outside the repository. |
| [32-webhook-health-check](32-webhook-health-check/case.md) | triage | triage | #45 | Stopping on credentials, network and a `.github/` workflow. |
| [33-branch-ci-secrets](33-branch-ci-secrets/case.md) | triage | triage | #39 | Stopping on a security policy decision made in GitHub's settings. |
| [4-run-issue-review](4-run-issue-review/case.md) | review | review | #29 | Finding three defects that survived into the merged diff and were filed as #33 and #34. |
| [5-quality-gates-review](5-quality-gates-review/case.md) | review | review | #40 | Finding that the gate can never pass on this repository (#41). |

Per role: two implementation cases, three spec cases, four triage cases (plus the triage stages of #52 and #60), and two review cases. The history had no second issue that an implement replay could pass, so two small chores were drafted below and filed as #60 and #61. #60 became the second implementation case. #61 did not become a case (see below).

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

- `## Issue`: the issue's title alone on the first line, then its body verbatim inside a four-backtick `markdown` fence. A replay takes the fence's contents as the body, not the fence itself. Issues get edited, and this is the text the factory would have seen. The fence keeps the body's own headings and code blocks from being read as the case's. None of the eleven issues had been edited, according to GitHub's edit history, so each snapshot is the issue as filed. A replay that starts at `spec` or later gets no triage note or spec comments, because none of these cases has a factory-written one to replay from. Review-only cases (`stages: review`) use the issue body as their spec, and review the reference PR's diff.
- `## Expected outcome`: in plain words, what each replayed stage should produce, and what counts as a miss. For triage, spec and review, the output is a comment, so this section is what a scorer or a reader judges it against.

## How the cases were chosen

The pool was every issue and every merged PR in the repository on 2026-11-12: 21 closed issues, the open issue #55 (closed PR #56), and 21 merged PRs. The other open issues, #14 to #24, are roadmap requirements not yet built, so they have no outcome to compare against. A case had to meet four tests:

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
| #10 / #27, #38 | #27 applies GitHub rulesets with `gh` signed in as a repository admin, and #38 records merge-gate evidence read from GitHub's API in a note. Both outcomes live in GitHub's settings, which a replay cannot change or read offline. |
| #1, #2, #3 / #25, #26, #36 | The work lives outside the repository: a Throughline instance, a GitHub App, and an MCP server in Throughline's own repository. Their PRs are stage notes and client configuration. |
| #6 / #39 | It is used as the reference for #33's triage case. As an implementation case it is 505 lines, and its acceptance runs on Actions. |
| #7, #8, #9, #12, #13 | Stage PRs of 390 to 840 lines. They would make spec cases of the same shape as #11, and another one adds replay cost without testing anything new. Revisit once the spec cases show spread. |
| #41 / #44 as implementation | Half of it is Linux-only fixes found on a real runner, plus `.github/` changes the factory may not make. It is kept as a spec case. |
| #34 / #43 as implementation | At its `base_sha` the `test` script is `tsx --test`, which the gate's sandbox cannot run (#41). An implement replay could never pass the gate. It is kept as a spec case. The same applies to every PR that branched before #44. |
| #35 / #47 as implementation | Done means a deployed Vercel project. It is kept as a triage case. |
| #55 / #56 as implementation | #56 was never merged. It existed to exercise the incomplete-description path. The issue is kept as a triage case. |
| #31, #42 | Roadmap and note bookkeeping. #31 is a TL-2 follow-up from reviewing the stage note, with no issue describing the work; #42 has no issue at all. |
| #33 / #39 as review | No defect is known in #39's diff to score a review against. |

## Known weaknesses

- **Two implementation cases, both small.** 52-stage-labels-test and 60-merge-gate-lint are the only ones. Each check was confirmed to fail at `base_sha` and pass on the reference. Both are one-file changes, so they say little about a factory's handling of larger work. Every other implementation candidate either branched before #44, when the gate could not run this repository's tests, or needs a deployment or a runner.
- **The review cases have no factory-written spec.** The requirement issue stands in for one. They score whether the reviewer finds defects that are known to be in the diff. They cannot score false positives, because nobody listed what was fine.
- **Replaying implement on macOS stops at the gate.** The mcp-gateway tests cannot bind `127.0.0.1` inside the sandbox (#64). That is a harness environment limit, not a case failure. The checks themselves run outside the gate.
- **Every case comes from one owner, over four days, in one repository.** The factory's own future runs are the next source. An issue that goes through the factory and merges, or stops at a question the owner answers, becomes a candidate.

## Drafted chores for the implementation gap

The owner filed both, verbatim, as #60 and #61. Both were labelled `factory:ready` on 2026-11-12 and ran on the factory chain on `main`. Each check below failed on `main` when it was drafted.

- **#60** merged as #62 and is the case [60-merge-gate-lint](60-merge-gate-lint/case.md). Its check gained `! grep -q biome-ignore`, because the issue rules out suppressing the rules.
- **#61** merged as #63 without its test. The implement run could not create files, and the PR says so. `render-plan.ts` gained its `renderPlan()` export, but nothing checks `PLAN.md` yet, so the check below still fails on #63's head. A case needs a reference that passes its check, so #61 is not a case. It can become one when a PR adds the missing test.

**1. Fix the two lint warnings in `scripts/check-merge-gate.ts` (#60)**

> `pnpm lint` reports two warnings in `scripts/check-merge-gate.ts`: `noExplicitAny` on `api()`'s return type (line 14) and `noNonNullAssertion` on `keyPath!` (line 29). Fix both without disabling the rules. Give `api()` a typed or `unknown` body that its callers narrow, and check `keyPath` before using it, with the same error the script gives for other missing settings. Only that file changes. `pnpm exec biome lint --error-on-warnings` passes.

Exercises triage (it should pass the issue on), spec and implement. Check: `pnpm typecheck && pnpm exec biome lint --error-on-warnings && pnpm test`.

**2. Test that `docs/PLAN.md` matches `docs/roadmap.ts` (#61)**

> Rule R-4 says a change to `docs/roadmap.ts` comes with `docs/PLAN.md` re-rendered, but nothing checks it. Make `scripts/render-plan.ts` export the rendering as a function (running it still writes the file), and add a test under `platform/` that fails when `docs/PLAN.md` differs from what `docs/roadmap.ts` renders. `pnpm test` passes.

Exercises spec (where the test lives, since `pnpm test` reads only `platform/`) and implement. Check: `pnpm test && sed -i.orig 's/Benchmark set of past issues/Benchmark set of old issues/' docs/roadmap.ts && ! pnpm test; s=$?; mv docs/roadmap.ts.orig docs/roadmap.ts; exit $s`.
