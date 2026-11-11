# Dashboard

One HTML page that shows, for each factory and each week, what a pull request cost, how long each stage took, how often each gate passed, and how often a human had to change the work. It reads the run log ([`../runlog/README.md`](../runlog/README.md)) and writes nothing to it.

```sh
pnpm dashboard                  # .runlog/dashboard.html from SQLite, or from Postgres when DATABASE_URL is set
pnpm dashboard out/index.html   # somewhere else
```

The page is self-contained: inline SVG and CSS, no scripts, no external requests. It can be opened from disk, attached to a note, or put behind any static host.

## What each chart means

Rows are production runs that have ended: `benchmark = false` and `status <> 'running'`. A run belongs to the week, Monday to Sunday in UTC, in which it started. Weeks with no runs stay on the axis as gaps, so the x axis is real time.

| Chart | Definition | Columns |
| --- | --- | --- |
| Cost per PR | The week's total `cost_usd` over the distinct PRs the week's runs produced or reviewed. Failed runs that opened no PR still count, because a shipped PR has to pay for the attempts that did not ship. Runs killed before Claude Code reported a cost have a null `cost_usd`, so the total is a lower bound. | `cost_usd`, `repo`, `pr` |
| Time per stage | The median `wall_seconds` of each role's runs, in minutes. One line per role. A role keeps its colour across every factory. | `role`, `wall_seconds` |
| Pass rate at each gate | **Checks**: the share of runs that ran gates whose gates all passed when the run ended. **Review**: the share of reviews that raised no findings. A run with `review_findings` set is a review, whatever its role is called. | `checks_passed`, `review_findings` |
| Rework rate | The share of merged PRs that a human changed between hand-off and merge. Counted per PR, not per run, since `rework` is set on every run of a PR. | `rework`, `repo`, `pr` |

A PR whose runs started in two different weeks counts in both. Factory runs on one PR usually finish within an hour, so this is rare, and it keeps every week's numbers computable from that week's rows alone.

The run log records whether all gates passed, not which one failed. Per-check pass rates would need the gate log (`gates.jsonl`) in the run log, which is a schema change for a later stage.

The table under each factory's charts holds the same numbers, for screen readers and for copying into a note.
