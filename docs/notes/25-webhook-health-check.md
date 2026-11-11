# 25: Health check for the GitHub-to-Throughline webhook (TL-25)

## Expected

TL-2's link failed silently four times (note 02): three 401s from Vercel protection and one bad signature. None reached the Vercel logs, because protection rejects a request before the function runs. One command should now show what GitHub's Recent Deliveries page showed, and also prove that the webhook URL still gets past protection.

- `pnpm check-webhook` acts as Throughline's GitHub App. It lists the App's latest deliveries and fails if the newest one did not get a 2xx.
- It then reads the webhook URL from the App's own settings and POSTs to it unsigned. Using that URL means the probe tests the bypass GitHub actually sends, not a copy that could have drifted. Throughline answers a missing signature with 401 `{"error":"Bad signature"}` and stops there. Vercel's refusal is a 401 page or a redirect to sign-in, so the two are easy to tell apart.
- A daily workflow runs it. GitHub keeps deliveries for about three days and can redeliver them, so a link that breaks is found while the merge it missed can still be redelivered.

The probe cannot catch a rotated webhook secret, because a probe signed with the real secret would need that secret on the runner. The delivery list catches it instead: the next real delivery shows up as a 401 `Bad signature`.

## Happened

TODO: the first `pnpm check-webhook` against the live instance, and the first scheduled run.

## What the numbers said

TODO: deliveries listed, probe status, run time.
