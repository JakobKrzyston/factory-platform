# Queue

The factory's work queue is GitHub issue labels. An issue's one `factory:*` label is its state, so every transition is a label change in the issue's timeline, made by the factory App.

Four of the states queue an agent (TL-7). Adding the label starts that role; while it works the issue is `in-progress`; when it succeeds the factory adds the next label, which starts the next role:

```
 human adds
factory:ready ──triage──▶ factory:spec ──spec──▶ factory:implement ──implement──▶ factory:review ──review──▶ factory:in-review ──▶ factory:done
                  │                       │                            │                            │        a human reviews       PR merged,
                  └───────────────────────┴────────────┬───────────────┴────────────────────────────┘        and merges            issue closed
                                                       ▼
                                              factory:needs-human   question, failure or timeout, with a comment saying which;
                                                                    a human answers and re-adds the label of the role that stopped
```

The chain is `STAGES` in `queue.ts`. Each role's definition is `factories/code/agents/<role>/agent.md`.

`.github/workflows/factory.yml` runs on every `issues` event:

- **`factory:ready`, `factory:spec`, `factory:implement` or `factory:review` added**: the `run` job claims the issue (that label to `in-progress`), prepares the runner, and runs `scripts/run-issue.sh <role>` on it. On success it posts a comment and then moves the issue to the next state: the triage note before `spec`, the spec (headed `<!-- factory:spec -->`) before `implement`, a link to the draft PR before `review`, and a pointer to the review before `in-review`. The comment goes first so it is on the issue before the role that reads it starts. Otherwise the issue moves to `needs-human` with a comment. A run that times out, is cancelled or whose runner cannot be set up also ends at `needs-human`. The script writes the run's row in the run log (TL-12, `platform/runlog/README.md`). The run's settings, transcript and `run.json` are uploaded as an artifact named after the issue and the role.
- **Issue closed as completed while `in-review`**: the `done` job moves it to `done` and records on the issue's runs whether a human changed the PR before merging (`rework`). The factory's PR says `Closes #N`, so merging it does this.

`needs-human` is a state, not a failure. When the agent cannot go on without a person's decision, it ends its run with `QUESTION:` and the question. The quality gate's stop hook (TL-5) lets that stop through without running the checks. `run-issue.sh` then exits 3, and the workflow posts the question as a comment. To answer, reply on the issue and add the label of the role that asked again, or `factory:ready` to start over. The next run's prompt includes comments from the owner, members and collaborators, the people who can add labels, and from the factory App itself, so the question sits beside its answer, and the implementer sees the triage note and the spec. The reviewer sees none of them: its prompt is the latest spec comment and the PR's diff. Nobody else's comments reach the agent. The issue body does, whoever wrote it, so it is treated as untrusted and the run's confinement is what makes that safe.

## One run per issue

The `run` job's concurrency group is the issue number, and the group does not cancel a run in progress. GitHub lets at most one job in the group run at a time; another waits. The next role's run starts while the previous one is still uploading its artifact, and waits there. When a waiting run starts, it claims the issue only if the issue is still open and still carries the label that started it. The first run removed that label, so a duplicate stops without doing anything.

## Secrets

The workflow's secrets are in a GitHub environment called `factory` that deploys from `main` only. A workflow running a factory branch's code, such as CI on the agent's PR, cannot read them even if it names the environment (#33). The agent itself never holds them: `run-issue.sh` gives it only `PATH` and `HOME`, and Claude Code's sandbox gives Bash its own process namespace, so it cannot read the script's environment either. The script's own git commands do run with the App token, so the clone's git metadata is kept outside the clone, where the agent cannot write: it cannot commit, or plant a hook or config that those commands would run.

## Setting up a repository

```sh
pnpm queue setup <owner/repo>            # the state labels and the factory environment; needs gh signed in as an admin; rerun when STATES changes
gh secret set ANTHROPIC_API_KEY --env factory --repo <owner/repo>
gh secret set FACTORY_APP_PRIVATE_KEY --env factory --repo <owner/repo> < factory-app.pem
gh variable set FACTORY_APP_ID --env factory --repo <owner/repo> --body <app-id>
gh secret set DATABASE_URL --env factory --repo <owner/repo>      # the run log's Neon connection string
```

Without `DATABASE_URL` the run log is a SQLite file on the runner, uploaded with the run's artifact and in no shared table.

The factory App (TL-10) must be installed on the repository with read-write Contents, Issues and Pull requests.

`pnpm queue stage <state>`, `pnpm queue claim <owner/repo> <issue> <state>` and `pnpm queue set <owner/repo> <issue> <state> [comment.md]` are what the workflow calls. Run by hand with `gh` signed in, they move an issue the same way.
