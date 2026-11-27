/** Tests turning an issue's label events into stretches, and writing them to a throwaway SQLite run log. Run: pnpm test */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openRunLog } from "../runlog/runlog";
import { type IssueEvent, eventsCaughtUp, intervals, recordDwell } from "./dwell";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 10, 9, minute)).toISOString();
const labeled = (name: string, minute: number): IssueEvent => ({ event: "labeled", created_at: at(minute), label: { name } });
const unlabeled = (name: string, minute: number): IssueEvent => ({ event: "unlabeled", created_at: at(minute), label: { name } });

// What the factory does to an issue that goes straight through: each move adds the next label, then removes the
// old one. The PR merges at minute 50, which closes the issue; the done job then moves it to done.
const CHAIN: IssueEvent[] = [
  labeled("factory:ready", 0),
  labeled("factory:in-progress", 1),
  unlabeled("factory:ready", 1),
  labeled("factory:spec", 3),
  unlabeled("factory:in-progress", 3),
  labeled("factory:in-progress", 4),
  unlabeled("factory:spec", 4),
  labeled("factory:in-review", 10),
  unlabeled("factory:in-progress", 10),
  { event: "closed", created_at: at(50) },
  labeled("factory:done", 51),
  unlabeled("factory:in-review", 51),
];

test("a straight chain is one stretch per label it carried, done included", () => {
  assert.deepEqual(intervals(CHAIN, at(50)), [
    { label: "factory:ready", entered_at: at(0), left_at: at(1), seconds: 60 },
    { label: "factory:in-progress", entered_at: at(1), left_at: at(3), seconds: 120 },
    { label: "factory:spec", entered_at: at(3), left_at: at(4), seconds: 60 },
    { label: "factory:in-progress", entered_at: at(4), left_at: at(10), seconds: 360 },
    // Removed by the done job a minute after the close, but the wait for a person ended at the close.
    { label: "factory:in-review", entered_at: at(10), left_at: at(50), seconds: 2400 },
    // Added after the close, so it ends where it began.
    { label: "factory:done", entered_at: at(51), left_at: at(51), seconds: 0 },
  ]);
});

test("each visit to needs-human is its own stretch", () => {
  const events = [
    labeled("factory:needs-human", 0),
    labeled("factory:ready", 20),
    unlabeled("factory:needs-human", 20),
    labeled("factory:needs-human", 30),
    unlabeled("factory:ready", 30),
    labeled("factory:ready", 45),
    unlabeled("factory:needs-human", 45),
  ];
  const needsHuman = intervals(events, null).filter((s) => s.label === "factory:needs-human");
  assert.deepEqual(needsHuman, [
    { label: "factory:needs-human", entered_at: at(0), left_at: at(20), seconds: 1200 },
    { label: "factory:needs-human", entered_at: at(30), left_at: at(45), seconds: 900 },
  ]);
});

test("a label still on the issue when it closed ends at the close", () => {
  // A person closed the issue while it waited for an answer.
  assert.deepEqual(intervals([labeled("factory:needs-human", 0)], at(30)), [
    { label: "factory:needs-human", entered_at: at(0), left_at: at(30), seconds: 1800 },
  ]);
});

test("a stretch on an issue that was closed and reopened ends at its own removal", () => {
  // closedAt is the latest close, so stretches from before an earlier reopen are not cut short.
  const events = [labeled("factory:needs-human", 0), unlabeled("factory:needs-human", 20), labeled("factory:ready", 20)];
  assert.deepEqual(intervals(events, at(40)), [
    { label: "factory:needs-human", entered_at: at(0), left_at: at(20), seconds: 1200 },
    { label: "factory:ready", entered_at: at(20), left_at: at(40), seconds: 1200 },
  ]);
});

test("a label on an open issue has not ended", () => {
  assert.deepEqual(intervals([labeled("factory:ready", 0), labeled("factory:in-progress", 1), unlabeled("factory:ready", 1)], null), [
    { label: "factory:ready", entered_at: at(0), left_at: at(1), seconds: 60 },
    { label: "factory:in-progress", entered_at: at(1), left_at: null, seconds: null },
  ]);
});

test("labels that are not factory states, and events that are not label changes, are ignored", () => {
  const events = [
    labeled("bug", 0),
    labeled("factory:ready", 1),
    { event: "assigned", created_at: at(2) },
    unlabeled("bug", 3),
    labeled("factory-ish", 4),
    unlabeled("factory:ready", 5),
  ];
  assert.deepEqual(intervals(events, null), [{ label: "factory:ready", entered_at: at(1), left_at: at(5), seconds: 240 }]);
});

test("recording an issue twice writes the same rows, and a stretch that has since ended is updated", async () => {
  const db = await openRunLog("", join(mkdtempSync(join(tmpdir(), "dwell-")), "runlog.db"));
  const rows = async () =>
    (await db.query("SELECT label, entered_at, left_at, seconds FROM transitions ORDER BY entered_at")).map((r) => ({ ...r }));

  await recordDwell(db, "o/r", 7, intervals(CHAIN.slice(0, 8), null));
  assert.deepEqual((await rows()).at(-1), { label: "factory:in-review", entered_at: at(10), left_at: null, seconds: null });

  await recordDwell(db, "o/r", 7, intervals(CHAIN, at(50)));
  const once = await rows();
  await recordDwell(db, "o/r", 7, intervals(CHAIN, at(50)));
  assert.deepEqual(await rows(), once);
  assert.equal(once.length, 6);
  assert.deepEqual(once.at(-2), { label: "factory:in-review", entered_at: at(10), left_at: at(50), seconds: 2400 });
  await db.close();
});

test("events have caught up only when they end with exactly the issue's factory labels", () => {
  const labels = ["bug", "factory:done"];
  assert.equal(eventsCaughtUp(CHAIN, labels), true);
  // The done job's move is not in the events yet: neither half of it, or only the removal.
  assert.equal(eventsCaughtUp(CHAIN.slice(0, -2), labels), false);
  assert.equal(eventsCaughtUp([...CHAIN.slice(0, -2), unlabeled("factory:in-review", 51)], labels), false);
  // The label was added but the removal of in-review is missing.
  assert.equal(eventsCaughtUp(CHAIN.slice(0, -1), labels), false);
});
