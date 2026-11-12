/** Tests the pull request description check (TL-8). Run: pnpm test */
import assert from "node:assert/strict";
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

const NO_DOOR = "The Risk section does not say one-way door or two-way door.";
const NO_RADIUS = "The Risk section does not state the blast radius.";
const NO_EVIDENCE = "The Evidence section is empty.";
const withRisk = (risk: string) => FILLED.replace(/Two-way door.*\n/, `${risk}\n`);
const withEvidence = (evidence: string) => FILLED.replace(/(## Evidence\n\n)[\s\S]*$/, `$1${evidence}\n`);

test("a filled-in template passes", () => {
  assert.deepEqual(descriptionProblems(FILLED), []);
});

test("the unfilled template fails on Risk and Evidence: its hints are comments, not answers", () => {
  assert.deepEqual(descriptionProblems(TEMPLATE), ["The Risk section is empty.", NO_EVIDENCE]);
});

test("a plain summary with no sections fails on both", () => {
  assert.deepEqual(descriptionProblems("Fixed the lint error; all checks pass."), [
    "There is no Risk section.",
    "There is no Evidence section.",
  ]);
});

test("a Risk section must name the door and the blast radius", () => {
  assert.deepEqual(descriptionProblems(withRisk("Low risk.")), [NO_DOOR, NO_RADIUS]);
  assert.deepEqual(descriptionProblems(withRisk("It only works one way. Blast radius: none.")), [NO_DOOR]);
});

test("the door and blast radius may be written with spaces, hyphens or dashes", () => {
  for (const risk of [
    "One way door. Blast radius: x.",
    "Two‑way door (non-breaking hyphen). Blast radius: x.",
    "A two–way door. Blast-radius: x.",
    "One-way doors, both. **Blast radius**: x.",
  ]) {
    assert.deepEqual(descriptionProblems(withRisk(risk)), [], risk);
  }
});

test("the Implements trailer, however it is written, does not fill the last section", () => {
  for (const trailer of ["Implements TL-8", "Implements TL-8.", "**Implements TL-8**", "Implements TL-8, TL-9", "_Implements TL-8 and TL-9_"]) {
    assert.deepEqual(descriptionProblems(withEvidence(trailer)), [NO_EVIDENCE], trailer);
  }
  assert.deepEqual(descriptionProblems(withEvidence("Implements TL-8 and adds a test that passes.")), []);
});

test("a line inside a code fence is never a heading", () => {
  const fenced = withRisk("Two-way door.\n\n```sh\n# to revert\ngit revert HEAD\n```\n\nBlast radius: the health check.");
  assert.deepEqual(descriptionProblems(fenced), []);
  const evidenceInFence = withEvidence("~~~\n## not a heading\n# nor this\n~~~");
  assert.deepEqual(descriptionProblems(evidenceInFence), []);
});

test("a repeated heading adds to its section rather than erasing it", () => {
  assert.deepEqual(descriptionProblems(withEvidence("Tests pass.\n\n## Evidence\n")), []);
});

test("a subheading stays inside its section; a top-level heading ends it", () => {
  assert.deepEqual(descriptionProblems(withEvidence("### Notes")), []);
  assert.deepEqual(descriptionProblems(withEvidence("# Appendix\n\nlong text")), [NO_EVIDENCE]);
});

test("headings match by prefix and case", () => {
  const renamed = FILLED.replace("## Risk", "## RISK and blast radius").replace("## Evidence", "## Evidence ##");
  assert.deepEqual(descriptionProblems(renamed), []);
});
