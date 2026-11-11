/** Standing rules: human review comments become rules in `standards/rules.md`, and the review agent cites
 *  them. Exports parseRules, draftRules and checkReview; run as a CLI it collects a draft or checks a review.
 *
 *  pnpm standards collect [--repo owner/repo] [--since YYYY-MM-DD] [--out standards/draft.md]
 *      writes one draft entry per human review comment on PRs merged since the date (default: 7 days ago)
 *  pnpm standards check-review <review.md>
 *      exits 1 unless every finding in the review cites a rule in standards/rules.md, or `no rule`
 *
 *  `collect` needs `gh` signed in with read access to the repository. */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { gh } from "../queue/queue";

export const RULES_PATH = "standards/rules.md";

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

/** Reads the rules from rules.md.
 *
 *  Args:
 *    text: the contents of rules.md.
 *  Returns: every `## R-n: Title` heading, in file order.
 *  Raises: if two rules share an ID, since a citation would then be ambiguous. */
export function parseRules(text: string): Rule[] {
  const rules = [...text.matchAll(/^## (R-\d+): (.+)$/gm)].map(([, id, title]) => ({ id, title: title.trim() }));
  const seen = new Set<string>();
  for (const { id } of rules) {
    if (seen.has(id)) throw new Error(`${id} is defined twice in ${RULES_PATH}`);
    seen.add(id);
  }
  return rules;
}

/** Writes the draft rules file a human turns into rules: one entry per comment not yet captured.
 *
 *  Args:
 *    comments: the human comments on merged PRs.
 *    rulesText: the contents of rules.md; a comment whose URL appears there is already a rule's source.
 *    header: who collected what, for the draft's first paragraph.
 *  Returns: the draft as Markdown. */
export function draftRules(
  comments: ReviewComment[],
  rulesText: string,
  header: { repo: string; since: string; today: string },
): string {
  // Whole URLs only: a substring test would let `...review-1234` hide `...review-123`.
  const cited = new Set(rulesText.split(/[\s()<>]+/));
  const fresh = comments.filter((comment) => !cited.has(comment.url));
  const lines = [
    "# Draft rules",
    "",
    `Collected on ${header.today} from pull requests in ${header.repo} merged since ${header.since}: ${fresh.length} human review comments not yet the source of a rule.`,
    "",
    "For each entry, either write it as a rule in `rules.md` with the next free ID, keeping its Source line, or delete it. A comment about one PR only, not a habit, is not a rule.",
  ];
  for (const comment of fresh) {
    const firstLine = comment.body.trim().split("\n")[0];
    const title = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
    lines.push("", `## R-?: ${title}`, "");
    lines.push(...comment.body.trim().split("\n").map((line) => (line ? `> ${line}` : ">")));
    lines.push("");
    if (comment.path) lines.push(`Where: \`${comment.path}${comment.line ? `:${comment.line}` : ""}\``, "");
    lines.push(`Source: ${comment.url} (@${comment.reviewer} on #${comment.pr}, ${comment.prTitle})`);
  }
  return `${lines.join("\n")}\n`;
}

/** Checks that a review cites a rule, or says `no rule`, for every finding. This is the gate behind the
 *  cite-standards skill: the skill asks for citations, this refuses a review without them.
 *
 *  Args:
 *    review: the review agent's output, with a `## Findings` section.
 *    rules: the rules it may cite.
 *  Returns: the findings, and one error per line that breaks the format or cites an unknown rule. */
export function checkReview(review: string, rules: Rule[]): { findings: Finding[]; errors: string[] } {
  const section = review.match(/^## Findings[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!section) return { findings: [], errors: ["the review has no `## Findings` section"] };

  const known = new Set(rules.map((rule) => rule.id));
  const findings: Finding[] = [];
  const errors: string[] = [];
  const lines = section[1].split("\n").filter((line) => line.trim());
  if (lines.length === 1 && lines[0].trim() === "None.") return { findings, errors };
  if (!lines.length) errors.push("the `## Findings` section is empty; a review with no findings says `None.`");

  for (const line of lines) {
    // An indented line continues the finding above it.
    if (/^\s/.test(line) && findings.length) continue;
    const match = line.match(/^- \[([^\]]+)\] (.+)$/);
    if (!match) {
      errors.push(`not a finding (\`- [R-n] ...\` or \`- [no rule] ...\`): ${line}`);
      continue;
    }
    const [, rule, text] = match;
    if (rule !== "no rule" && !known.has(rule)) errors.push(`cites ${rule}, which is not in ${RULES_PATH}: ${line}`);
    findings.push({ rule, text });
  }
  return { findings, errors };
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
 *  Returns: the human review comments. */
export function humanComments(items: GitHubComment[], pr: { number: number; title: string; author: string }): ReviewComment[] {
  return items
    .filter((item) => item.body?.trim() && item.user?.type !== "Bot" && item.user?.login !== pr.author)
    .map((item) => ({
      pr: pr.number,
      prTitle: pr.title,
      reviewer: item.user?.login ?? "ghost",
      body: item.body ?? "",
      url: item.html_url,
      path: item.path,
      line: item.line ?? item.original_line ?? undefined,
    }));
}

/** Reads every comment on one PR through `gh`, all pages. */
function prItems(repo: string, pr: number): GitHubComment[] {
  return [`pulls/${pr}/comments`, `pulls/${pr}/reviews`, `issues/${pr}/comments`].flatMap((path) =>
    gh(["api", "--paginate", `repos/${repo}/${path}`, "--jq", ".[] | tojson"])
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  );
}

/** Parses `--name value` flags, refusing any name not in `known`. */
function flags(args: string[], known: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].slice(2);
    if (!args[i].startsWith("--") || !known.includes(name) || args[i + 1] === undefined) {
      throw new Error(`expected one of --${known.join(", --")} with a value, got ${args[i]}`);
    }
    result.set(name, args[i + 1]);
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "collect") {
    const options = flags(args, ["repo", "since", "out"]);
    const repo = options.get("repo") ?? gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
    const today = new Date().toISOString().slice(0, 10);
    const since = options.get("since") ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const out = options.get("out") ?? "standards/draft.md";
    const prs: { number: number; title: string; author: { login: string } }[] = JSON.parse(
      gh(["pr", "list", "-R", repo, "--state", "merged", "--search", `merged:>=${since}`, "--limit", "1000", "--json", "number,title,author"]),
    );
    const comments = prs.flatMap((pr) =>
      humanComments(prItems(repo, pr.number), { number: pr.number, title: pr.title, author: pr.author.login }),
    );
    writeFileSync(out, draftRules(comments, readFileSync(RULES_PATH, "utf8"), { repo, since, today }));
    console.log(`${prs.length} merged PRs, ${comments.length} human comments; draft written to ${out}`);
  } else if (command === "check-review" && args.length === 1) {
    const { findings, errors } = checkReview(readFileSync(args[0], "utf8"), parseRules(readFileSync(RULES_PATH, "utf8")));
    const cited = findings.filter((finding) => finding.rule !== "no rule").length;
    console.log(`${findings.length} findings, ${cited} citing a rule`);
    for (const error of errors) console.error(error);
    process.exit(errors.length ? 1 : 0);
  } else {
    console.error("usage: pnpm standards collect [--repo owner/repo] [--since YYYY-MM-DD] [--out file] | check-review <review.md>");
    process.exit(2);
  }
}
