# Queue

The factory's work queue is GitHub issue labels. An issue's one `factory:*` label is its state, so every transition is a label change in the issue's timeline, made by the factory App.

```
                 human adds              run claims              PR opened
(any issue) ───▶ factory:ready ───────▶ factory:in-progress ───▶ factory:in-review ───▶ factory:done
                      ▲                         │                                      PR merged,
                      │                         ▼                                      issue closed
                      └──── human answers ── factory:needs-human
                            and re-adds          question, failure or timeout,
                            factory:ready        with a comment saying which
```

`.github/workflows/factory.yml` runs on every `issues` event:

- **`factory:ready` added**: the `run` job claims the issue (`ready` to `in-progress`), prepares the runner, runs `scripts/run-issue.sh` on it, and moves it to `in-review` if a PR opened or to `needs-human` with a comment otherwise. A run that times out, is cancelled or whose runner cannot be set up also ends at `needs-human`. The script writes the run's row in the run log (TL-12, `platform/runlog/README.md`). The run's settings, transcript and `run.json` are uploaded as an artifact.
- **Issue closed as completed while `in-review`**: the `done` job moves it to `done` and records on the issue's runs whether a human changed the PR before merging (`rework`). The factory's PR says `Closes #N`, so merging it does this.

`needs-human` is a state, not a failure. When the agent cannot go on without a person's decision, it ends its run with `QUESTION:` and the question. The quality gate's stop hook (TL-5) lets that stop through without running the checks. `run-issue.sh` then exits 3, and the workflow posts the question as a comment. To answer, reply on the issue and add `factory:ready` again. The next run's prompt includes comments from the owner, members and collaborators, the people who can add labels, and from the factory App itself, so the question sits beside its answer. Nobody else's comments reach the agent. The issue body does, whoever wrote it, so it is treated as untrusted and the run's confinement is what makes that safe.

## One run per issue

The `run` job's concurrency group is the issue number, and the group does not cancel a run in progress. GitHub lets at most one job in the group run at a time; another waits. When a waiting run starts, it claims the issue only if the issue is still open and still labelled `factory:ready`. The first run removed that label, so a duplicate stops without doing anything.

## Secrets

The workflow's secrets are in a GitHub environment called `factory` that deploys from `main` only. A workflow running a factory branch's code, such as CI on the agent's PR, cannot read them even if it names the environment (#33). The agent itself never holds them: `run-issue.sh` gives it only `PATH` and `HOME`, and Claude Code's sandbox gives Bash its own process namespace, so it cannot read the script's environment either. The script's own git commands do run with the App token, so the clone's git metadata is kept outside the clone, where the agent cannot write: it cannot commit, or plant a hook or config that those commands would run.

## Setting up a repository

```sh
pnpm queue setup <owner/repo>            # labels and the factory environment; needs gh signed in as an admin
gh secret set ANTHROPIC_API_KEY --env factory --repo <owner/repo>
gh secret set FACTORY_APP_PRIVATE_KEY --env factory --repo <owner/repo> < factory-app.pem
gh variable set FACTORY_APP_ID --env factory --repo <owner/repo> --body <app-id>
gh secret set DATABASE_URL --env factory --repo <owner/repo>      # the run log's Neon connection string
```

Without `DATABASE_URL` the run log is a SQLite file on the runner, uploaded with the run's artifact and in no shared table.

The factory App (TL-10) must be installed on the repository with read-write Contents, Issues and Pull requests.

`pnpm queue claim` and `pnpm queue set <owner/repo> <issue> <state> [comment.md]` are what the workflow calls. Run by hand with `gh` signed in, they move an issue the same way.
