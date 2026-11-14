# agents

One folder per role, each holding an `agent.md`. The factory's triggers (`../triggers/`) chain them by label: `factory:docs` starts `triage`, then `factory:docs-spec`, `factory:docs-implement` and `factory:docs-review` start the role of the same name. `FACTORY=docs scripts/run-issue.sh <agent> <issue-url>` runs one.

| Role | Contract | Given | Produces |
| --- | --- | --- | --- |
| `triage` | `note` | the issue, its comments, a clone it reads but has no Edit tool for | a triage note on the issue, or a question; a question when the fix is not documentation alone |
| `spec` | `spec` | the issue, its comments (triage note included), a clone without Edit | the spec, as an issue comment headed `<!-- factory:spec -->`, naming the pages to change and the source of every fact they will state |
| `implement` | `pull-request` | the issue and its comments, spec included, a clone it can edit and add files to, the gate | a draft PR that changes only the spec's pages |
| `review` | `review` | the spec and the PR's diff only, a clean checkout of the PR's head | a comment on the PR with its findings, including every stated fact the checkout contradicts |

The roles keep the code factory's names on purpose. `pnpm bench` chains a case's stages by agent name (`ROLES` in `platform/bench/cases.ts`), so a docs factory whose writer was called `write` could not be benchmarked.

The format of `agent.md` is in [`../../code/agents/README.md`](../../code/agents/README.md). The `review` contract appends `review/skills/cite-standards/SKILL.md` and then `standards/rules.md`; the skill is the code factory's, unchanged, because the gate that checks the findings' format is the platform's.
