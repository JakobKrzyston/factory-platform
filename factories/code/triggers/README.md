# triggers

One folder per label that starts an agent: `trigger.yaml` names the label, the agent and the label its success moves to; `comment.md` is what the queue posts when the agent succeeds; `implement/question.md` adds a line to implement's questions. Every field: [`../../README.md`](../../README.md).

`ready` is the entry trigger: a person adds `factory:ready`, and the foreman, triage, runs. Each later label is added by the factory App when the agent before it succeeds. A person adds one again to rerun that step.
