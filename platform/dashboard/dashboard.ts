/** Renders the cost and rework dashboard from the run log: cost per PR, time per stage, pass rate at each gate
 *  and rework rate, per factory and per week, and the benchmark's scores (TL-16), as one self-contained HTML page.
 *  Exports readRuns, readScores, weekOf, weeklyMetrics and renderDashboard. Postgres when DATABASE_URL is set, otherwise SQLite in .runlog/.
 *
 *  tsx platform/dashboard/dashboard.ts [out.html]        default .runlog/dashboard.html */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_SQLITE_PATH } from "../runlog/migrate";
import { type RunLog, openRunLog } from "../runlog/runlog";
import { formatScore } from "../scorers/scorers";

/** The columns of one ended, non-benchmark run that the dashboard reads. */
export type Run = {
  factory: string;
  role: string;
  repo: string;
  pr: number | null;
  started_at: Date;
  wall_seconds: number | null;
  cost_usd: number | null;
  checks_passed: boolean | null;
  review_findings: number | null;
  rework: boolean | null;
};

/** Reads every ended production run. Converts at the boundary: SQLite returns booleans as 1/0 and timestamps as
 *  text; Postgres returns true/false, Date objects and numerics as strings.
 *  Args: db: the run log.
 *  Returns: the runs, oldest first. */
export async function readRuns(db: RunLog): Promise<Run[]> {
  const rows = await db.query(
    `SELECT factory, role, repo, pr, started_at, wall_seconds, cost_usd, checks_passed, review_findings, rework
     FROM runs WHERE benchmark = ? AND status <> 'running' ORDER BY started_at`,
    [false],
  );
  const num = (v: unknown) => (v === null ? null : Number(v));
  const bool = (v: unknown) => (v === null ? null : Boolean(v));
  return rows.map((r) => ({
    factory: r.factory as string,
    // Rows from before TL-7 call the implement role `implementer`; one role keeps one line on the charts.
    role: r.role === "implementer" ? "implement" : (r.role as string),
    repo: r.repo as string,
    pr: num(r.pr),
    started_at: new Date(r.started_at as string | Date),
    wall_seconds: num(r.wall_seconds),
    cost_usd: num(r.cost_usd),
    checks_passed: bool(r.checks_passed),
    review_findings: num(r.review_findings),
    rework: bool(r.rework),
  }));
}

/** One score of one benchmark run (TL-16), with the columns of its run that place it. */
export type ScoreRow = {
  run_id: string;
  factory: string;
  factory_sha: string;
  issue: number;
  role: string;
  started_at: Date;
  scorer: string;
  score: number;
  reason: string;
};

/** Reads every score of a benchmark run.
 *  Args: db: the run log.
 *  Returns: the scores, oldest run first, each run's in scorer order. */
export async function readScores(db: RunLog): Promise<ScoreRow[]> {
  const rows = await db.query(
    `SELECT s.run_id, r.factory, r.factory_sha, r.issue, r.role, r.started_at, s.scorer, s.score, s.reason
     FROM scores s JOIN runs r ON r.id = s.run_id WHERE r.benchmark = ? ORDER BY r.started_at, s.run_id, s.scorer`,
    [true],
  );
  return rows.map((r) => ({
    run_id: r.run_id as string,
    factory: r.factory as string,
    factory_sha: r.factory_sha as string,
    issue: Number(r.issue),
    role: r.role as string,
    started_at: new Date(r.started_at as string | Date),
    scorer: r.scorer as string,
    score: Number(r.score),
    reason: r.reason as string,
  }));
}

/** The Monday, in UTC, of the week a moment falls in.
 *  Args: date: the moment.
 *  Returns: the Monday as YYYY-MM-DD. */
export function weekOf(date: Date): string {
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday))
    .toISOString()
    .slice(0, 10);
}

/** One factory's numbers for one week. Null means the week had nothing to measure. */
export type Week = {
  week: string;
  runs: number;
  prs: number;
  totalCost: number | null;
  costPerPr: number | null;
  medianMinutesByRole: Map<string, number>;
  checksPassRate: number | null;
  reviewPassRate: number | null;
  reworkRate: number | null;
};

/** The dashboard's data: a shared, gap-free week axis and each factory's numbers on it. */
export type Dashboard = { weeks: string[]; roles: string[]; factories: Map<string, Week[]> };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function rate(outcomes: (boolean | null)[]): number | null {
  const known = outcomes.filter((o) => o !== null);
  return known.length ? known.filter(Boolean).length / known.length : null;
}

function measureWeek(week: string, runs: Run[]): Week {
  const prKey = (r: Run) => `${r.repo}#${r.pr}`;
  const prs = new Set(runs.filter((r) => r.pr !== null).map(prKey));
  const costs = runs.flatMap((r) => (r.cost_usd === null ? [] : [r.cost_usd]));
  // rework is set on every run of a PR, so one value per PR.
  const reworkByPr = new Map(runs.filter((r) => r.pr !== null && r.rework !== null).map((r) => [prKey(r), r.rework]));

  const totalCost = costs.length ? costs.reduce((a, b) => a + b, 0) : null;

  const medianMinutesByRole = new Map<string, number>();
  for (const role of new Set(runs.map((r) => r.role))) {
    const walls = runs.flatMap((r) => (r.role === role && r.wall_seconds !== null ? [r.wall_seconds] : []));
    if (walls.length) medianMinutesByRole.set(role, median(walls) / 60);
  }

  return {
    week,
    runs: runs.length,
    prs: prs.size,
    totalCost,
    // A week that spent money but produced no PR has no cost per PR; its spend is still in totalCost.
    costPerPr: prs.size && totalCost !== null ? totalCost / prs.size : null,
    medianMinutesByRole,
    checksPassRate: rate(runs.map((r) => r.checks_passed)),
    // A run with review_findings is a review; it passes when it found nothing.
    reviewPassRate: rate(runs.map((r) => (r.review_findings === null ? null : r.review_findings === 0))),
    reworkRate: rate([...reworkByPr.values()]),
  };
}

/** Groups runs by factory and by the week they started, and measures each week.
 *  Cost per PR is the week's total cost, failed runs included, over the distinct PRs its runs produced or
 *  reviewed. Rework rate counts PRs, not runs.
 *  Args: runs: ended production runs.
 *  Returns: every week from the first run to the last, including empty ones, so the x axis is true time. */
export function weeklyMetrics(runs: Run[]): Dashboard {
  if (runs.length === 0) return { weeks: [], roles: [], factories: new Map() };
  const starts = runs.map((r) => r.started_at.getTime());
  const weeks: string[] = [];
  const last = weekOf(new Date(starts.reduce((a, b) => Math.max(a, b))));
  for (let d = new Date(weekOf(new Date(starts.reduce((a, b) => Math.min(a, b))))); ; d.setUTCDate(d.getUTCDate() + 7)) {
    weeks.push(weekOf(d));
    if (weeks.at(-1) === last) break;
  }

  const factories = new Map<string, Week[]>();
  for (const factory of [...new Set(runs.map((r) => r.factory))].sort()) {
    const own = runs.filter((r) => r.factory === factory);
    factories.set(
      factory,
      weeks.map((w) => measureWeek(w, own.filter((r) => weekOf(r.started_at) === w))),
    );
  }
  return { weeks, roles: [...new Set(runs.map((r) => r.role))].sort(), factories };
}

type Series = { name: string; slot: number; values: (number | null)[] };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[c]};`);
const dollars = (v: number) => `$${v.toFixed(2)}`;
const minutes = (v: number) => `${v.toFixed(1)} min`;
const percent = (v: number) => `${Math.round(v * 100)}%`;
const shortDate = (week: string) =>
  new Date(week).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * step).find((n) => n >= v) as number;
}

const W = 480;
const H = 200;
const PAD = { left: 52, right: 16, top: 12, bottom: 28 };

/** One line chart as inline SVG, with a legend when it has more than one series. Points carry native tooltips. */
function lineChart(title: string, weeks: string[], series: Series[], format: (v: number) => string, max?: number): string {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const top = max ?? niceMax(Math.max(0, ...all));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const tenth = (n: number) => Math.round(n * 10) / 10;
  const x = (i: number) => tenth(PAD.left + (weeks.length === 1 ? plotW / 2 : (i * plotW) / (weeks.length - 1)));
  const y = (v: number) => tenth(PAD.top + plotH - (v / top) * plotH);

  const grid = [0, top / 2, top]
    .map(
      (v) =>
        `<line class="gridline" x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}"/>` +
        `<text class="tick" x="${PAD.left - 6}" y="${y(v) + 4}" text-anchor="end">${format(v)}</text>`,
    )
    .join("");
  const every = Math.ceil(weeks.length / 6);
  const xLabels = weeks
    .map((w, i) => (i % every ? "" : `<text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${shortDate(w)}</text>`))
    .join("");

  const marks = series
    .map((s) => {
      // A null week breaks the line rather than joining across it.
      const path = s.values
        .map((v, i) => (v === null ? "" : `${i && s.values[i - 1] !== null ? "L" : "M"}${x(i)},${y(v)}`))
        .join("");
      const dots = s.values
        .map((v, i) =>
          v === null
            ? ""
            : `<g><title>${escapeHtml(s.name)}, week of ${shortDate(weeks[i])}: ${format(v)}</title>` +
              `<circle class="hit" cx="${x(i)}" cy="${y(v)}" r="10"/>` +
              `<circle class="dot" cx="${x(i)}" cy="${y(v)}" r="4" fill="var(--s${s.slot})"/></g>`,
        )
        .join("");
      return `<path class="line" d="${path}" stroke="var(--s${s.slot})"/>${dots}`;
    })
    .join("");

  const legend =
    series.length > 1
      ? `<ul class="legend">${series.map((s) => `<li><span class="swatch" style="background:var(--s${s.slot})"></span>${escapeHtml(s.name)}</li>`).join("")}</ul>`
      : "";
  const empty = all.length ? "" : `<p class="empty">No data yet</p>`;
  return `<figure><figcaption>${title}</figcaption>${legend}${empty}
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(title)} by week">${grid}${xLabels}${marks}</svg></figure>`;
}

function table(weeks: Week[], roles: string[]): string {
  const cell = (v: number | null | undefined, format: (v: number) => string) => `<td>${v == null ? "–" : format(v)}</td>`;
  const head = ["Week", "Runs", "PRs", "Total cost", "Cost per PR", ...roles.map((r) => `${escapeHtml(r)} median`), "Checks pass", "Review pass", "Rework"];
  const rows = weeks
    .filter((w) => w.runs > 0)
    .map(
      (w) =>
        `<tr><td>${w.week}</td><td>${w.runs}</td><td>${w.prs}</td>${cell(w.totalCost, dollars)}${cell(w.costPerPr, dollars)}` +
        roles.map((r) => cell(w.medianMinutesByRole.get(r), minutes)).join("") +
        `${cell(w.checksPassRate, percent)}${cell(w.reviewPassRate, percent)}${cell(w.reworkRate, percent)}</tr>`,
    )
    .join("");
  return `<details><summary>Table</summary><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></details>`;
}

/** The benchmark's scores: per factory, a table with one row per factory version benchmarked, newest first, and
 *  each scorer's mean over that version's runs; then every score with its reason. */
function scoresSection(scores: ScoreRow[]): string {
  if (scores.length === 0) return "";
  const groupBy = <T, K>(xs: T[], key: (x: T) => K) => {
    const groups = new Map<K, T[]>();
    for (const x of xs) groups.set(key(x), [...(groups.get(key(x)) ?? []), x]);
    return groups;
  };
  // A dirty checkout's sha is <commit>-dirty-<hash>; the short form keeps the marker.
  const version = (sha: string) => sha.slice(0, 7) + (sha.includes("-dirty-") ? "-dirty" : "");
  const factories = [...groupBy(scores, (s) => s.factory)].sort(([a], [b]) => a.localeCompare(b));
  const body = factories
    .map(([factory, own]) => {
      const scorers = [...new Set(own.map((s) => s.scorer))].sort();
      const versions = [...groupBy(own, (s) => s.factory_sha)].reverse();
      const summary = versions
        .map(([sha, rows]) => {
          const cells = scorers.map((scorer) => {
            const values = rows.filter((s) => s.scorer === scorer).map((s) => s.score);
            return `<td>${values.length ? `${formatScore(values.reduce((a, b) => a + b, 0) / values.length)} (${values.length})` : "–"}</td>`;
          });
          return `<tr><td><code>${escapeHtml(version(sha))}</code></td><td>${rows[0].started_at.toISOString().slice(0, 10)}</td><td>${new Set(rows.map((s) => s.run_id)).size}</td>${cells.join("")}</tr>`;
        })
        .join("");
      const details = versions
        .map(
          ([sha, rows]) =>
            `<details><summary>Every score of <code>${escapeHtml(version(sha))}</code></summary><table class="reasons"><thead><tr><th>Issue</th><th>Role</th><th>Scorer</th><th>Score</th><th>Reason</th></tr></thead><tbody>${rows
              .map(
                (s) =>
                  `<tr><td>#${s.issue}</td><td>${escapeHtml(s.role)}</td><td>${escapeHtml(s.scorer)}</td><td>${formatScore(s.score)}</td><td>${escapeHtml(s.reason)}</td></tr>`,
              )
              .join("")}</tbody></table></details>`,
        )
        .join("");
      const head = ["Version", "First run", "Runs", ...scorers.map((s) => `${escapeHtml(s)} mean (n)`)];
      return `<h3>${escapeHtml(factory)} factory</h3><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${summary}</tbody></table>${details}`;
    })
    .join("\n");
  return `<section><h2>Benchmark scores</h2>
<p class="sub">Replays of the benchmark (<code>pnpm bench</code>), graded by the files under each factory's <code>scorers/</code>. Each mean is over the runs that scorer graded.</p>
${body}</section>`;
}

/** Renders the dashboard as one HTML page with no external resources.
 *  Args: dashboard: from weeklyMetrics; generatedAt: when the run log was read; scores: from readScores, shown
 *  after the production charts.
 *  Returns: the page. */
export function renderDashboard(dashboard: Dashboard, generatedAt: Date, scores: ScoreRow[]): string {
  const { weeks, roles } = dashboard;
  // A role keeps its colour across every factory and chart.
  const slot = (role: string) => roles.indexOf(role) + 1;
  const sections = [...dashboard.factories]
    .map(([factory, data]) => {
      const pick = (f: (w: Week) => number | null) => data.map(f);
      const ownRoles = roles.filter((r) => data.some((w) => w.medianMinutesByRole.has(r)));
      return `<section><h2>${escapeHtml(factory)} factory</h2><div class="grid">
${lineChart("Cost per PR", weeks, [{ name: "Cost per PR", slot: 1, values: pick((w) => w.costPerPr) }], dollars)}
${lineChart(
  "Time per stage (median)",
  weeks,
  ownRoles.map((r) => ({ name: r, slot: slot(r), values: pick((w) => w.medianMinutesByRole.get(r) ?? null) })),
  minutes,
)}
${lineChart(
  "Pass rate at each gate",
  weeks,
  [
    { name: "Checks", slot: 1, values: pick((w) => w.checksPassRate) },
    { name: "Review", slot: 2, values: pick((w) => w.reviewPassRate) },
  ],
  percent,
  1,
)}
${lineChart("Rework rate (merged PRs a human changed)", weeks, [{ name: "Rework", slot: 1, values: pick((w) => w.reworkRate) }], percent, 1)}
</div>${table(data, ownRoles)}</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Factory Dashboard</title>
<style>
:root { color-scheme: light; --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --border: rgba(11,11,11,0.10);
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a; --s4: #eda100; --s5: #e87ba4; --s6: #008300; --s7: #6250d6; --s8: #e34948; }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --page: #0d0d0d; --surface: #1a1a19; --ink: #f0efec;
  --ink-2: #c3c2b7; --grid: #2c2c2a; --border: rgba(255,255,255,0.10);
  --s1: #3987e5; --s2: #d95926; --s3: #199e70; --s4: #c98500; --s5: #d55181; --s6: #008300; --s7: #9085e9; --s8: #e66767; } }
body { margin: 0; padding: 24px 16px; background: var(--page); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1040px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 32px 0 12px; }
.sub { color: var(--ink-2); margin: 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 16px; }
figure { margin: 0; padding: 12px 12px 4px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
figcaption { font-weight: 600; }
svg { display: block; width: 100%; height: auto; }
.gridline { stroke: var(--grid); stroke-width: 1; }
.tick { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.dot { stroke: var(--surface); stroke-width: 2; }
.hit { fill: transparent; }
.legend { display: flex; gap: 16px; list-style: none; margin: 4px 0 0; padding: 0; color: var(--ink-2); font-size: 12px; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
.empty { color: var(--muted); margin: 4px 0 0; font-size: 12px; }
details { margin-top: 12px; } summary { cursor: pointer; color: var(--ink-2); }
table { border-collapse: collapse; margin-top: 8px; font-variant-numeric: tabular-nums; display: block; overflow-x: auto; }
th, td { padding: 4px 12px 4px 0; text-align: right; border-bottom: 1px solid var(--grid); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
h3 { font-size: 15px; margin: 16px 0 4px; } code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.reasons th, .reasons td { text-align: left; } .reasons td:last-child { white-space: normal; min-width: 320px; }
</style></head>
<body><main>
<h1>Factory dashboard</h1>
<p class="sub">Production runs from the run log, by the week they started (UTC). Generated ${generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC.</p>
${sections || `<p class="empty">No finished production runs in the run log yet.</p>`}
${scoresSection(scores)}
</main></body></html>
`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? join(dirname(DEFAULT_SQLITE_PATH), "dashboard.html");
  if (!process.env.DATABASE_URL && !existsSync(DEFAULT_SQLITE_PATH)) {
    console.error(`no run log at ${DEFAULT_SQLITE_PATH}: run an issue first, or set DATABASE_URL`);
    process.exit(1);
  }
  const db = await openRunLog(process.env.DATABASE_URL, DEFAULT_SQLITE_PATH, true);
  try {
    const html = renderDashboard(weeklyMetrics(await readRuns(db)), new Date(), await readScores(db));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html);
    console.log(out);
  } finally {
    await db.close();
  }
}
