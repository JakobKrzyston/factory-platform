# Factory: code

The first factory. Turns a `factory:ready` issue on this repository into a reviewed pull request. The format of every file here is in [`../README.md`](../README.md).

```
factory.yaml                 serves JakobKrzyston/factory-platform; the foreman is triage
agents/                      triage, spec, implement, review (agents/README.md)
triggers/                    the chain below, one folder per label (triggers/README.md)
skills/pr-description/       how implement writes the PR description its gate checks
scorers/                     empty until TL-16
```

The chain, from `triggers/`:

| Trigger | Label | Agent | Success moves to |
| --- | --- | --- | --- |
| `ready` | `factory:ready` | `triage` (the foreman) | `factory:spec` |
| `spec` | `factory:spec` | `spec` | `factory:implement` |
| `implement` | `factory:implement` | `implement` | `factory:review` |
| `review` | `factory:review` | `review` | `factory:in-review`, where a human reviews and merges |
