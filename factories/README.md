# factories

One folder per factory. A factory is data: every file here is a definition, and the code that reads and runs it lives in `platform/` (rule 5 in `CLAUDE.md`). A resource's name is its path: the factory is named by its folder, each agent by its folder under `agents/`, each trigger by its folder under `triggers/`. Creating a factory is copying a folder; splitting one is moving agent and trigger folders.

```
factories/<name>/
  factory.yaml                      which repositories it serves, which agent is the foreman
  agents/<agent>/agent.md           one agent: its contract, model, tools, budget, time limit, prompt
  agents/<agent>/skills/<skill>/    skills for that agent only
  triggers/<trigger>/trigger.yaml   the label that starts an agent, and the label its success moves to
  triggers/<trigger>/comment.md     the comment posted when that agent succeeds
  triggers/<trigger>/question.md    optional: added to the comment when that agent asks a question
  scorers/<scorer>/scorer.md        how a benchmark result is graded (TL-16)
  skills/<skill>/SKILL.md           skills shared by every agent in the factory
```

`platform/factory/factory.ts` reads `factory.yaml` and the triggers, and refuses a factory whose files are missing or malformed or whose chain does not end with a human. `platform/agents/agent.ts` reads `agent.md`. Both refuse an unknown field.

`pnpm validate-factory factories/<name>` checks a whole factory before it merges (TL-20, `platform/factory/validate.ts`). It runs what the readers refuse, and also checks that every `agent.md` and `scorer.md` parses, that a `pull-request` agent's factory has `skills/pr-description/`, that every folder under `scorers/` holds a `scorer.md` naming a measure that exists, that every file is Markdown or YAML, and that no line looks like a secret. It prints each problem with its file and exits 1. CI runs it on every factory in every pull request, and `pnpm test` runs it too, so the stop hook refuses a broken factory as well.

## The YAML files

`factory.yaml` and `trigger.yaml` are plain `key: value` lines. A value may be double-quoted, a list is written `[a, b]`, and a line starting with `#` is a comment. Nothing else (no nesting, no multi-line values), so a YAML 1.2 parser reads them the same way as the platform's reader. Quote a value YAML would read as a number, such as the colour `"5319E7"`.

## factory.yaml

```yaml
repositories: [JakobKrzyston/factory-platform]
foreman: triage
```

| Field | Required | Meaning |
| --- | --- | --- |
| `repositories` | yes | The `owner/name` repositories whose issues this factory works. A label added to an issue in any other repository starts nothing from this factory. `pnpm queue setup <owner/repo>` creates the trigger labels of every factory listing that repository. |
| `foreman` | yes | The agent that first sees every issue: the agent of the entry trigger, the one trigger no other trigger's `next` leads to. It must name a folder under `agents/`. While the queue does the dispatching, the foreman decides whether the issue goes on at all; when an agent dispatches the others itself, this field already names it. |

There is no `name` field: the factory's name is its folder, and that name is what the run log records. Settings such as the model belong to each agent's `agent.md`, so there are no factory-wide defaults.

## triggers/&lt;trigger&gt;/trigger.yaml

```yaml
on: label
label: factory:ready
agent: triage
next: factory:spec
color: "0E8A16"
description: Queued for the factory. Adding this label starts the triage agent.
```

| Field | Required | Meaning |
| --- | --- | --- |
| `on` | yes | What starts the run. Only `label` so far: a label added to an issue. |
| `label` | yes | The label that starts the run. It starts with `factory:`, the queue's prefix, because an issue carries one `factory:*` label at a time and moving it removes the others. No two triggers in a factory share a label. |
| `agent` | yes | The agent the run starts: a folder under `agents/` holding an `agent.md`. |
| `next` | yes | The label the issue moves to when the agent succeeds: another trigger's `label`, which starts that trigger's agent, or `factory:in-review`, where a human takes over. Following `next` from any trigger must reach `factory:in-review` without looping, so every chain ends with a human. |
| `color` | yes | The label's colour on GitHub, six hex digits, quoted. |
| `description` | yes | The label's description on GitHub. |

The trigger's name is its folder. `pnpm queue route` gives the workflow the factory, trigger and agent a label starts, and `pnpm queue report` reads the trigger's two Markdown files to word the run's comment.

## triggers/&lt;trigger&gt;/comment.md

The comment posted on the issue when the agent succeeds, before the issue moves to `next`, so the next agent can read it. `{output}` is replaced by what `scripts/run-issue.sh` printed (a triage note, a spec, a pull request's URL) and `{run_url}` by the Actions run. The spec trigger's comment starts with `{output}`, because the spec's first line is the `<!-- factory:spec -->` marker the review agent finds it by. Only the spec's comment may start with that marker, so the triage comment starts with a heading.

## triggers/&lt;trigger&gt;/question.md

Optional. When the agent stops with a question, the queue posts it quoted, says to answer and add the trigger's label again, and then adds this file's text. The code factory's implement trigger uses it to say when to go back to `factory:spec` instead.

What the platform posts for a failure, a question and an incomplete pull request description is otherwise the same for every trigger: `report` in `platform/queue/queue.ts`.

## agents/&lt;agent&gt;/agent.md

Documented in [`code/agents/README.md`](code/agents/README.md): `description`, `contract`, `model`, `tools`, `budget_usd` and `time_limit_seconds` between `---` fences, then the system prompt.

`contract` picks one of the platform's contracts (TL-18): what `scripts/run-issue.sh` gives the agent, which gate it runs under and what becomes of its answer. The script reads the contract, never the agent's name, so a new agent or a copied factory needs no change outside `factories/`.

| Contract | Given | Gate | Its answer |
| --- | --- | --- | --- |
| `note` | the issue and its trusted comments | none | printed; the queue posts it with the trigger's `comment.md` |
| `spec` | the same | none | printed under the `<!-- factory:spec -->` marker, which a `review` agent finds it by |
| `pull-request` | the same; a clone on a new branch | the checks and the description check (`platform/gates/`) | a draft PR, whose description is the agent's final message |
| `review` | the latest spec comment and the PR's diff only, in a checkout of the PR's head without its git metadata | every finding cites a standing rule (`platform/standards/`) | a comment on the PR; it cannot ask a question |

Every contract but `review` may end with `QUESTION:`. A `pull-request` agent's prompt also gets the factory's `skills/pr-description/SKILL.md` and the repository's pull request template, because its gate checks the description they describe; a factory with a `pull-request` agent must have that skill, and `platform/factory/definitions.test.ts` fails without it. A `review` agent's prompt also gets `standards/rules.md`, the rules its gate checks.

## skills/ and agents/&lt;agent&gt;/skills/

Each skill is a folder holding a `SKILL.md`. Claude Code loads none by itself (every run uses `--setting-sources ""`), so `run-issue.sh` appends them to the system prompt. Each skill under `agents/<agent>/skills/` is appended to that agent's prompt, in name order, without its front matter if it has any. Skills at the factory root are appended only where a contract names one: `skills/pr-description/` for a `pull-request` agent, as above.

## scorers/

Each scorer grades benchmark results, one folder each holding a `scorer.md` (TL-16). Its settings, between `---` fences, are one field:

| Field | Meaning |
| --- | --- |
| `measure` | The code that computes the number: `tests`, `scope`, `findings` or `cost`, in `platform/scorers/scorers.ts`. The file names one; it does not hold code. |

The text after the settings says what the number means, and must not be empty. The scorer's name in the run log is its folder name. `pnpm bench` reads the scorers from the checkout it runs in, not from the ref it benchmarks, so an old and a new version of a factory are graded by the same scorers. The code factory's are listed in [`code/scorers/README.md`](code/scorers/README.md).
