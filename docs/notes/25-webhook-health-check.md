# 25: Health check for the GitHub-to-Throughline webhook (TL-25)

## Expected

TL-2's link failed silently four times (note 02): three 401s from Vercel protection and one bad signature. None reached the Vercel logs, because protection rejects a request before the function runs. One command should now show what GitHub's Recent Deliveries page showed, and also prove that the webhook URL still gets past protection.

- `pnpm check-webhook` acts as Throughline's GitHub App. It lists the App's latest deliveries and fails if the newest one did not get a 2xx.
- It then reads the webhook URL from the App's own settings and POSTs to it unsigned. Using that URL means the probe tests the bypass GitHub actually sends, not a copy that could have drifted. Throughline answers a missing signature with 401 `{"error":"Bad signature"}` and stops there. Vercel's refusal is a 401 page or a redirect to sign-in, so the two are easy to tell apart.
- A daily workflow runs it. GitHub keeps deliveries for about three days and can redeliver them, so a link that breaks is found while the merge it missed can still be redelivered.

The probe cannot catch a rotated webhook secret, because a probe signed with the real secret would need that secret on the runner. The delivery list catches it instead: the next real delivery shows up as a 401 `Bad signature`.

## Happened

**The first run checked the wrong App.** It ran on 2026-11-11 from a laptop and exited 1, with both checks failed. But `THROUGHLINE_APP_ID` in `.env.local` was 5688742, the factory App (slug `factory-application`, formerly `throughline-factory-2`, note 10), not Throughline's. That App still had a webhook copied from Throughline's App, with an 8-character bypass. All 35 of its deliveries since it was created (2026-11-09T23:08Z) got 401, and Vercel refused the probe. Both verdicts were true of the App that was checked. Throughline's own App was not checked at all, so this run says nothing about the reconciliation link.

The check had no way to show it. Both Apps sign the same way, and nothing in the output named the App. It now starts by printing the slug and ID from `GET /app`, so a run against the wrong App is obvious from the first line. The factory App's leftover webhook is a separate matter. It delivers to nothing useful and is left to the owner.

The run does give one piece of evidence about the check itself. The ten deliveries it listed ran from 2026-11-10T04:10:06Z to 18:40:16Z, and the App had 35 in all, starting at 2026-11-09T23:08Z. A list in oldest-first order would have started at 23:08Z on 2026-11-09, so this one was newest first, as the check assumes.

One more wrong-credentials case turned up along the way. An App ID paired with a different App's key gets `JSON web token could not be decoded` from GitHub. That one at least fails loudly rather than checking the wrong webhook.

**The run against Throughline's App passed.** It used `throughline-reconciliation-app` (5687858; key fingerprint `SHA256:8ziq1Foog3WSQSDX29LkXm+9gD+SCDP5v3J+jmIAaPE=`) and exited 0 with both checks ok. All ten listed deliveries got 200. The oldest of them is `issues.closed` at 2026-11-11T14:48:02Z, three seconds after #43's merge (14:47:57Z) closed issue #34 (14:47:59Z). The newest is `pull_request.edited` at 15:37:01Z. The unsigned probe got Throughline's 401 `Bad signature`, so the bypass in the App's URL still gets past Vercel protection.

The first run's `FAILED` lines looked exactly like a real outage. Only the App's ID showed that it was not one, and nothing printed the ID until this stage added the slug line.

The scheduled workflow has not run. The `throughline` environment and its secrets are not set up, and GitHub only schedules or dispatches workflows that are on `main`. That check is owed after merge.

## What the numbers said

| Measure | First run (factory App, by mistake) | Second run (Throughline's App) |
| --- | --- | --- |
| App checked | 5688742, `factory-application` | 5687858, `throughline-reconciliation-app` |
| Deliveries listed | 10 of 35, all 401 | 10, all 200 |
| Listed span | 2026-11-10T04:10:06Z to 18:40:16Z | 2026-11-11T14:48:02Z to 15:37:01Z |
| Probe | 401 from Vercel protection, bypass present | 401 `Bad signature` from Throughline |
| Exit code | 1 | 0 |

The first lesson came before any number about the webhook. A health check has to say what it checked. Otherwise a correct result about the wrong App reads as an outage.
