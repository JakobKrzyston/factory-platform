/** Tests the dashboard's reading, weekly metrics and page against throwaway SQLite files. Run: pnpm test */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { type RunLog, openRunLog } from "../runlog/runlog";
import { readRuns, renderDashboard, weekOf, weeklyMetrics } from "./dashboard";

type Row = {
  id: string;
  role?: string;
  pr?: number | null;
  status?: string;
  benchmark?: boolean;
  started_at: string;
  wall_seconds?: number | null;
  cost_usd?: number | null;
  checks_passed?: boolean | null;
  review_findings?: number | null;
  rework?: boolean | null;
};

async function logWith(rows: Row[]): Promise<RunLog> {
  const db = await openRunLog("", join(mkdtempSync(join(tmpdir(), "dashboard-")), "runlog.db"));
  for (const r of rows) {
    const status = r.status ?? "done";
    await db.query(
      `INSERT INTO runs (id, factory, role, factory_sha, model, repo, issue, pr, benchmark, status, started_at, ended_at,
         wall_seconds, cost_usd, checks_passed, review_findings, rework)
       VALUES (?, 'code', ?, 'sha', 'claude-sonnet-5-5', 'o/r', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        r.id,
        r.role ?? "implementer",
        r.pr ?? null,
        r.benchmark ?? false,
        status,
        r.started_at,
        status === "running" ? null : r.started_at,
        r.wall_seconds ?? null,
        r.cost_usd ?? null,
        r.checks_passed ?? null,
        r.review_findings ?? null,
        r.rework ?? null,
      ],
    );
  }
  return db;
}

test("weekOf is the UTC Monday, so Sunday night belongs to the week before", () => {
  assert.equal(weekOf(new Date("2026-11-09T00:00:00Z")), "2026-11-09"); // Monday
  assert.equal(weekOf(new Date("2026-11-15T23:59:59Z")), "2026-11-09"); // Sunday
  assert.equal(weekOf(new Date("2026-11-16T00:00:00Z")), "2026-11-16");
  assert.equal(weekOf(new Date("2027-01-01T12:00:00Z")), "2026-12-28"); // across a year end
});

test("readRuns skips running and benchmark rows and converts SQLite's 1/0 to booleans", async () => {
  const db = await logWith([
    { id: "a", started_at: "2026-11-10T10:00:00.000Z", pr: 5, cost_usd: 1.5, checks_passed: true, rework: false },
    { id: "b", started_at: "2026-11-10T11:00:00.000Z", status: "running" },
    { id: "c", started_at: "2026-11-10T12:00:00.000Z", benchmark: true },
  ]);
  const runs = await readRuns(db);
  await db.close();
  assert.deepEqual(runs, [
    {
      factory: "code",
      role: "implementer",
      repo: "o/r",
      pr: 5,
      started_at: new Date("2026-11-10T10:00:00.000Z"),
      wall_seconds: null,
      cost_usd: 1.5,
      checks_passed: true,
      review_findings: null,
      rework: false,
    },
  ]);
});

test("weekly metrics: cost per PR, median time per role, gate pass rates and rework per PR", async () => {
  const db = await logWith([
    // Week of Nov 9: PR 1 took two implementer runs and was reworked; PR 2 merged as handed off; one run failed
    // with no PR, and its cost still counts against the PRs that shipped.
    { id: "1", started_at: "2026-11-09T09:00:00Z", pr: 1, cost_usd: 2, wall_seconds: 600, checks_passed: false, rework: true },
    { id: "2", started_at: "2026-11-09T10:00:00Z", pr: 1, cost_usd: 1, wall_seconds: 300, checks_passed: true, rework: true },
    { id: "3", started_at: "2026-11-10T09:00:00Z", pr: 2, cost_usd: 1, wall_seconds: 900, checks_passed: true, rework: false },
    { id: "4", started_at: "2026-11-11T09:00:00Z", status: "failed", cost_usd: 2, wall_seconds: 120 },
    { id: "5", role: "reviewer", started_at: "2026-11-11T10:00:00Z", pr: 2, cost_usd: 0.5, wall_seconds: 60, review_findings: 0 },
    { id: "6", role: "reviewer", started_at: "2026-11-12T10:00:00Z", pr: 1, cost_usd: 0.5, wall_seconds: 180, review_findings: 3 },
    // Nothing in the week of Nov 16. Week of Nov 23: one run whose cost is unknown.
    { id: "7", started_at: "2026-11-23T09:00:00Z", pr: 3, wall_seconds: 60, checks_passed: true },
  ]);
  const dashboard = weeklyMetrics(await readRuns(db));
  await db.close();

  assert.deepEqual(dashboard.weeks, ["2026-11-09", "2026-11-16", "2026-11-23"]);
  assert.deepEqual(dashboard.roles, ["implementer", "reviewer"]);
  const [first, empty, third] = dashboard.factories.get("code") ?? [];
  assert.deepEqual(first, {
    week: "2026-11-09",
    runs: 6,
    costPerPr: 3.5, // $7 over 2 PRs
    medianMinutesByRole: { implementer: 7.5, reviewer: 2 }, // medians of 120, 300, 600, 900 s and of 60, 180 s
    checksPassRate: 2 / 3,
    reviewPassRate: 0.5,
    reworkRate: 0.5, // PR 1 of PRs 1 and 2, though PR 1 has two runs
  });
  assert.deepEqual(empty, {
    week: "2026-11-16",
    runs: 0,
    costPerPr: null,
    medianMinutesByRole: {},
    checksPassRate: null,
    reviewPassRate: null,
    reworkRate: null,
  });
  assert.equal(third.costPerPr, null);
  assert.equal(third.reworkRate, null);
});

test("the page has a section per factory, keeps each role's colour, and escapes names", () => {
  const runs = [
    { role: "implementer", factory: "code" },
    { role: "reviewer", factory: "code" },
    { role: "reviewer", factory: "<docs>" },
  ].map((r, i) => ({
    ...r,
    repo: "o/r",
    pr: i,
    started_at: new Date("2026-11-10T00:00:00Z"),
    wall_seconds: 60,
    cost_usd: 1,
    checks_passed: true,
    review_findings: null,
    rework: null,
  }));
  const html = renderDashboard(weeklyMetrics(runs), new Date("2026-11-11T12:00:00Z"));
  assert.match(html, /<h2>code factory<\/h2>/);
  assert.match(html, /<h2>&lt;docs&gt; factory<\/h2>/);
  assert.doesNotMatch(html, /<docs>/);
  // reviewer is the second role everywhere, including in a factory with no implementer.
  const reviewerDots = html.match(/reviewer, week of Nov 9: 1\.0 min<\/title><circle class="hit" [^>]+><circle class="dot" [^>]+var\(--s2\)/g);
  assert.equal(reviewerDots?.length, 2);
  assert.match(html, /Generated 2026-11-11 12:00 UTC/);
});

test("an empty run log renders a page that says so", () => {
  assert.match(renderDashboard(weeklyMetrics([]), new Date()), /No finished runs in the run log yet/);
});
