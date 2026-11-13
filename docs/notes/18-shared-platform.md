# 18: Shared platform layer (TL-18)

## Expected

The queue, run log, gates and replay harness already lived under `platform/`, and `factories/code/` already held only Markdown and YAML. Two things still tied the platform to the code factory:

- **`scripts/run-issue.sh` branched on the four role names** (`triage`, `spec`, `implement`, `review`) for what an agent is given, which gate it runs under and where its answer goes. TL-17's note left this to TL-18. A factory copied for TL-19, with an agent named anything else, could not run.
- **Platform tests read `factories/code/`.** The queue's comment wording was tested on the code factory's triggers, the agent parser on its four `agent.md` files, the factory reader on its chain, and the replay test ran its implement and review agents. A change to the code factory's text could break a platform test, and a platform change was only shown to work for that one factory.

| Acceptance | Mechanism |
| --- | --- |
| No factory directory contains queue, log or gate code | `platform/factory/definitions.test.ts` fails if any file in any factory is not `.md` or `.yaml`, and if any `agent.md` does not parse. It runs in CI with the other tests. |
| A platform change is covered by the platform's own tests, independent of any factory | The queue, agent-parser, reader and replay tests use factories of their own. With `factories/` emptied, every platform test passes. |

The plan was also to change no behaviour: the code factory's agents should get the same inputs and gates as on `main`.

## Happened

**A contract per agent.** Each `agent.md` now has `contract:`, one of `note`, `spec`, `pull-request` or `review`, and `run-issue.sh` branches on that instead of the agent's name. The four contracts are the four role behaviours that existed, with the name taken out: triage is `note`, implement is `pull-request`. `agent.ts` refuses a missing or unknown contract, and the `run.json` of each run records its contract. `agent-settings.sh` takes the contract too, since a `review` agent is the one denied the git metadata. The script's usage now takes any agent, and it checks that the agent's and the factory's names are plain folder names. The old list of four names was also what kept the agent's name from leading the definition's path out of `factories/`.

Separate fields for input, gate and output were considered and rejected. A definition, which the meta-factory may edit, could then pair a pull request with no gate, or a review with the author's context. A contract keeps the three together. A new combination is a new contract, added to the parser and the script in the same change.

**Skills by layout.** The script had two skill paths hardcoded, one with `review` in it. Now each `agents/<agent>/skills/*/SKILL.md` is appended to that agent's prompt, without front matter if it has any, so a copied review agent brings its cite-standards skill along. The `pull-request` contract appends the factory's `skills/pr-description/`, because its gate checks the description that skill describes. Reviewing the diff turned up two ways a copied factory could fail silently. The old front-matter `awk` printed nothing for a skill without front matter, so it now drops front matter only when the file starts with it. A missing `pr-description` left that part of the prompt empty without failing the run: the assignment's status is that of its last command substitution, the template's `cat`. Now the definitions test refuses such a factory. Root skills are not appended to every agent. The one root skill has a reviewer part that the review agent must not see (TL-7), and appending it to triage and spec would add tokens and nothing else.

**Tests.** The queue's `report` tests now build a three-trigger factory in memory (`plan`, `build`, `check`). The replay test writes a `demo` factory into its copy of the checkout. That factory has a `build` agent under `pull-request` and a `check` agent under `review`, with a skill of its own. The test now also asserts what each contract adds to the system prompt and which stop hook each gets. The code factory's chain test and the four per-agent parse tests were replaced by `definitions.test.ts`, which checks whichever factories exist. `queue.test.ts` still reads every factory for one check, that `factory.yml` names no trigger's label, which does not depend on any one factory.

**Not done: the replay harness.** `platform/bench/` still chains a case's stages by the code factory's agent names: the triage note becomes a comment, the implement patch becomes the PR. The benchmark's cases name those agents too. Chaining by contract would mean reading each ref's `agent.md`, including refs from before this change, and replacing the triage note's heading, which is the code factory's wording. TL-16 is changing the same files for scorers, so this is a follow-up of its own. Until it lands, `pnpm bench` works for any factory whose benchmark stages are named `triage`, `spec`, `implement` and `review`.

## What the numbers said

**The code factory's inputs did not change.** `main`'s `run-issue.sh` and this branch's each replayed all four agents on the same case. Each run used a fake `claude` that recorded its arguments, a local target repository and a `gh` that always fails. Run and temporary paths and timestamps were masked, and each run had its run directory to itself. For all four agents these were byte-identical: every argument to `claude`, including the system prompt with its skills and rules, plus `settings.json` with its hooks, `prompt.md`, stdout and the exit status. `run.json` differed in one field, the new `contract`. (A first attempt showed a `gate_attempts` difference for review. Two runs had started in the same second and shared a run directory, so review had read implement's `gates.jsonl`. The harness caused it, not the change, and the rerun with separate directories showed none.) The publishing paths that a replay skips, which comment on a PR and open one, changed only in their conditions: the review comment's wording now names the agent, which for the code factory is still "review".

**No benchmark was run.** CLAUDE.md asks for one when a prompt, model or gate changes. Here the agents' inputs and gates are byte-identical to `main`'s, so a benchmark could only measure sampling noise, which TL-17's two passes per ref already put at about $0.07 per bench. Spend: $0.

**Tests.** `pnpm typecheck`, `lint` and `test` pass, 139 tests (142 on `main`). The count fell by three: five tests tied to the code factory were removed, one test was added for the contract, two `report` tests were merged, and the definitions test makes two per factory.

**Independence, checked both ways.** In a copy of each checkout with `factories/` emptied, this branch's tests passed: 138 run, 138 passed. `main`'s had 7 failures: the four agent parses, the chain test, `queue.test.ts` as a whole and the replay test. In a copy where a `.ts` file was added under `factories/code/` and triage's contract was set to `triage`, the definitions test failed on each, naming the file and saying `contract must be one of note, spec, pull-request, review; got triage`. With `skills/pr-description/` renamed, it failed with `implement needs skills/pr-description/`.
