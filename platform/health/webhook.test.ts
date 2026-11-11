/** Tests the webhook health check's verdicts on deliveries and on the probe's response. Run: pnpm test */
import assert from "node:assert/strict";
import { test } from "node:test";

import { delivered, probeProblem } from "./webhook";

test("a 2xx delivery counts as delivered", () => {
  assert.equal(delivered({ status_code: 200 }), true);
  assert.equal(delivered({ status_code: 202 }), true);
});

test("a refused, failed or unreachable delivery does not", () => {
  assert.equal(delivered({ status_code: 401 }), false);
  assert.equal(delivered({ status_code: 500 }), false);
  assert.equal(delivered({ status_code: 0 }), false);
});

test("Throughline refusing the missing signature means the probe got through", () => {
  assert.equal(probeProblem(401, '{"error":"Bad signature"}'), null);
});

test("Vercel's own 401 page means the bypass did not work", () => {
  assert.match(probeProblem(401, "<!doctype html><title>Authentication Required</title>") ?? "", /Vercel protection/);
});

test("a redirect to Vercel sign-in means the bypass did not work", () => {
  assert.match(probeProblem(302, "") ?? "", /Vercel protection/);
});

test("Throughline without its webhook secret is reported in its own words", () => {
  assert.equal(
    probeProblem(503, '{"error":"GITHUB_WEBHOOK_SECRET is not set"}'),
    "Throughline answered 503: GITHUB_WEBHOOK_SECRET is not set",
  );
});

test("an unsigned request that Throughline accepts is a failure", () => {
  assert.match(probeProblem(200, '{"status":"ignored"}') ?? "", /unexpected 200/);
});
