# Queue

The factory's work queue is GitHub issue labels. An issue's one `factory:*` label is its state, so every transition is a label change in the issue's timeline, made by the factory App.

Some labels start an agent (TL-7): each factory's triggers, `factories/<name>/triggers/` (TL-17). The code factory has four. Adding the label starts that role; while it works the issue is `in-progress`; when it succeeds the factory adds the next label, which starts the next role:

```
 human adds
factory:ready ──triage──▶ factory:spec ──spec──▶ factory:implement ──implement──▶ factory:review ──review──▶ factory:in-review ──▶ factory:done
                  │                       │                            │                            │        a human reviews       PR merged,
                  └───────────────────────┴────────────┬───────────────┴────────────────────────────┘        and merges            issue closed
                                                       ▼
                                              factory:needs-human   question, failure, timeout, or a PR missing its risk or
                                                                    evidence, with a comment saying which; a human answers or
                                                                    fixes it and re-adds the label of the role that stopped
```

The chain is the code factory's triggers: each `trigger.yaml` names its label, its agent and the label its success moves to (`factories/README.md`). Each role's definition is `factories/code/agents/<role>/agent.md`. The queue itself knows only the states every factory shares, `STATES` in `queue.ts`: `in-progress`, `in-review`, `needs-human` and `done`. `platform/factory/` refuses a factory whose chain does not end at `in-review`.

`.github/workflows/factory.yml` runs on every `issues` event:

- **Any `factory:*` label added**: the `route` job runs `queue route`, which finds the factory listing this repository and its trigger on that label. A label that is no trigger's, such as the `in-progress` the App adds itself, stops there. Otherwise, for the code factory **`factory:ready`, `factory:spec`, `factory:implement` or `factory:review`**, the `run` job claims the issue (that label to `in-progress`), prepares the runner, and runs `scripts/run-issue.sh <agent>` on it. `queue report` then words what happened and moves the issue. On success it posts the trigger's `comment.md` and then moves the issue to the trigger's `next`: the triage note before `spec`, the spec (headed `<!-- factory:spec -->`) before `implement`, a link to the draft PR before `review`, and a pointer to the review before `in-review`. The comment goes first so it is on the issue before the role that reads it starts. Otherwise the issue moves to `needs-human` with a comment. A PR whose description still lacks its risk or evidence after the stop hook gave up refusing it (TL-8, `factories/code/skills/pr-description/SKILL.md`) also goes to `needs-human` instead of `review`, with a comment listing what is missing, so the reviewer never runs on a PR a person must fix first. The person fills the description in, then adds `factory:review` or merges. A run that times out, is cancelled or whose runner cannot be set up also ends at `needs-human`. The script writes the run's row in the run log (TL-12, `platform/runlog/README.md`). The run's settings, transcript and `run.json` are uploaded as an artifact named after the issue and the role.
- **Issue in any factory state closed as completed**: the factory's PR says `Closes #N`, so merging it does this, whether or not the review agent has finished, and from `needs-human` after a person filled in an incomplete description. The `done` job moves the issue to `done` only if the factory's PR (a `factory/issue-<n>-...` branch of this repository) is what merged; an issue a human closed without one keeps its label. It also records on the issue's runs whether a human changed the PR before merging (`rework`).

A closed issue moves only to `done`. A run that ends after a human closed the issue still posts its comment but leaves the label alone, and implement opens no PR for an issue closed during its run.

`needs-human` is a state, not a failure. When the agent cannot go on without a person's decision, it ends its run with `QUESTION:` and the question. The quality gate's stop hook (TL-5) lets that stop through without running the checks. `run-issue.sh` then exits 3, and the workflow posts the question as a comment. To answer, reply on the issue and add the label of the role that asked again, or `factory:ready` to start over. When an answer to implement changes the spec, add `factory:spec` instead: the reviewer judges the diff against the spec alone, so the spec has to carry the answer. The next run's prompt includes comments from the owner, members and collaborators, the people who can add labels, and from the factory App itself, so the question sits beside its answer, and the implementer sees the triage note and the spec. The reviewer sees none of them: its prompt is the latest spec comment and the PR's diff. Nobody else's comments reach the agent. The issue body does, whoever wrote it, so it is treated as untrusted and the run's confinement is what makes that safe.

## One run per issue

The `run` job's concurrency group is the issue number, and the group does not cancel a run in progress. GitHub lets at most one job in the group run at a time; another waits. The next role's run starts while the previous one is still uploading its artifact, and waits there. When a waiting run starts, it claims the issue only if the issue is still open and still carries the label that started it. The first run removed that label, so a duplicate stops without doing anything.

## Secrets

The workflow's secrets are in a GitHub environment called `factory` that deploys from `main` only. A workflow running a factory branch's code, such as CI on the agent's PR, cannot read them even if it names the environment (#33). The agent itself never holds them: `run-issue.sh` gives it only `PATH` and `HOME`, and Claude Code's sandbox gives Bash its own process namespace, so it cannot read the script's environment either. The script's own git commands do run with the App token, so the clone's git metadata is kept outside the clone, where the agent cannot write: it cannot commit, or plant a hook or config that those commands would run.

## Setting up a repository

```sh
pnpm queue setup <owner/repo>            # the state labels, the trigger labels of every factory serving the repository, and the factory environment; needs gh signed in as an admin; rerun when STATES or a trigger changes
gh secret set ANTHROPIC_API_KEY --env factory --repo <owner/repo>
gh secret set FACTORY_APP_PRIVATE_KEY --env factory --repo <owner/repo> < factory-app.pem
gh variable set FACTORY_APP_ID --env factory --repo <owner/repo> --body <app-id>
gh secret set DATABASE_URL --env factory --repo <owner/repo>      # the run log's Neon connection string
```

Without `DATABASE_URL` the run log is a SQLite file on the runner, uploaded with the run's artifact and in no shared table.

The factory App (TL-10) must be installed on the repository with read-write Contents, Issues and Pull requests.

`pnpm queue route <owner/repo> <label>`, `pnpm queue claim <owner/repo> <issue> <label>`, `pnpm queue report <owner/repo> <issue> <factory> <trigger> <exit-code> <output-file> <run-url>`, `pnpm queue set <owner/repo> <issue> <label> [comment.md]` and `pnpm queue done <owner/repo> <issue>` are what the workflow calls. Labels are given whole, e.g. `factory:needs-human`. Run by hand with `gh` signed in, they move an issue the same way.
