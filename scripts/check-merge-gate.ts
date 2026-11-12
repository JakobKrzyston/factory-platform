/** Proves the merge gate from the factory's side: acting as the factory GitHub App, opens a throwaway PR,
 *  tries to approve it and to merge it, expects both to be refused, then closes the PR and deletes its branch.
 *  Needs FACTORY_APP_ID and FACTORY_APP_PRIVATE_KEY_PATH in .env.local. Run: pnpm check-merge-gate [owner/repo] */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const repo = process.argv[2] ?? "JakobKrzyston/factory-platform";
const appId = process.env.FACTORY_APP_ID;
const keyPath = process.env.FACTORY_APP_PRIVATE_KEY_PATH;
const MISSING_SETTINGS = "Set FACTORY_APP_ID and FACTORY_APP_PRIVATE_KEY_PATH in .env.local";
if (!appId || !keyPath) throw new Error(MISSING_SETTINGS);

/** Calls the GitHub REST API and returns the status and parsed body, without throwing on 4xx. */
async function api(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Walks `path` through nested objects in a parsed body; undefined if any step is missing. */
function field(json: unknown, ...path: string[]): unknown {
  let value = json;
  for (const key of path) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Reads a required string or number field, throwing a descriptive error rather than passing undefined on. */
function required(what: string, type: "string" | "number", json: unknown, ...path: string[]): string | number {
  const value = field(json, ...path);
  if (typeof value !== type) throw new Error(`Unexpected GitHub response: ${what} is missing or not a ${type}`);
  return value as string | number;
}

/** Signs the short-lived JWT that identifies the App itself, as GitHub's App auth requires. */
function appJwt(): string {
  if (!keyPath) throw new Error(MISSING_SETTINGS);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: appId })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(readFileSync(keyPath, "utf8"), "base64url");
  return `${unsigned}.${signature}`;
}

/** Runs the check end to end; exits 1 if the App could approve or merge. */
async function main(): Promise<void> {
  const jwt = appJwt();
  const installation = await api(jwt, "GET", `repos/${repo}/installation`);
  if (installation.status !== 200) throw new Error(`App is not installed on ${repo}: ${installation.status}`);
  const { json: tokenBody } = await api(jwt, "POST", `app/installations/${required("installation id", "number", installation.json, "id")}/access_tokens`);
  const token = required("installation token", "string", tokenBody, "token") as string;

  const branch = `factory/merge-gate-check-${Date.now()}`;
  const mainRef = await api(token, "GET", `repos/${repo}/git/ref/heads/main`);
  await api(token, "POST", `repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: required("main ref sha", "string", mainRef.json, "object", "sha") });

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
    const prNumber = required("pull request number", "number", pr.json, "number");
    console.log(`opened   #${prNumber} as the factory App`);

    const approve = await api(token, "POST", `repos/${repo}/pulls/${prNumber}/reviews`, { event: "APPROVE" });
    const merge = await api(token, "PUT", `repos/${repo}/pulls/${prNumber}/merge`);
    for (const [what, r] of [["approve", approve], ["merge", merge]] as const) {
      const message = field(r.json, "message");
      const refused = r.status >= 400;
      failed ||= !refused;
      console.log(`${refused ? "refused" : "ALLOWED"}  ${what}: ${r.status} ${message ?? ""}`.trimEnd());
    }
    await api(token, "PATCH", `repos/${repo}/pulls/${prNumber}`, { state: "closed" });
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
