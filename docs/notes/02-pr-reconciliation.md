# 02: Pull requests reconcile the roadmap automatically (TL-2)

## Expected

Register a GitHub App for the private Throughline instance, install it on this repository, connect the repository on the `factory` project, and a merged pull request that says `Implements TL-n` turns into a reconciliation proposal within minutes. Configuration only, following Throughline's `docs/GITHUB_APP.md` and the private-instance section of `docs/DEPLOY.md`.

## Happened

The code worked the first time it was reached. Every failure was configuration, and each one was in a different place:

1. **Connecting failed with "Could not reach GitHub."** The real error, only in the Vercel logs, was `DataError: Invalid keyData … asn1 encoding routines::wrong tag`: the app's private key had been pasted into Vercel in a form that no longer parsed. Storing the `.pem` file directly (`vercel env add … < private-key.pem`) fixed it.
2. **The repository could not be selected when installing the app.** GitHub said "This App does not require access to your repositories": the app had been created with every repository permission at "No access". Adding read-only Contents, Issues and Pull requests, and subscribing to Issues and Pull request events, made the repository selectable.
3. **The merge webhook never reached Throughline.** GitHub's Recent Deliveries showed four failures before a success: three 401s from Vercel Authentication (no bypass in the URL, then the secret joined to the path without `?x-vercel-protection-bypass=`, then the literal placeholder `<secret>`), then a 401 `Bad signature` from Throughline because the app's webhook secret did not match `GITHUB_WEBHOOK_SECRET`. A fresh secret set in both places gave a 200. Requests that Vercel's protection rejects never reach the function, so none of the first three showed up in the Vercel logs. (Vercel answers a signed-out POST with 401 and a signed-out GET with a 302 to sign-in, which is why note 01 records 302s; both rechecked 2026-11-09.)

One bypass secret appeared in a pasted delivery response and was replaced.

The acceptance list asks for a PR that implements TL-4; the test used PR #25, which implements TL-1, instead, because no TL-4 work exists yet. It runs the same code path, but the literal check is still owed: #30 confirms it on the first TL-4 merge.

One side effect: TL-2's own issue text contained the keyword `Implements` followed by TL-4 in its acceptance list, so Throughline linked that issue to TL-4 as well as TL-2. References in prose count as references. Issue #2 was edited by hand to remove the phrase, and the acceptance in `docs/roadmap.ts` was reworded without it, so regenerating the issues cannot bring the link back. The matcher itself is tracked in throughline-roadmap#78.

## What the numbers said

| Measure | Value |
| --- | --- |
| Open issues imported on connect | 23 (#2 to #24; #1 was already closed) |
| Deliveries of the PR #25 merge event | 5: 4 failed (401), 1 succeeded (200) |
| Merge to proposal, wall clock | 67 minutes (01:40 to 02:47 UTC), almost all of it fixing configuration |
| Successful delivery to pending proposal (redelivered PR #25 event) | 7 seconds |
| Live merge to pending proposal (PR #26, no redelivery) | About 9.5 seconds: merged 02:56:01, proposal created 02:56:10.5 UTC, approved 02:58:54 |
| Proposal | Names TL-1, classifies it as done, cites the stage note's evidence |
| Model cost | One reconciliation call; not measured, as there is no run log until TL-11 |

The 7 seconds, and the 9.5 on a live merge, are what TL-2 promises. The 67 minutes is the lesson: an integration that fails quietly needs a check you can run, not a status page you have to know to open; that check is #32. GitHub's Recent Deliveries was the only place that showed all four failures.
