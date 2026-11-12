/** Tests that docs/PLAN.md is the current render of docs/roadmap.ts (rule R-4). Run: pnpm test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { renderPlan } from "../../scripts/render-plan";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("docs/PLAN.md matches what docs/roadmap.ts renders", () => {
  const committed = readFileSync(join(ROOT, "docs/PLAN.md"), "utf8");
  assert.strictEqual(committed, renderPlan(), "docs/PLAN.md is out of date with docs/roadmap.ts: run `pnpm plan`");
});
