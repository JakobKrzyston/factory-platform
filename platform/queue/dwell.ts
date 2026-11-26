/** How long an issue spent in each factory state: turns its label events into stretches and writes them to the run
 *  log's `transitions` table (#86). Exports intervals, recordDwell and dwell, which `pnpm queue dwell` runs.
 *
 *  pnpm queue dwell <owner/repo> <issue>     one issue
 *  pnpm queue dwell <owner/repo> --all       every closed issue labelled factory:done, for a backfill */
import { type RunLog, openRunLog } from "../runlog/runlog";
import { gh } from "./queue";

/** One of GitHub's issue events (`repos/<repo>/issues/<n>/events`), reduced to the fields read here. */
export type IssueEvent = { event: string; created_at: string; label?: { name: string } };

/** A stretch during which an issue carried one factory label. `left_at` and `seconds` are null while it still does. */
export type Stretch = { label: string; entered_at: string; left_at: string | null; seconds: number | null };

/** Finds every stretch during which an issue carried a `factory:*` label.
 *
 *  Args:
 *    events: the issue's events, oldest first, as GitHub returns them. Only `labeled` and `unlabeled` events of
 *      `factory:*` labels are read.
 *    closedAt: when the issue closed, or null if it is open.
 *  Returns: the stretches, ordered by when they began. A stretch ends at the event that removed its label. On a
 *  closed issue, a label never removed ends at the close, or where it began if it was added after the close, as
 *  the `done` job adds `factory:done`. On an open issue it has not ended. */
export function intervals(events: IssueEvent[], closedAt: string | null): Stretch[] {
  const carried = new Map<string, string>();
  const stretches: Stretch[] = [];
  const end = (label: string, entered_at: string, left_at: string) =>
    stretches.push({ label, entered_at, left_at, seconds: Math.round((Date.parse(left_at) - Date.parse(entered_at)) / 1000) });

  for (const { event, created_at, label } of events) {
    if (!label?.name.startsWith("factory:")) continue;
    const at = new Date(created_at).toISOString();
    const entered = carried.get(label.name);
    if (event === "labeled" && entered === undefined) carried.set(label.name, at);
    if (event === "unlabeled" && entered !== undefined) {
      end(label.name, entered, at);
      carried.delete(label.name);
    }
  }
  for (const [label, entered] of carried) {
    if (closedAt === null) stretches.push({ label, entered_at: entered, left_at: null, seconds: null });
    else end(label, entered, new Date(Math.max(Date.parse(closedAt), Date.parse(entered))).toISOString());
  }
  return stretches.sort((a, b) => a.entered_at.localeCompare(b.entered_at));
}

/** Writes an issue's stretches to `transitions`, replacing the end of any already there, so recording an issue
 *  again writes the same rows.
 *  Args: db: the run log; repo: `owner/name`; issue: the issue number; stretches: from intervals. */
export async function recordDwell(db: RunLog, repo: string, issue: number, stretches: Stretch[]): Promise<void> {
  for (const s of stretches) {
    await db.query(
      `INSERT INTO transitions (repo, issue, label, entered_at, left_at, seconds) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (repo, issue, label, entered_at) DO UPDATE SET left_at = excluded.left_at, seconds = excluded.seconds`,
      [repo, issue, s.label, s.entered_at, s.left_at, s.seconds],
    );
  }
}

/** Reads every page of a GitHub list endpoint. */
function all<T>(path: string): T[] {
  return JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();
}

/** Records the stretches of one issue, or with `--all` of every closed issue labelled `factory:done`, in the run
 *  log. Needs `gh` signed in.
 *  Args: repo: `owner/name`; target: an issue number or `--all`. */
export async function dwell(repo: string, target: string): Promise<void> {
  const issues: { number: number; closed_at: string | null }[] =
    target === "--all"
      ? all(`repos/${repo}/issues?state=closed&labels=factory:done&per_page=100`)
      : [JSON.parse(gh(["api", `repos/${repo}/issues/${target}`]))];
  const db = await openRunLog();
  try {
    for (const { number, closed_at } of issues) {
      const stretches = intervals(all(`repos/${repo}/issues/${number}/events?per_page=100`), closed_at);
      await recordDwell(db, repo, number, stretches);
      console.log(`#${number}: ${stretches.length} stretches`);
    }
  } finally {
    await db.close();
  }
}
