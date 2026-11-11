/** Tests the pull request description check (TL-8). Run: pnpm test */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { descriptionProblems } from "./pr-description";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const TEMPLATE = readFileSync(join(ROOT, ".github/pull_request_template.md"), "utf8");

const FILLED = `## What was built

A retry on the webhook check.

## How to try it

\`pnpm check-webhook\`

## Risk

Two-way door: a revert removes the retry. Blast radius: the health check only.

## Evidence

Added two tests in platform/health/webhook.test.ts; typecheck, lint and test pass.

Implements TL-25`;

test("a filled-in template passes", () => {
  assert.deepEqual(descriptionProblems(FILLED), []);
});

test("the unfilled template fails on Risk and Evidence: its hints are comments, not answers", () => {
  assert.deepEqual(descriptionProblems(TEMPLATE), ["The Risk section is empty.", "The Evidence section is empty."]);
});

test("the Implements trailer alone does not fill the last section", () => {
  const trailerOnly = FILLED.replace(/(## Evidence\n\n).*\n/, "$1");
  assert.deepEqual(descriptionProblems(trailerOnly), ["The Evidence section is empty."]);
});

test("a plain summary with no sections fails on both", () => {
  assert.deepEqual(descriptionProblems("Fixed the bug and ran the tests."), [
    "There is no Risk section.",
    "There is no Evidence section.",
  ]);
});

test("a Risk section must name the door and the blast radius", () => {
  const vague = FILLED.replace(/Two-way door.*\n/, "Low risk.\n");
  assert.deepEqual(descriptionProblems(vague), [
    "The Risk section does not say one-way or two-way door.",
    "The Risk section does not state the blast radius.",
  ]);
  assert.deepEqual(descriptionProblems(FILLED.replace("Two-way door", "One way door")), []);
});

test("a subheading stays inside its section; a top-level heading ends it", () => {
  const empty = FILLED.replace(/## Evidence\n\n.*\n/, "## Evidence\n\n### Notes\n");
  assert.deepEqual(descriptionProblems(empty), []);
  const topLevel = FILLED.replace(/## Evidence\n\n.*\n/, "## Evidence\n\n# Appendix\n\nlong text\n");
  assert.deepEqual(descriptionProblems(topLevel), ["The Evidence section is empty."]);
});

test("headings match by prefix and case", () => {
  const renamed = FILLED.replace("## Risk", "## RISK and blast radius").replace("## Evidence", "## Evidence ##");
  assert.deepEqual(descriptionProblems(renamed), []);
});

test("the CLI prints one problem per line and nothing for a passing body", () => {
  const run = (input: string) =>
    spawnSync(join(ROOT, "node_modules/.bin/tsx"), [join(ROOT, "platform/gates/pr-description.ts")], {
      input,
      encoding: "utf8",
    });
  const pass = run(FILLED);
  assert.equal(pass.status, 0);
  assert.equal(pass.stdout, "");
  const fail = run("no sections");
  assert.equal(fail.status, 0);
  assert.equal(fail.stdout, "There is no Risk section.\nThere is no Evidence section.\n");
});
