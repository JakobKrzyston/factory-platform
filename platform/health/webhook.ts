/** Health check for the GitHub-to-Throughline webhook (TL-25). Lists the Throughline App's latest
 *  webhook deliveries, then posts an unsigned request to the webhook URL GitHub delivers to, to prove
 *  it still gets past Vercel protection. Exits 1 if the latest delivery failed or the probe did not
 *  reach Throughline. Exports the two verdicts; see platform/health/README.md.
 *
 *  pnpm check-webhook
 *
 *  Needs THROUGHLINE_APP_ID and THROUGHLINE_APP_PRIVATE_KEY_PATH: Throughline's GitHub App, not the factory's. */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The fields of a GitHub App webhook delivery this check reads. */
export interface Delivery {
  delivered_at: string;
  status_code: number;
  event: string;
  action: string | null;
  redelivery: boolean;
}

/** True if Throughline answered the delivery with a 2xx. A connection GitHub could not make is code 0. */
export function delivered(delivery: Pick<Delivery, "status_code">): boolean {
  return delivery.status_code >= 200 && delivery.status_code < 300;
}

/** Judges the response to an unsigned POST at the webhook URL. Throughline refuses a missing
 *  signature with 401 and a JSON `Bad signature`; Vercel protection refuses the request before the
 *  function runs, with an HTML 401 (or a redirect to sign-in).
 *
 *  Args:
 *    status: the response's status code.
 *    body: the response's body text.
 *  Returns: null if the request reached Throughline's handler, otherwise what went wrong. */
export function probeProblem(status: number, body: string): string | null {
  let error: unknown;
  try {
    error = JSON.parse(body).error;
  } catch {
    // Not JSON, so not Throughline's handler.
  }
  if (status === 401 && error === "Bad signature") return null;
  if (status === 401 || (status >= 300 && status < 400)) {
    return `Vercel protection refused it (${status}): the bypass in the webhook URL is missing, wrong or revoked`;
  }
  if (typeof error === "string") return `Throughline answered ${status}: ${error}`;
  return `unexpected ${status}; an unsigned request should get 401 Bad signature from Throughline`;
}

/** Signs the short-lived JWT that authenticates as the App itself, which the /app endpoints require. */
function appJwt(appId: string, privateKey: string): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: appId })}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url")}`;
}

/** GETs a GitHub REST path as the App and returns the parsed body; throws on anything but 200. */
async function github<T>(jwt: string, path: string): Promise<T> {
  const res = await fetch(`https://api.github.com/${path}`, {
    headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json" },
  });
  if (res.status !== 200) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Runs both checks, prints what each found, and sets exit code 1 if either failed. */
async function main(): Promise<void> {
  const appId = process.env.THROUGHLINE_APP_ID;
  const keyPath = process.env.THROUGHLINE_APP_PRIVATE_KEY_PATH;
  if (!appId || !keyPath) throw new Error("Set THROUGHLINE_APP_ID and THROUGHLINE_APP_PRIVATE_KEY_PATH");
  const jwt = appJwt(appId, readFileSync(keyPath, "utf8"));
  let failed = false;

  // The factory App signs the same way, so name the App before judging anything (note 25).
  const app = await github<{ slug: string; id: number }>(jwt, "app");
  console.log(`app      ${app.slug} (${app.id}); this should be Throughline's App`);

  // Newest first. GitHub keeps about three days of deliveries, so a quiet repository can have none.
  const deliveries = await github<Delivery[]>(jwt, "app/hook/deliveries?per_page=10");
  for (const d of deliveries) {
    const what = `${d.event}${d.action ? `.${d.action}` : ""}${d.redelivery ? " (redelivery)" : ""}`;
    console.log(`${d.delivered_at}  ${String(d.status_code).padEnd(3)}  ${what}`);
  }
  if (deliveries.length === 0) {
    console.log("ok       no deliveries in GitHub's recent history; the probe below still checks the link");
  } else if (delivered(deliveries[0])) {
    console.log(`ok       latest delivery got ${deliveries[0].status_code}`);
  } else {
    failed = true;
    console.log(`FAILED   latest delivery got ${deliveries[0].status_code}; see the App's Advanced tab for its response`);
  }

  // The URL GitHub actually uses, so the probe tests the bypass GitHub sends, not a local copy of it.
  const { url } = await github<{ url: string }>(jwt, "app/hook/config");
  const target = new URL(url);
  const bypass = target.searchParams.get("x-vercel-protection-bypass");
  // The bypass opens the whole private instance, and Actions logs in a public repository are public.
  if (bypass && process.env.GITHUB_ACTIONS === "true") console.log(`::add-mask::${bypass}`);
  const res = await fetch(target, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const problem = probeProblem(res.status, await res.text());
  const where = `${target.origin}${target.pathname}${bypass ? " with a bypass" : " with no bypass"}`;
  if (problem) {
    failed = true;
    console.log(`FAILED   unsigned POST to ${where}: ${problem}`);
  } else {
    console.log(`ok       unsigned POST to ${where} reached Throughline (401 Bad signature)`);
  }

  if (failed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
