/** How long an issue spent in each factory state: turns its label events into stretches and writes them to the run
 *  log's `transitions` table (#86). Exports intervals, eventsCaughtUp, recordDwell and dwell, which
 *  `pnpm queue dwell` runs.
 *
 *  pnpm queue dwell <owner/repo> <issue>     one issue
 *  pnpm queue dwell <owner/repo> --all       every issue closed as completed with a factory:* label, for a backfill */
import { type RunLog, openRunLog } from "../runlog/runlog";
import { gh } from "./queue";

/** One of GitHub's issue events (`repos/<repo>/issues/<n>/events`), reduced to the fields read here. */
export type IssueEvent = { event: string; created_at: string; label?: { name: string } };

/** A stretch during which an issue carried one factory label. `left_at` and `seconds` are null while it still does. */
export type Stretch = { label: string; entered_at: string; left_at: string | null; seconds: number | null };

const isFactoryLabel = (e: IssueEvent): e is IssueEvent & { label: { name: string } } =>
  e.label?.name.startsWith("factory:") ?? false;

/** Finds every stretch during which an issue carried a `factory:*` label.
 *
 *  Args:
 *    events: the issue's events, oldest first, as GitHub returns them. Only `labeled` and `unlabeled` events of
 *      `factory:*` labels are read.
 *    closedAt: when the issue closed, or null if it is open.
 *  Returns: the stretches, ordered by when they began. A stretch ends at the event that removed its label. On a
 *  closed issue, no stretch ends after the close: a label still on at the close, or removed after it, as the
 *  `done` job removes `factory:in-review`, ends at the close, and one added after the close, as `factory:done`
 *  is, ends where it began. On an open issue a label still on has not ended. */
export function intervals(events: IssueEvent[], closedAt: string | null): Stretch[] {
  const carried = new Map<string, string>();
  const stretches: Stretch[] = [];
  const end = (label: string, entered_at: string, removed: string | null) => {
    if (closedAt === null && removed === null) {
      stretches.push({ label, entered_at, left_at: null, seconds: null });
      return;
    }
    const closed = closedAt === null ? Number.POSITIVE_INFINITY : Date.parse(closedAt);
    const left = Math.max(Date.parse(entered_at), Math.min(removed === null ? closed : Date.parse(removed), closed));
    stretches.push({ label, entered_at, left_at: new Date(left).toISOString(), seconds: Math.round((left - Date.parse(entered_at)) / 1000) });
  };

  for (const e of events.filter(isFactoryLabel)) {
    const at = new Date(e.created_at).toISOString();
    const entered = carried.get(e.label.name);
    if (e.event === "labeled" && entered === undefined) carried.set(e.label.name, at);
    if (e.event === "unlabeled" && entered !== undefined) {
      end(e.label.name, entered, at);
      carried.delete(e.label.name);
    }
  }
  for (const [label, entered] of carried) end(label, entered, null);
  return stretches.sort((a, b) => a.entered_at.localeCompare(b.entered_at));
}

/** Checks that an issue's events have caught up with its labels. GitHub's events API is eventually consistent, so
 *  right after the `done` job moves an issue, the move can be missing from it.
 *  Args: events: the issue's events, oldest first; labels: the names of the labels the issue carries now.
 *  Returns: true when the events leave the issue with exactly its current factory labels. */
export function eventsCaughtUp(events: IssueEvent[], labels: string[]): boolean {
  const carried = new Set<string>();
  for (const e of events.filter(isFactoryLabel)) {
    if (e.event === "labeled") carried.add(e.label.name);
    if (e.event === "unlabeled") carried.delete(e.label.name);
  }
  const current = labels.filter((name) => name.startsWith("factory:"));
  return current.length === carried.size && current.every((name) => carried.has(name));
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

type Issue = {
  number: number;
  closed_at: string | null;
  state_reason: string | null;
  labels: { name: string }[];
  pull_request?: unknown;
};

const ATTEMPTS = 6;
const RETRY_MS = 5000;

/** Reads an issue's events, rereading for up to half a minute until they have caught up with its labels.
 *  Raises: if they never do, so the workflow step fails and can be rerun rather than writing a wrong row. */
async function caughtUpEvents(repo: string, issue: Issue): Promise<IssueEvent[]> {
  const labels = issue.labels.map((l) => l.name);
  for (let attempt = 1; ; attempt++) {
    const events: IssueEvent[] = all(`repos/${repo}/issues/${issue.number}/events?per_page=100`);
    if (eventsCaughtUp(events, labels)) return events;
    if (attempt === ATTEMPTS) throw new Error(`#${issue.number}: its events never caught up with its labels ${labels.join(", ")}`);
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
}

/** Records the stretches of one issue in the run log, or with `--all` of every issue closed as completed with a
 *  `factory:*` label: the issues the workflow's `done` job records. Needs `gh` signed in.
 *  Args: repo: `owner/name`; target: an issue number or `--all`. */
export async function dwell(repo: string, target: string): Promise<void> {
  const issues: Issue[] =
    target === "--all"
      ? all<Issue>(`repos/${repo}/issues?state=closed&per_page=100`).filter(
          (i) => !i.pull_request && i.state_reason === "completed" && i.labels.some((l) => l.name.startsWith("factory:")),
        )
      : [JSON.parse(gh(["api", `repos/${repo}/issues/${target}`]))];
  const db = await openRunLog();
  try {
    for (const issue of issues) {
      const stretches = intervals(await caughtUpEvents(repo, issue), issue.closed_at);
      await recordDwell(db, repo, issue.number, stretches);
      console.log(`#${issue.number}: ${stretches.length} stretches`);
    }
  } finally {
    await db.close();
  }
}
