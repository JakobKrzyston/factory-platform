/** Tests the queue's label arithmetic, claim rule and run reports. Run: pnpm test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { END, type Factory, readFactories, type Trigger } from "../factory/factory";
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

// A factory of the test's own, so the queue's wording is tested apart from any factory in factories/ (TL-18).
const trigger = (name: string, label: string, agent: string, next: string, comment: string, question: string | null = null): Trigger => ({
  name,
  on: "label",
  label,
  agent,
  next,
  color: "0E8A16",
  description: `Starts ${agent}.`,
  comment,
  question,
});
const go = trigger("go", "factory:go", "plan", "factory:build", "**Plan**\n\n{output}\n\n_The plan agent. [Run log]({run_url})_\n");
const build = trigger(
  "build",
  "factory:build",
  "build",
  "factory:check",
  "The build agent opened {output}. [Run log]({run_url})\n",
  "If your answer changes the plan, add `factory:go` instead.\n",
);
const check = trigger("check", "factory:check", "check", END, "{output}\n");
const demo: Factory = { name: "demo", repositories: ["o/r"], foreman: "plan", agents: ["build", "check", "plan"], triggers: [build, check, go] };
const RUN = "https://github.com/o/r/actions/runs/1";

test("a success posts the trigger's comment, with the output and run filled in, and moves to its next label", () => {
  assert.deepEqual(report(demo, go, 0, "Small docs fix.\n", RUN), {
    to: "factory:build",
    comment: `**Plan**\n\nSmall docs fix.\n\n_The plan agent. [Run log](${RUN})_\n`,
  });
  assert.deepEqual(report(demo, build, 0, "https://github.com/o/r/pull/2\n", RUN), {
    to: "factory:check",
    comment: `The build agent opened https://github.com/o/r/pull/2. [Run log](${RUN})\n`,
  });
});

test("the last trigger's success hands the issue to a human", () => {
  assert.equal(report(demo, check, 0, "https://github.com/o/r/pull/2", RUN).to, END);
});

test("output that looks like a placeholder is posted as written", () => {
  assert.match(report(demo, check, 0, "see {run_url}", RUN).comment, /^see \{run_url\}\n/);
});

test("a question is quoted, says which label to add again, and adds the trigger's question.md if it has one", () => {
  const plan = report(demo, go, 3, "Which file?\n\nOr both?\n", RUN);
  assert.equal(plan.to, "factory:needs-human");
  assert.equal(
    plan.comment,
    `The factory's plan agent stopped to ask a question:\n\n> Which file?\n> \n> Or both?\n\nAnswer in a comment here, then add \`factory:go\` again. [Run log](${RUN})\n`,
  );
  const built = report(demo, build, 3, "Which file?\n", RUN).comment;
  assert.match(built, /add `factory:build` again/);
  assert.match(built, /\n\nIf your answer changes the plan, add `factory:go` instead\.\n$/);
});

test("an incomplete description lists what is missing and names the next trigger", () => {
  const { to, comment } = report(demo, build, 4, "https://github.com/o/r/pull/2\nno Risk section\nno Evidence\n", RUN);
  assert.equal(to, "factory:needs-human");
  assert.match(comment, /^The build agent opened https:\/\/github.com\/o\/r\/pull\/2, but its description is not ready for review:\n\n- no Risk section\n- no Evidence\n\n/);
  assert.match(comment, /add `factory:check` to start the check agent, or merge it\. Or close the pull request and add `factory:build` to run again\./);
});

test("any other exit is a failure that says which label retries it", () => {
  assert.deepEqual(report(demo, go, 1, "", RUN), {
    to: "factory:needs-human",
    comment: `The factory's plan agent failed (exit 1). See the [run log](${RUN}), then add \`factory:go\` to try this step again.\n`,
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
