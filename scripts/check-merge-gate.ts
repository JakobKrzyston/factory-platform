/** Proves the merge gate from the factory's side: acting as the factory GitHub App, opens a throwaway PR,
 *  tries to approve it and to merge it, expects both to be refused, then closes the PR and deletes its branch.
 *  Needs FACTORY_APP_ID and FACTORY_APP_PRIVATE_KEY_PATH in .env.local. Run: pnpm check-merge-gate [owner/repo] */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const repo = process.argv[2] ?? "JakobKrzyston/factory-platform";
const appId = process.env.FACTORY_APP_ID;
const keyPath = process.env.FACTORY_APP_PRIVATE_KEY_PATH;
if (!appId || !keyPath) throw new Error("Set FACTORY_APP_ID and FACTORY_APP_PRIVATE_KEY_PATH in .env.local");

/** Calls the GitHub REST API and returns the status and parsed body, without throwing on 4xx. */
async function api(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Signs the short-lived JWT that identifies the App itself, as GitHub's App auth requires. */
function appJwt(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(readFileSync(keyPath!, "utf8"), "base64url");
  return `${unsigned}.${signature}`;
}

/** Runs the check end to end; exits 1 if the App could approve or merge. */
async function main(): Promise<void> {
  const jwt = appJwt();
  const installation = await api(jwt, "GET", `repos/${repo}/installation`);
  if (installation.status !== 200) throw new Error(`App is not installed on ${repo}: ${installation.status}`);
  const { json: tokenBody } = await api(jwt, "POST", `app/installations/${installation.json.id}/access_tokens`);
  const token: string = tokenBody.token;

  const branch = `factory/merge-gate-check-${Date.now()}`;
  const mainRef = await api(token, "GET", `repos/${repo}/git/ref/heads/main`);
  await api(token, "POST", `repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: mainRef.json.object.sha });

  let failed = false;
  try {
    await api(token, "PUT", `repos/${repo}/contents/.merge-gate-check`, {
      message: "Merge gate check (TL-10); this PR is closed automatically",
      content: Buffer.from(`${new Date().toISOString()}\n`).toString("base64"),
      branch,
    });
    const pr = await api(token, "POST", `repos/${repo}/pulls`, {
      title: "Merge gate check (TL-10)",
      head: branch,
      base: "main",
      body: "Opened by `pnpm check-merge-gate` as the factory App. It tries to approve and merge this PR, expects both to be refused, then closes it.",
    });
    console.log(`opened   #${pr.json.number} as the factory App`);

    const approve = await api(token, "POST", `repos/${repo}/pulls/${pr.json.number}/reviews`, { event: "APPROVE" });
    const merge = await api(token, "PUT", `repos/${repo}/pulls/${pr.json.number}/merge`);
    for (const [what, r] of [["approve", approve], ["merge", merge]] as const) {
      const refused = r.status >= 400;
      failed ||= !refused;
      console.log(`${refused ? "refused" : "ALLOWED"}  ${what}: ${r.status} ${r.json?.message ?? ""}`.trimEnd());
    }
    await api(token, "PATCH", `repos/${repo}/pulls/${pr.json.number}`, { state: "closed" });
  } finally {
    await api(token, "DELETE", `repos/${repo}/git/refs/heads/${branch}`);
  }

  if (failed) {
    console.error("The factory App could approve or merge its own PR: the gate is open.");
    process.exit(1);
  }
  console.log("ok       the factory App can neither approve nor merge its own PR");
}

main();
