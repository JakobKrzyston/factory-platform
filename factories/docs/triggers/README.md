# triggers

One folder per label that starts an agent: `trigger.yaml` names the label, the agent and the label its success moves to; `comment.md` is what the queue posts when the agent succeeds; `ready/question.md` and `implement/question.md` add a line to triage's and implement's questions: triage's says where a change that is not documentation alone goes, the code factory's `factory:ready`. Every field: [`../../README.md`](../../README.md).

`ready` is the entry trigger: a person adds `factory:docs`, and the foreman, triage, runs. Each later label is added by the factory App when the agent before it succeeds. A person adds one again to rerun that step. Every label starts with `factory:docs` so none is also one of the code factory's: both factories serve this repository, and `pnpm queue route` refuses a label that two of them trigger on.
