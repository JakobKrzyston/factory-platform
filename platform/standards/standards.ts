/** Standing rules: human review comments become rules in `standards/rules.md`, and the review agent cites
 *  them. Exports parseRules, citedUrls, humanComments, draftRules, checkReview and reviewVerdict; run as a CLI
 *  it collects a draft, checks a review, or gates the review agent as its Stop hook.
 *
 *  pnpm standards collect [--repo owner/repo] [--since YYYY-MM-DD] [--out standards/draft.md]
 *      appends one entry to the draft per human review comment on PRs merged since the date (default:
 *      7 days ago) that is not already in rules.md, rejected.md or the draft
 *  pnpm standards check-review <review.md>
 *      prints "<findings> findings, <cited> citing a rule"; exits 1 unless every finding cites a rule in
 *      rules.md, or `no rule`
 *  tsx platform/standards/standards.ts review-hook <gates.jsonl>
 *      the review role's Stop hook (scripts/run-issue.sh): refuses to let the agent finish while check-review
 *      would fail, and appends each attempt to the log
 *
 *  `collect` needs `gh` signed in with read access to the repository. */
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";

import { MAX_BLOCKS } from "../gates/stop-hook";

export const RULES_PATH = "standards/rules.md";
export const REJECTED_PATH = "standards/rejected.md";
export const DRAFT_PATH = "standards/draft.md";
// How many `gh api` calls collect runs at once: enough to hide latency, few enough to stay clear of
// GitHub's secondary rate limits.
const CONCURRENCY = 8;

/** One standing rule: `## R-3: Title` in rules.md. */
export type Rule = { id: string; title: string };

/** One comment a human left on a merged pull request. */
export type ReviewComment = {
  pr: number;
  prTitle: string;
  reviewer: string;
  body: string;
  url: string;
  path?: string;
  line?: number;
};

/** One finding from a review, with the rule it cites (`no rule` when none applies). */
export type Finding = { rule: string; text: string };

/** GitHub's web UI saves bodies with \r\n; everything here splits on \n. */
function unixLines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Reads the rules from rules.md.
 *
 *  Args:
 *    text: the contents of rules.md.
 *  Returns: every `## R-n: Title` heading, in file order.
 *  Raises: if two rules share an ID, since a citation would then be ambiguous. */
export function parseRules(text: string): Rule[] {
  const rules = [...unixLines(text).matchAll(/^## (R-\d+): (.+)$/gm)].map(([, id, title]) => ({ id, title: title.trim() }));
  const seen = new Set<string>();
  for (const { id } of rules) {
    if (seen.has(id)) throw new Error(`${id} is defined twice in ${RULES_PATH}`);
    seen.add(id);
  }
  return rules;
}

/** Finds every link in a Markdown file, as a whole URL: trailing sentence punctuation is not part of it, and
 *  `...review-1234` is not `...review-123`.
 *
 *  Args:
 *    text: Markdown, such as rules.md.
 *  Returns: the URLs it contains. */
export function citedUrls(text: string): Set<string> {
  return new Set([...text.matchAll(/https?:\/\/[^\s<>()[\]"'`]+/g)].map(([url]) => url.replace(/[.,;:!?]+$/, "")));
}

/** GitHub's shape for an inline review comment, a review or a conversation comment; only the fields used. */
export type GitHubComment = {
  body: string | null;
  html_url: string;
  user: { login: string; type: string } | null;
  path?: string;
  line?: number | null;
  original_line?: number | null;
};

/** Keeps the comments a human reviewer left: not the PR's author answering, not a bot, not an empty
 *  approval. A deleted account's comments have no user; they still count as a human's.
 *
 *  Args:
 *    items: the PR's inline review comments, reviews and conversation comments, as GitHub returns them.
 *    pr: the PR's number, title and author's login.
 *  Returns: the human review comments, with \n line endings. */
export function humanComments(items: GitHubComment[], pr: { number: number; title: string; author: string }): ReviewComment[] {
  return items
    .filter((item) => item.body?.trim() && item.user?.type !== "Bot" && item.user?.login !== pr.author)
    .map((item) => ({
      pr: pr.number,
      prTitle: pr.title,
      reviewer: item.user?.login ?? "ghost",
      body: unixLines(item.body ?? ""),
      url: item.html_url,
      path: item.path,
      line: item.line ?? item.original_line ?? undefined,
    }));
}

const DRAFT_INTRO = `# Draft rules

Human review comments from merged pull requests, appended by \`pnpm standards collect\`. For each entry, either:

- write it as a rule in \`rules.md\` with the next free ID, keeping its Source line, or
- add its Source link to \`rejected.md\` with a reason: a comment about one PR, not a habit, is not a rule.

Then delete the entry here. A comment whose link is in \`rules.md\`, \`rejected.md\` or this file is never drafted again; one deleted from here without either comes back on the next run that reaches its PR.
`;

/** Adds the comments not yet captured to the draft, keeping everything already in it, including edits.
 *
 *  Args:
 *    draft: the current draft.md, or "" if there is none.
 *    comments: the human comments on merged PRs.
 *    decided: rules.md and rejected.md, whose links are comments already decided.
 *    header: who collected what, for the paragraph that heads the new entries.
 *  Returns: the new draft, unchanged when nothing is new, and how many entries were added. */
export function draftRules(
  draft: string,
  comments: ReviewComment[],
  decided: string,
  header: { repo: string; since: string; today: string },
): { text: string; added: number } {
  const captured = citedUrls(`${decided}\n${draft}`);
  const fresh = comments.filter((comment) => !captured.has(comment.url));
  if (!fresh.length) return { text: draft, added: 0 };

  const lines = [`Collected on ${header.today} from pull requests in ${header.repo} merged since ${header.since}: ${fresh.length} new.`];
  for (const comment of fresh) {
    const body = comment.body.trim().split("\n");
    const title = body[0].length > 80 ? `${body[0].slice(0, 77)}...` : body[0];
    lines.push("", `## R-?: ${title}`, "");
    lines.push(...body.map((line) => (line ? `> ${line}` : ">")));
    lines.push("");
    if (comment.path) lines.push(`Where: \`${comment.path}${comment.line ? `:${comment.line}` : ""}\``, "");
    lines.push(`Source: ${comment.url} (@${comment.reviewer} on #${comment.pr}, ${comment.prTitle})`);
  }
  const start = draft.trim() ? `${draft.trimEnd()}\n\n` : `${DRAFT_INTRO}\n`;
  return { text: `${start}${lines.join("\n")}\n`, added: fresh.length };
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^#{1,6}(\s|$)/;
const FINDINGS_HEADING = /^##\s+Findings\b/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/** Checks that a review cites a rule, or says `no rule`, for every finding. This is the gate behind the
 *  cite-standards skill: the skill asks for citations, this refuses a review without them.
 *
 *  A finding is any list item, nested or not, in the review's one `## Findings` section, which runs to the
 *  next heading or horizontal rule. Lines inside code fences are never findings or headings. Other text in
 *  the section, such as a closing "Overall: approve.", is allowed. The section must hold a finding or `None.`
 *
 *  Args:
 *    review: the review agent's output.
 *    rules: the rules it may cite.
 *  Returns: the findings, and one error per problem: a missing, repeated or empty section, a finding with no
 *  `[R-n]` or `[no rule]` tag, or a tag naming a rule that does not exist. */
export function checkReview(review: string, rules: Rule[]): { findings: Finding[]; errors: string[] } {
  const known = new Set(rules.map((rule) => rule.id));
  const findings: Finding[] = [];
  const errors: string[] = [];
  let sections = 0;
  let inside = false;
  let filled = false; // the current section has a finding or None.
  let fence = "";

  const close = () => {
    if (inside && !filled) errors.push("the `## Findings` section has no findings; a review with none says `None.`");
    inside = false;
  };

  for (const line of unixLines(review).split("\n")) {
    const fenceMark = line.match(FENCE)?.[1];
    if (fence) {
      if (fenceMark?.[0] === fence[0] && fenceMark.length >= fence.length) fence = "";
      continue;
    }
    if (fenceMark) {
      fence = fenceMark;
      continue;
    }
    if (HEADING.test(line)) {
      close();
      if (FINDINGS_HEADING.test(line)) {
        sections++;
        inside = true;
        filled = false;
      }
      continue;
    }
    if (!inside) continue;
    if (THEMATIC_BREAK.test(line)) {
      close();
      continue;
    }
    if (line.trim() === "None.") filled = true;
    const item = line.match(BULLET)?.[1];
    if (item === undefined) continue;

    filled = true;
    const tagged = item.match(/^\[([^\]]+)\]\s+(\S.*)$/);
    if (!tagged) {
      errors.push(`not a finding (\`- [R-n] ...\` or \`- [no rule] ...\`): ${line.trim()}`);
      continue;
    }
    const [, rule, text] = tagged;
    if (rule !== "no rule" && !known.has(rule)) errors.push(`cites ${rule}, which is not in ${RULES_PATH}: ${line.trim()}`);
    findings.push({ rule, text });
  }
  close();

  if (sections === 0) errors.push("the review has no `## Findings` section");
  if (sections > 1) errors.push(`the review has ${sections} \`## Findings\` sections; put every finding in one`);
  return { findings, errors };
}

/** Decides whether the review agent may stop: the review's Stop hook.
 *
 *  Args:
 *    review: the agent's last message, which run-issue.sh posts as the review; undefined if Claude Code sent none.
 *    rules: the standing rules.
 *    blocksSoFar: how many earlier attempts in this run were refused.
 *  Returns: passed, whether the review passes check-review; block, whether to refuse the stop; message, for
 *  the agent. After MAX_BLOCKS refusals the agent may stop, and run-issue.sh, which checks again, posts nothing. */
export function reviewVerdict(
  review: string | undefined,
  rules: Rule[],
  blocksSoFar: number,
): { passed: boolean; block: boolean; message: string } {
  const errors = review === undefined ? ["Claude Code passed the hook no last message to check"] : checkReview(review, rules).errors;
  if (!errors.length) return { passed: true, block: false, message: "" };
  if (blocksSoFar >= MAX_BLOCKS) return { passed: false, block: false, message: `Gave up after ${MAX_BLOCKS} blocked attempts.` };
  const message = [
    "Citation gate: your last message is posted as the review, and its findings do not all cite a standing rule, so you cannot finish yet.",
    ...errors.map((error) => `- ${error}`),
    "Write the whole review again as your last message. Every list item under its one `## Findings` heading is a finding and starts with `[R-n]` or `[no rule]`; put further detail in indented prose, not nested bullets. With no findings, the section is `None.`",
  ].join("\n");
  return { passed: false, block: true, message };
}

const run = promisify(execFile);

/** Runs `gh` without blocking, so several calls can wait on GitHub at once. Returns its stdout. */
async function ghAsync(args: string[]): Promise<string> {
  return (await run("gh", args, { maxBuffer: 256 * 1024 * 1024 })).stdout;
}

/** Reads every comment on one PR, all pages of all three kinds. */
async function prItems(repo: string, pr: number): Promise<GitHubComment[]> {
  const pages = await Promise.all(
    [`pulls/${pr}/comments`, `pulls/${pr}/reviews`, `issues/${pr}/comments`].map((path) =>
      ghAsync(["api", "--paginate", `repos/${repo}/${path}`, "--jq", ".[] | tojson"]),
    ),
  );
  return pages.flatMap((out) => out.split("\n").filter(Boolean).map((line) => JSON.parse(line)));
}

/** Maps over items with at most `limit` calls in flight, keeping their order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Validates collect's --since: a real calendar date, since it goes into a GitHub search qualifier. */
export function validSince(since: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(since) && new Date(`${since}T00:00:00Z`).toISOString().startsWith(since);
}

async function collect(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { repo: { type: "string" }, since: { type: "string" }, out: { type: "string" } },
  });
  const out = values.out ?? DRAFT_PATH;
  const repo = values.repo ?? (await ghAsync(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])).trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`--repo must be owner/repo, got ${repo}`);
  const since = values.since ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  if (!validSince(since)) throw new Error(`--since must be a date as YYYY-MM-DD, got ${since}`);

  // Each PR's comments are read with concurrent calls; the PR list is a single call.
  const prs: { number: number; title: string; author: { login: string } }[] = JSON.parse(
    await ghAsync(["pr", "list", "-R", repo, "--state", "merged", "--search", `merged:>=${since}`, "--limit", "1000", "--json", "number,title,author"]),
  );
  const comments = (
    await mapLimit(prs, CONCURRENCY, async (pr) =>
      humanComments(await prItems(repo, pr.number), { number: pr.number, title: pr.title, author: pr.author.login }),
    )
  ).flat();

  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
  const { text, added } = draftRules(read(out), comments, `${read(RULES_PATH)}\n${read(REJECTED_PATH)}`, {
    repo,
    since,
    today: new Date().toISOString().slice(0, 10),
  });
  if (added) writeFileSync(out, text);
  console.log(`${prs.length} merged PRs, ${comments.length} human comments, ${added} new in ${out}`);
}

// realpath: import.meta.url has symlinks resolved and argv[1] does not.
if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  const rules = () => parseRules(readFileSync(RULES_PATH, "utf8"));
  if (command === "collect") {
    await collect(args);
  } else if (command === "check-review" && args.length === 1) {
    const { findings, errors } = checkReview(readFileSync(args[0], "utf8"), rules());
    console.log(`${findings.length} findings, ${findings.filter((finding) => finding.rule !== "no rule").length} citing a rule`);
    for (const error of errors) console.error(error);
    process.exit(errors.length ? 1 : 0);
  } else if (command === "review-hook" && args.length === 1) {
    // Claude Code passes a Stop hook its input on stdin, including the message the agent is ending on.
    const input: { last_assistant_message?: string } = JSON.parse(readFileSync(0, "utf8") || "{}");
    const log = args[0];
    const blocksSoFar = existsSync(log)
      ? readFileSync(log, "utf8").split("\n").filter((line) => line && !JSON.parse(line).passed).length
      : 0;
    const { passed, block, message } = reviewVerdict(input.last_assistant_message, rules(), blocksSoFar);
    appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), passed, checks: [{ name: "citations", ok: passed }] })}\n`);
    // Exit code 2 is Claude Code's "block": the stop is refused and stderr is given to the agent.
    if (message) process.stderr.write(`${message}\n`);
    process.exit(block ? 2 : 0);
  } else {
    console.error("usage: pnpm standards collect [--repo owner/repo] [--since YYYY-MM-DD] [--out file] | check-review <review.md>");
    process.exit(2);
  }
}
