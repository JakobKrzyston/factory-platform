/** Tests the queue's label arithmetic and claim rule. Run: pnpm test */
import assert from "node:assert/strict";
import { test } from "node:test";

import { claimRefusal, labelChanges, STAGES } from "./queue";

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
  assert.equal(claimRefusal({ state: "open", labels: ["factory:ready"] }, "ready"), null);
});

test("a run that was queued behind another finds the label gone and does not claim", () => {
  assert.match(claimRefusal({ state: "open", labels: ["factory:in-review"] }, "ready") ?? "", /not labelled factory:ready/);
});

test("a run for a closed issue does not claim it", () => {
  assert.match(claimRefusal({ state: "closed", labels: ["factory:ready"] }, "ready") ?? "", /closed/);
});

test("re-adding factory:ready after a crashed run left in-progress lets a new run claim it", () => {
  assert.equal(claimRefusal({ state: "open", labels: ["factory:in-progress", "factory:ready"] }, "ready"), null);
});

test("each stage's run claims only its own label, so a run queued for an earlier stage does nothing", () => {
  assert.equal(claimRefusal({ state: "open", labels: ["factory:review"] }, "review"), null);
  assert.match(claimRefusal({ state: "open", labels: ["factory:review"] }, "spec") ?? "", /not labelled factory:spec/);
});

test("the chain runs triage, spec, implement, review and ends with a human", () => {
  const roles: string[] = [];
  let state: string = "ready";
  while (state in STAGES) {
    const stage = STAGES[state as keyof typeof STAGES];
    roles.push(stage.role);
    state = stage.next;
  }
  assert.deepEqual(roles, ["triage", "spec", "implement", "review"]);
  assert.equal(state, "in-review");
});
