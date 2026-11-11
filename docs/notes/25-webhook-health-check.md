# 25: Health check for the GitHub-to-Throughline webhook (TL-25)

## Expected

TL-2's link failed silently four times (note 02): three 401s from Vercel protection and one bad signature. None reached the Vercel logs, because protection rejects a request before the function runs. One command should now show what GitHub's Recent Deliveries page showed, and also prove that the webhook URL still gets past protection.

- `pnpm check-webhook` acts as Throughline's GitHub App. It lists the App's latest deliveries and fails if the newest one did not get a 2xx.
- It then reads the webhook URL from the App's own settings and POSTs to it unsigned. Using that URL means the probe tests the bypass GitHub actually sends, not a copy that could have drifted. Throughline answers a missing signature with 401 `{"error":"Bad signature"}` and stops there. Vercel's refusal is a 401 page or a redirect to sign-in, so the two are easy to tell apart.
- A daily workflow runs it. GitHub keeps deliveries for about three days and can redeliver them, so a link that breaks is found while the merge it missed can still be redelivered.

The probe cannot catch a rotated webhook secret, because a probe signed with the real secret would need that secret on the runner. The delivery list catches it instead: the next real delivery shows up as a 401 `Bad signature`.

## Happened

The first live run, on 2026-11-11 from a laptop with the App's credentials in `.env.local`, exited 1 with both checks failed. It had found a real outage that nobody had noticed.

- **Every listed delivery got 401.** All ten were refused, from `issues.labeled` at 2026-11-10T04:10:06Z through `pull_request` opened, edited, synchronize and closed, and `issues.opened`, to the newest, `installation.new_permissions_accepted` at 2026-11-10T18:40:16Z.
- **The probe was refused by Vercel.** The URL in the App's settings has an `x-vercel-protection-bypass` parameter, but Vercel answered 401 before Throughline ran. A bypass is present and Vercel no longer accepts it. The likely cause is that the bypass was replaced (note 02: "One bypass secret appeared in a pasted delivery response and was replaced") but the App's webhook URL was never updated. That is unconfirmed.

So the PR reconciliation has been down since at least 04:10 UTC on 2026-11-10. That is the oldest delivery in the ten shown, so the outage may have started earlier. Repairing it is configuration in Vercel and the App's settings, outside this stage. Missed deliveries can be redelivered for about three days.

One thing is still open. Nine pull requests merged after the newest listed delivery: #38 at 18:54 UTC on 2026-11-10, and the last, #43, at 14:47 UTC on 2026-11-11. None of their deliveries is in the list. Either the App stopped sending after the permission change at 18:40, or GitHub does not return deliveries newest first, which this check assumes. If it is the second, the check is judging an older page of deliveries, not the latest one. The App's **Advanced** tab settles it. If it also shows nothing newer than 18:40:16Z, the App stopped sending and the order holds.

The scheduled workflow has not run yet. It needs the `throughline` environment, which is not set up, and GitHub only schedules or dispatches workflows that are on `main`.

## What the numbers said

| Measure | Value |
| --- | --- |
| Deliveries listed | 10, all 401 |
| Newest delivery listed | 2026-11-10T18:40:16Z, `installation.new_permissions_accepted` |
| Oldest delivery listed | 2026-11-10T04:10:06Z, `issues.labeled` |
| Probe | 401 from Vercel protection, with a bypass in the URL |
| Exit code | 1 |
| Merges after the newest listed delivery | 9 (#38 to #43), none of them in the list |
| Outage, before this check | At least 34 hours unnoticed (04:10 UTC on 2026-11-10 to a run after 14:47 UTC on 2026-11-11) |
| Time to find it with the check | One command |

Note 02 needed 67 minutes and GitHub's Recent Deliveries page to see four failures. One command found this outage, and it named the layer that refused the request.
