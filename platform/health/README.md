# Health

Checks that a link between this repository and another system still works. They exist because those links fail quietly: TL-2's webhook failed four times before it worked, and only GitHub's Recent Deliveries page showed it ([note 02](../../docs/notes/02-pr-reconciliation.md)).

## The Throughline webhook (TL-25)

```sh
pnpm check-webhook
```

Acting as Throughline's GitHub App, it:

1. Prints the App's ten most recent webhook deliveries (time, status code, event) and fails if the latest did not get a 2xx. A repository with no deliveries in GitHub's three-day history passes this step.
2. Reads the webhook URL from the App's settings, the exact one GitHub delivers to, and POSTs `{}` to it unsigned. Throughline answers a missing signature with 401 `{"error":"Bad signature"}`, which proves the request got past Vercel protection. Vercel's own 401 page, or a redirect to sign-in, means the bypass in the URL is missing, wrong or revoked. The probe never reaches Throughline's sync code, so it changes nothing.

It exits 1 if either step failed. The output never includes the bypass secret, and on Actions it is masked as well.

`.github/workflows/webhook-health.yml` runs it daily and on demand. A broken link is then found within a day, while GitHub can still redeliver what it missed. GitHub reports a failed scheduled run to whoever last changed the workflow's schedule, and turns scheduled workflows off after 60 days without activity in a public repository.

## Setup

Locally, set `THROUGHLINE_APP_ID` and `THROUGHLINE_APP_PRIVATE_KEY_PATH` in `.env.local`. These are Throughline's App, the one registered in note 02, not the factory App. If the only copy of its key is in the Throughline Vercel project, generate a new one on the App's settings page.

For the workflow, create an environment called `throughline` that deploys from `main` only, then add the App's ID and key to it:

```sh
repo=<owner/repo>
gh api --method PUT repos/$repo/environments/throughline \
  -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api --method POST repos/$repo/environments/throughline/deployment-branch-policies -f name=main
gh variable set THROUGHLINE_APP_ID --env throughline --repo $repo --body <app-id>
gh secret set THROUGHLINE_APP_PRIVATE_KEY --env throughline --repo $repo < throughline-app.pem
```

The key gets its own environment, apart from `factory`, because it can read the webhook URL, and the bypass in that URL opens the whole private instance. Keeping it out of `factory` means no factory run can read it.
