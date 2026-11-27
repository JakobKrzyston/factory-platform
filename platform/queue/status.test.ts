/** Tests the queue digest on fixtures: no network. Run: pnpm test */
import assert from "node:assert/strict";
import { test } from "node:test";

import { END } from "../factory/factory";
import { report } from "./queue";
import { render, status, type StatusIssue } from "./status";

const now = new Date("2026-01-10T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
function issue(number: number, label: string, minutes: number, extra: Partial<StatusIssue> = {}): StatusIssue {
  return { number, title: `Title ${number}`, url: `https://github.com/o/r/issues/${number}`, label, labelledAt: ago(minutes), lastAppComment: null, pr: null, ...extra };
}

test("each section is populated and sorted oldest first", () => {
  const result = status(
    [
      issue(1, "factory:needs-human", 60, { lastAppComment: "Which one?" }),
      issue(2, "factory:needs-human", 3 * 1440),
      issue(3, END, 120, { pr: "https://github.com/o/r/pull/9" }),
      issue(4, "factory:in-progress", 200),
      issue(5, "factory:ready", 500),
    ],
    now,
  );
  assert.deepEqual(result.needsYou.map((i) => i.number), [2, 1]);
  assert.deepEqual(result.waitingForMerge.map((i) => i.number), [3]);
  assert.deepEqual(result.stuck.map((i) => i.number), [4]);
  const text = render(result, false, now);
  assert.match(text, /Needs you\n {2}#2 Title 2: for 3d\n {2}#1 Title 1: for 1h; Which one\?/);
  assert.match(text, /Waiting for merge\n.*https:\/\/github.com\/o\/r\/pull\/9.*for 2h/);
  assert.match(text, /Stuck\n.*in progress for 3h/);
});

test("all sections empty", () => {
  assert.equal(render(status([], now), false, now), "Nothing is waiting on you.");
  assert.equal(render(status([], now), true, now), "Nothing is waiting on you.");
});

test("in-progress is stuck only after more than 60 minutes", () => {
  const stuck = (m: number) => status([issue(1, "factory:in-progress", m)], now).stuck.length;
  assert.equal(stuck(59), 0);
  assert.equal(stuck(60), 0);
  assert.equal(stuck(61), 1);
});

test("a needs-human issue with no App comment renders", () => {
  const text = render(status([issue(1, "factory:needs-human", 5)], now), false, now);
  assert.equal(text, "Needs you\n  #1 Title 1: for 5m");
});

test("the first non-empty line of the comment is used", () => {
  const text = render(status([issue(1, "factory:needs-human", 5, { lastAppComment: "\n\n  Real question\nmore" })], now), false, now);
  assert.match(text, /Real question/);
  assert.doesNotMatch(text, /more/);
});

test("an in-review issue with no open pull request says so", () => {
  assert.match(render(status([issue(1, END, 5)], now), false, now), /no open pull request/);
});

test("markdown has a heading per non-empty section and a link per issue", () => {
  const text = render(
    status([issue(1, "factory:needs-human", 5, { lastAppComment: "Q" }), issue(2, END, 5, { pr: "https://github.com/o/r/pull/9" }), issue(3, END, 6)], now),
    true,
    now,
  );
  assert.match(text, /^## Needs you\n\n- \[#1 Title 1\]\(https:\/\/github.com\/o\/r\/issues\/1\): for 5m; Q/);
  assert.match(text, /## Waiting for merge/);
  assert.match(text, /\[pull request\]\(https:\/\/github.com\/o\/r\/pull\/9\)/);
  assert.match(text, /no open pull request/);
  assert.doesNotMatch(text, /## Stuck/);
});

test("a question comment from report() shows the question, not its opening sentence", () => {
  const trigger = { agent: "implement", label: "factory:implement" } as Parameters<typeof report>[1];
  const { comment } = report({} as Parameters<typeof report>[0], trigger, 3, "Should X use Y?\nmore\n", "https://run");
  const text = render(status([issue(1, "factory:needs-human", 5, { lastAppComment: comment })], now), false, now);
  assert.equal(text, "Needs you\n  #1 Title 1: for 5m; Should X use Y?");
});

test("markdown escapes brackets in a title", () => {
  const text = render(status([issue(1, END, 5, { title: "Fix [queue] parsing" })], now), true, now);
  assert.match(text, /- \[#1 Fix \\\[queue\\\] parsing\]\(/);
});
