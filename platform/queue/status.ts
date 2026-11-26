/** What is waiting on a person: open issues in `factory:needs-human`, open issues in `factory:in-review`, and
 *  runs that died and left `factory:in-progress`. Read-only: it writes nothing to GitHub or the run log.
 *
 *  pnpm queue status <owner/repo> [--markdown]
 *
 *  `status` and `render` are pure; only `gather` calls `gh`, and only with GET requests. */
import { END } from "../factory/factory";
import { gh } from "./queue";

const NEEDS_HUMAN = "factory:needs-human";
const IN_PROGRESS = "factory:in-progress";
const IN_REVIEW = END;

/** An `in-progress` issue older than this is a run that died: factory.yml caps a run at 45 minutes. */
export const STUCK_AFTER_MINUTES = 60;

/** One open issue with what the digest needs to know about it. */
export interface StatusIssue {
  number: number;
  title: string;
  url: string;
  /** The issue's current `factory:*` label. */
  label: string;
  /** When that label was added. */
  labelledAt: Date;
  /** The factory App's newest comment, if looked up and present. */
  lastAppComment: string | null;
  /** The newest open factory pull request's URL, or null. */
  pr: string | null;
}

export interface StatusResult {
  needsYou: StatusIssue[];
  waitingForMerge: StatusIssue[];
  stuck: StatusIssue[];
}

/** Sorts the issues into the three lists, each oldest label first.
 *
 *  Args:
 *    issues: open issues, each with its one factory label.
 *    now: the time to measure from.
 *  Returns: the three lists. An `in-progress` issue is stuck only after strictly more than 60 minutes;
 *    issues with other labels are ignored. */
export function status(issues: StatusIssue[], now: Date): StatusResult {
  const oldestFirst = (a: StatusIssue, b: StatusIssue) => a.labelledAt.getTime() - b.labelledAt.getTime();
  const pick = (keep: (issue: StatusIssue) => boolean) => issues.filter(keep).sort(oldestFirst);
  return {
    needsYou: pick((i) => i.label === NEEDS_HUMAN),
    waitingForMerge: pick((i) => i.label === IN_REVIEW),
    stuck: pick(
      (i) => i.label === IN_PROGRESS && now.getTime() - i.labelledAt.getTime() > STUCK_AFTER_MINUTES * 60_000,
    ),
  };
}

function age(since: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}d`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h`;
  return `${minutes}m`;
}

function firstLine(text: string | null): string {
  return (text ?? "").split("\n").map((line) => line.trim()).find((line) => line !== "") ?? "";
}

/** Words the result as text.
 *
 *  Args:
 *    result: what `status` returned.
 *    markdown: print `##` headings and linked list items instead of plain text.
 *    now: the time ages are measured from (defaults to the current time).
 *  Returns: the text, with empty sections omitted, or `Nothing is waiting on you.` if all are empty. */
export function render(result: StatusResult, markdown: boolean, now: Date = new Date()): string {
  const sections: { title: string; issues: StatusIssue[]; detail: (i: StatusIssue) => string[] }[] = [
    {
      title: "Needs you",
      issues: result.needsYou,
      detail: (i) => [`for ${age(i.labelledAt, now)}`, ...(firstLine(i.lastAppComment) ? [firstLine(i.lastAppComment)] : [])],
    },
    {
      title: "Waiting for merge",
      issues: result.waitingForMerge,
      detail: (i) => [i.pr ? (markdown ? `[pull request](${i.pr})` : i.pr) : "no open pull request", `for ${age(i.labelledAt, now)}`],
    },
    { title: "Stuck", issues: result.stuck, detail: (i) => [`in progress for ${age(i.labelledAt, now)}`] },
  ];
  const shown = sections.filter((s) => s.issues.length > 0);
  if (shown.length === 0) return "Nothing is waiting on you.";
  return shown
    .map((s) => {
      const lines = s.issues.map((i) =>
        markdown
          ? `- [#${i.number} ${i.title}](${i.url}): ${s.detail(i).join("; ")}`
          : `  #${i.number} ${i.title}: ${s.detail(i).join("; ")}`,
      );
      return markdown ? [`## ${s.title}`, "", ...lines].join("\n") : [s.title, ...lines].join("\n");
    })
    .join("\n\n");
}

/** A GitHub REST object, read loosely. */
// biome-ignore lint/suspicious/noExplicitAny: REST payloads are untyped
type Json = Record<string, any>;

function getAll(path: string): Json[] {
  const pages: Json[][] = JSON.parse(gh(["api", "--paginate", "--slurp", path]));
  return pages.flat();
}

/** Reads the open issues in the three states from GitHub, with GET requests only. */
function gather(repo: string): StatusIssue[] {
  const bot = process.env.FACTORY_BOT;
  const prs: Json[] = JSON.parse(gh(["api", `repos/${repo}/pulls?state=open&per_page=100`]));
  const out: StatusIssue[] = [];
  for (const label of [NEEDS_HUMAN, IN_REVIEW, IN_PROGRESS]) {
    const found = getAll(`repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`);
    for (const issue of found.filter((i) => !("pull_request" in i))) {
      const events = getAll(`repos/${repo}/issues/${issue.number}/events?per_page=100`)
        .filter((e) => e.event === "labeled" && e.label?.name === label)
        .map((e) => e.created_at as string)
        .sort();
      const labelledAt = new Date(events.at(-1) ?? issue.created_at);
      let lastAppComment: string | null = null;
      if (label === NEEDS_HUMAN) {
        const mine = getAll(`repos/${repo}/issues/${issue.number}/comments?per_page=100`).filter((c) =>
          bot ? c.user?.login === bot : String(c.user?.login ?? "").endsWith("[bot]"),
        );
        lastAppComment = mine.sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1)?.body ?? null;
      }
      const prefix = `factory/issue-${issue.number}-`;
      const pr = prs
        .filter((p) => p.head?.repo?.full_name === repo && String(p.head.ref).startsWith(prefix))
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .at(-1);
      out.push({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        label,
        labelledAt,
        lastAppComment,
        pr: label === IN_REVIEW && pr ? pr.html_url : null,
      });
    }
  }
  return out;
}

/** Prints what is waiting on a person in `repo`. */
export function statusCommand(repo: string, markdown: boolean): void {
  const now = new Date();
  console.log(render(status(gather(repo), now), markdown, now));
}
