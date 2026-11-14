# scorers

How a benchmark result is graded, one `scorers/<scorer>/scorer.md` each (TL-16). `pnpm bench` runs every scorer on every result, and each scorer that applies stores a number and a one-line reason in the run log. The file's `measure` names the code that computes it, in `platform/scorers/scorers.ts`; the text after the settings says what the number means.

| Scorer | Grades | Number |
| --- | --- | --- |
| [tests](tests/scorer.md) | implement runs of cases with `checks` | 1 if the case's checks pass on the handed-off patch, else 0 |
| [scope](scope/scorer.md) | implement runs that handed off a patch | the share of changed files among the case's `files` |
| [findings](findings/scorer.md) | review runs | the findings the review raised |
| [cost](cost/scorer.md) | every run that reported a cost | `cost_usd` |
