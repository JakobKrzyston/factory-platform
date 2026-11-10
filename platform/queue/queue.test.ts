/** Tests the queue's label arithmetic and claim rule. Run: pnpm test */
import assert from "node:assert/strict";
import { test } from "node:test";

import { claimRefusal, labelChanges } from "./queue";

test("a transition swaps the old factory label for the new one and keeps other labels", () => {
  assert.deepEqual(labelChanges(["bug", "factory:ready"], "in-progress"), {
    add: ["factory:in-progress"],
    remove: ["factory:ready"],
  });
});

test("a transition clears every other factory label, so an issue is only ever in one state", () => {
  assert.deepEqual(labelChanges(["factory:ready", "factory:in-progress", "factory:needs-human"], "in-review"), {
    add: ["factory:in-review"],
    remove: ["factory:ready", "factory:in-progress", "factory:needs-human"],
  });
});

test("moving to the state an issue is already in changes nothing", () => {
  assert.deepEqual(labelChanges(["factory:done"], "done"), { add: [], remove: [] });
});

test("a run claims an open issue labelled factory:ready", () => {
  assert.equal(claimRefusal({ state: "open", labels: ["factory:ready"] }), null);
});

test("a run that was queued behind another finds the label gone and does not claim", () => {
  assert.match(claimRefusal({ state: "open", labels: ["factory:in-review"] }) ?? "", /not labelled factory:ready/);
});

test("a run for a closed issue does not claim it", () => {
  assert.match(claimRefusal({ state: "closed", labels: ["factory:ready"] }) ?? "", /closed/);
});

test("re-adding factory:ready after a crashed run left in-progress lets a new run claim it", () => {
  assert.equal(claimRefusal({ state: "open", labels: ["factory:in-progress", "factory:ready"] }), null);
});
