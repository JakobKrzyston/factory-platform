# Factory: docs

The second factory, made by copying [`../code/`](../code/) and editing its agents and triggers (TL-19; what changed and why is in [`docs/notes/19-second-factory.md`](../../docs/notes/19-second-factory.md)). Turns a `factory:docs` issue on this repository into a reviewed pull request that changes documentation only. The format of every file here is in [`../README.md`](../README.md).

```
factory.yaml                 serves JakobKrzyston/factory-platform; the foreman is triage
agents/                      triage, spec, implement, review (agents/README.md)
triggers/                    the chain below, one folder per label (triggers/README.md)
skills/pr-description/       how implement writes the PR description its gate checks; the code factory's, unchanged
scorers/                     the code factory's four, unchanged
```

The chain, from `triggers/`:

| Trigger | Label | Agent | Success moves to |
| --- | --- | --- | --- |
| `ready` | `factory:docs` | `triage` (the foreman) | `factory:docs-spec` |
| `spec` | `factory:docs-spec` | `spec` | `factory:docs-implement` |
| `implement` | `factory:docs-implement` | `implement` | `factory:docs-review` |
| `review` | `factory:docs-review` | `review` | `factory:in-review`, where a human reviews and merges |

"Documentation only" is what the prompts ask for and what the review agent checks; no gate enforces it yet. The implement agent runs under the same `pull-request` gate as the code factory's, which runs the repository's typecheck, lint and test scripts.
