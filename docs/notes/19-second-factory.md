# 19: A second factory made by copying the first (TL-19)

## Expected

TL-17 and TL-18 claim that creating a factory is copying a folder: the platform reads any factory's triggers, the workflow routes by label to whichever factory has that trigger, and `run-issue.sh` branches on an agent's contract, never its name. A second factory is the test of that claim. The prediction was that a documentation factory, `factories/docs/`, could be made by `cp -R factories/code factories/docs` and editing only files under it. It should run on its own labels in this repository beside the code factory, with nothing in `platform/`, `scripts/` or the workflow changed.

| Acceptance | Mechanism |
| --- | --- |
| Two factories run from the same repository on different labels | `factories/docs/` serves `JakobKrzyston/factory-platform`, like `factories/code/`, on `factory:docs`, `factory:docs-spec`, `factory:docs-implement` and `factory:docs-review`. `queue route` sends each label to its own factory. A new test in `platform/factory/definitions.test.ts` fails if two factories serving one repository share a label. |
| A note records every file that had to change, and why | This note: the table below covers all 25 files in the copy, and every file outside it that changed. |

Documentation rather than frontend verification, because this repository has no frontend. Its documentation, though, is large and must stay true to the code, so a docs factory has real work here.

## Happened

**The copy.** `cp -R factories/code factories/docs`, then edits. Of the 25 files, 8 are byte-identical to the code factory's, and 17 changed.

| File in `factories/docs/` | Changed? | Why |
| --- | --- | --- |
| `triggers/*/trigger.yaml` (4) | yes, required | `label`, `next`, `color` and `description`. Both factories serve this repository, so a shared label would make `queue route` refuse it and stop both chains. The labels start with `factory:docs` because the queue needs the `factory:` prefix. |
| `triggers/implement/question.md` | yes, required | It names the label to add when an answer changes the spec. Copied as is, it would send a docs issue to the code factory's `factory:spec`. |
| `agents/{triage,spec,implement,review}/agent.md` (4) | yes, the point | Prompts for documentation work. Triage turns away anything that needs more than Markdown and points it to `factory:ready`. Spec adds `Pages` (the only files that may change) and `Sources` (where in the code each stated fact comes from) in place of `Approach` and `Tests`. Implement may change only those pages, and must read the code behind each fact it writes. Review checks each stated fact and link against the checkout. Contract, model, tools, budget and time limit are unchanged: there is no benchmark yet to justify different values. |
| `triggers/*/comment.md` (4) | yes, wording | "The docs factory's … agent", so a person can tell on the issue which factory ran. The comments would work unchanged. |
| `factory.yaml` | comment only | `repositories` and `foreman` stay the same, so only the header comment changed. |
| `README.md`, `agents/README.md`, `triggers/README.md` | yes, docs | They describe this factory's chain and labels. |
| `agents/review/skills/cite-standards/SKILL.md` | no | It describes the findings format that the platform's citation gate checks. That format belongs to the `review` contract, not to the factory. |
| `skills/pr-description/SKILL.md` | no | The same reason: the `pull-request` contract's description gate checks it, and the validator requires the file in every factory with a `pull-request` agent. |
| `scorers/*/scorer.md` (4), `scorers/README.md` | no | Tests, scope, findings and cost mean the same thing for a docs change. |
| `skills/README.md` | no | Already true of the copy. |

**Outside `factories/`, nothing had to change for the docs factory to run.** The files that did change:

- `platform/factory/definitions.test.ts`: a new test. For each factory, repository and trigger, `route` must return that factory. Copying exposed the gap it closes. The validator, `pnpm validate-factory`, reads one factory at a time, so a docs factory that reused `factory:spec` passed it, and CI with it (checked on a scratch copy). The workflow's `route` job would then have failed on every `factory:spec` label, stopping both factories' chains at that step. On that copy, the new test fails with `factory:spec on JakobKrzyston/factory-platform starts code and docs`.
- `README.md`, `factories/README.md`, `platform/queue/README.md` and `docs/ARCHITECTURE.md`: say that there are two factories and which labels start the second. In `docs/ARCHITECTURE.md`, also replace a stale line claiming `run-issue.sh` still hardcodes `FACTORY=code`; TL-15 made it read the variable.

**What turned out to be shared, and what is not.**

- **Shared and working:** the queue's states (`in-progress`, `in-review`, `needs-human`, `done`), routing, the workflow, `run-issue.sh`, the gates, the run log (rows carry the factory's name, and the dashboard groups by it) and the `done` and rework jobs. Those two match a factory PR by its `factory/issue-<n>-` branch, the same for every factory.
- **Shared but copied:** the two skills that describe what a gate checks. They are contract content, not factory content, and copying them means two places can drift apart. They could move under `platform/`, beside the gates that check them.
- **Shared and code-shaped:** `standards/rules.md` is the repository's set of rules, not a factory's. All four rules still apply to a docs change (secrets, factories are data, one idea per PR, and re-rendering the plan with the roadmap), so the docs reviewer can use them unchanged.
- **Not shared, but assumed shared:** the replay harness. `platform/bench/cases.ts` hardcodes `ROLES = triage, spec, implement, review`, and `bench.ts` passes outputs from one stage to the next by those names. So the docs factory keeps the code factory's agent names: had implement been renamed `write`, `pnpm bench docs` would have failed. The benchmark's cases are this repository's code issues, so `pnpm bench docs` replays code work through a docs factory. `docs/ARCHITECTURE.md` already noted the agent-name coupling under TL-18. A second factory now needs it.
- **Guidance without a gate:** "documentation only" is in four prompts, and the review agent checks it, but no gate refuses a docs PR that edits code. The `pull-request` gate runs the repository's checks, and those pass for any change. Design rule 3 asks for guidance and a gate together, so this is the first follow-up below, not something to leave as it is.
- **The review contract fixes the chain's shape:** a `review` agent finds its spec by the `<!-- factory:spec -->` marker, so any factory with a reviewer needs a `spec` agent before it. A two-stage docs factory (write, then review) was not possible without changing the platform.

**Follow-ups,** each a ticket of its own, not filed yet:

1. A gate for the files a factory's `pull-request` agent may change, such as a factory setting the stop hook checks. It turns "documentation only" from guidance into a gate.
2. Make the replay harness pass outputs between stages by contract rather than by agent name, and let a factory have benchmark cases of its own. Then a docs case benchmarks the docs factory and nothing else.
3. Move the gate-owned skills (`cite-standards`, `pr-description`) to the platform, so a copy does not duplicate them.

## What the numbers said

**Routing, both factories, one repository.** `pnpm queue route JakobKrzyston/factory-platform <label>` for every trigger label:

| Label | Factory | Trigger | Agent |
| --- | --- | --- | --- |
| `factory:ready` / `factory:spec` / `factory:implement` / `factory:review` | `code` | `ready` / `spec` / `implement` / `review` | `triage` / `spec` / `implement` / `review` |
| `factory:docs` / `factory:docs-spec` / `factory:docs-implement` / `factory:docs-review` | `docs` | `ready` / `spec` / `implement` / `review` | `triage` / `spec` / `implement` / `review` |
| `factory:in-review` | none | | |

`pnpm validate-factory factories/*/` finds both valid. `pnpm typecheck`, `lint` and `test` pass: 163 tests, including the new cross-factory one. Nothing under `factories/code/` and no platform code changed, so the code factory behaves as before by construction, and it was not re-benchmarked.

**The docs factory's agents, run for real.** Two replays through `scripts/run-issue.sh` with `FACTORY=docs`, from this branch's commit. Both used the local SQLite run log, with `DATABASE_URL` unset, and wrote nothing to GitHub.

1. **A code issue.** `pnpm bench docs HEAD --case 52-stage-labels-test` replays an issue that asks for a test. The docs triage stopped with a question, as it should: *"Issue #52 asks for a new test in `platform/queue/queue.test.ts`, which is code, not Markdown documentation, so it belongs in the code factory. Should this be relabelled `factory:ready` and handed to the code factory?"* It cost $0.0015 and took 5s on Haiku. So `pnpm bench` runs a second factory, because its agents keep the code factory's names.
2. **A docs issue,** written for this check and chained stage to stage as `pnpm bench` does (the script stayed in the session's scratch area). The issue: `factories/README.md` does not say how to run another factory's agent by hand.

| Stage | Outcome | Cost | Wall time | Result |
| --- | --- | --- | --- | --- |
| triage | done | $0.006 | 20s | Documentation only. Named the three pages and `run-issue.sh`'s `FACTORY` default as the fact they must agree with. |
| spec | done | $0.083 | 23s | 12 acceptance criteria. `Pages` names three Markdown files. `Sources` cites `scripts/run-issue.sh` and `.env.example` by line for each fact. |
| implement | done | $0.073 | 30s | Changed only those three files. The gate passed on the first attempt. Every fact in the patch checks out against the script. |
| review | done | $0.042 | 12s | No findings. It checked the links, the changed-file list and most facts against the checkout. It said it took three facts from the spec's citations without re-reading the script. Those three are correct. |

Total: $0.20 and 85s for the docs chain, plus $0.0015 for the code-issue triage.

**What that shows, and what it does not.** One issue per path proves that the docs factory runs and that its prompts change what the agents do. Triage turns code away, spec names sources, and implement stays on the named pages. It says nothing about how often they do. That needs docs cases in the benchmark, which is follow-up 2. The reviewer's shortcut of trusting the spec's citations for three facts is a single run. If benchmark runs show it again, the review prompt is the place to fix it.

**Not checked here: the live workflow.** `issues` events run the workflow from `main`, and the `factory` environment deploys from `main` only. So the docs labels first start a run once this branch merges and `pnpm queue setup JakobKrzyston/factory-platform` has created them. The first live `factory:docs` issue completes the first acceptance criterion on GitHub itself.
