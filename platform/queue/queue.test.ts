/** Tests the queue's label arithmetic, claim rule and run reports. Run: pnpm test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { readFactories } from "../factory/factory";
import { claimRefusal, labelChanges, mergedFactoryPr, moveRefusal, report } from "./queue";

test("a transition swaps the old factory label for the new one and keeps other labels", () => {
  assert.deepEqual(labelChanges(["bug", "factory:ready"], "factory:in-progress"), {
    add: ["factory:in-progress"],
    remove: ["factory:ready"],
  });
});

test("a transition clears every other factory label, so an issue is only ever in one state", () => {
  assert.deepEqual(labelChanges(["factory:ready", "factory:in-progress", "factory:needs-human"], "factory:in-review"), {
    add: ["factory:in-review"],
    remove: ["factory:ready", "factory:in-progress", "factory:needs-human"],
  });
});

test("moving to the state an issue is already in changes nothing", () => {
  assert.deepEqual(labelChanges(["factory:done"], "factory:done"), { add: [], remove: [] });
});

test("a run claims an open issue labelled factory:ready", () => {
  assert.equal(claimRefusal({ state: "open", labels: ["factory:ready"] }, "factory:ready"), null);
});

test("a run that was queued behind another finds the label gone and does not claim", () => {
  assert.match(claimRefusal({ state: "open", labels: ["factory:in-review"] }, "factory:ready") ?? "", /not labelled factory:ready/);
});

test("a run for a closed issue does not claim it", () => {
  assert.match(claimRefusal({ state: "closed", labels: ["factory:ready"] }, "factory:ready") ?? "", /closed/);
});

test("re-adding factory:ready after a crashed run left in-progress lets a new run claim it", () => {
  assert.equal(claimRefusal({ state: "open", labels: ["factory:in-progress", "factory:ready"] }, "factory:ready"), null);
});

test("each stage's run claims only its own label, so a run queued for an earlier stage does nothing", () => {
  assert.equal(claimRefusal({ state: "open", labels: ["factory:review"] }, "factory:review"), null);
  assert.match(claimRefusal({ state: "open", labels: ["factory:review"] }, "factory:spec") ?? "", /not labelled factory:spec/);
});

test("a run that ends after the issue closed does not move it, but merging still moves it to done", () => {
  assert.equal(moveRefusal({ state: "open" }, "factory:review"), null);
  assert.match(moveRefusal({ state: "closed" }, "factory:review") ?? "", /closed/);
  assert.match(moveRefusal({ state: "closed" }, "factory:needs-human") ?? "", /closed/);
  assert.equal(moveRefusal({ state: "closed" }, "factory:done"), null);
});

test("an issue is done only when the factory's own pull request for it merged", () => {
  const pr = (headRefName: string, isCrossRepository = false) => ({ url: `https://x/${headRefName}`, headRefName, isCrossRepository });
  assert.equal(mergedFactoryPr([pr("fix-typo"), pr("factory/issue-12-20261111T000000Z")], "1"), null);
  assert.equal(mergedFactoryPr([pr("factory/issue-1-20261111T000000Z", true)], "1"), null);
  assert.equal(mergedFactoryPr([pr("factory/issue-1-20261111T000000Z")], "1"), "https://x/factory/issue-1-20261111T000000Z");
});

const code = readFactories().find((factory) => factory.name === "code");
assert.ok(code, "factories/code/ is missing");
const trigger = (name: string) => {
  const found = code.triggers.find((t) => t.name === name);
  assert.ok(found, `factories/code/triggers/${name}/ is missing`);
  return found;
};
const RUN = "https://github.com/o/r/actions/runs/1";

test("a successful triage posts its note under a heading and starts the spec agent", () => {
  assert.deepEqual(report(code, trigger("ready"), 0, "Small docs fix.\n", RUN), {
    to: "factory:spec",
    comment: `**Triage**\n\nSmall docs fix.\n\n_The factory's triage agent. [Run log](${RUN})_\n`,
  });
});

test("a successful implement links its PR and starts the review agent", () => {
  assert.deepEqual(report(code, trigger("implement"), 0, "https://github.com/o/r/pull/2\n", RUN), {
    to: "factory:review",
    comment: `The implement agent opened https://github.com/o/r/pull/2. [Run log](${RUN})\n`,
  });
});

test("a successful review hands the issue to a human", () => {
  assert.equal(report(code, trigger("review"), 0, "https://github.com/o/r/pull/2", RUN).to, "factory:in-review");
});

test("output that looks like a placeholder is posted as written", () => {
  assert.match(report(code, trigger("spec"), 0, "see {run_url}", RUN).comment, /^see \{run_url\}\n/);
});

test("a question is quoted, says which label to add again, and only implement's says when to re-spec", () => {
  const triage = report(code, trigger("ready"), 3, "Which file?\n\nOr both?\n", RUN);
  assert.equal(triage.to, "factory:needs-human");
  assert.equal(
    triage.comment,
    `The factory's triage agent stopped to ask a question:\n\n> Which file?\n> \n> Or both?\n\nAnswer in a comment here, then add \`factory:ready\` again. [Run log](${RUN})\n`,
  );
  const implement = report(code, trigger("implement"), 3, "Which file?\n", RUN).comment;
  assert.match(implement, /add `factory:implement` again/);
  assert.match(implement, /\n\nIf your answer changes the spec, add `factory:spec` instead/);
});

test("an incomplete description lists what is missing and names the next trigger", () => {
  const { to, comment } = report(code, trigger("implement"), 4, "https://github.com/o/r/pull/2\nno Risk section\nno Evidence\n", RUN);
  assert.equal(to, "factory:needs-human");
  assert.match(comment, /^The implement agent opened https:\/\/github.com\/o\/r\/pull\/2, but its description is not ready for review:\n\n- no Risk section\n- no Evidence\n\n/);
  assert.match(comment, /add `factory:review` to start the review agent, or merge it\. Or close the pull request and add `factory:implement` to run again\./);
});

test("any other exit is a failure that says which label retries it", () => {
  assert.deepEqual(report(code, trigger("spec"), 1, "", RUN), {
    to: "factory:needs-human",
    comment: `The factory's spec agent failed (exit 1). See the [run log](${RUN}), then add \`factory:spec\` to try this step again.\n`,
  });
});

test("factory.yml names no trigger's label outside its comments: which labels start agents is the factories'", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/factory.yml", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  for (const factory of readFactories()) {
    for (const { label } of factory.triggers) assert.ok(!workflow.includes(label), `factory.yml names ${label}`);
  }
});
