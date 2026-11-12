/** Tests the standing rules: reading rules.md, drafting rules from comments, checking citations and the
 *  review's Stop hook. Run: pnpm test */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { MAX_BLOCKS } from "../gates/stop-hook";
import { RULES_PATH, checkReview, citedUrls, draftRules, humanComments, parseRules, reviewVerdict, validSince } from "./standards";

const RULES = "# Standing rules\n\n## R-1: Secrets never enter the repository\n\nText.\n\n## R-2: Factories are data\n\nText.\n";
const PR = { number: 7, title: "TL-7: agents", author: "factory-app[bot]" };
const HEADER = { repo: "o/r", since: "2026-11-04", today: "2026-11-11" };
const comment = (url: string, body = "A point") => ({ pr: 7, prTitle: "t", reviewer: "owner", body, url });

test("rules are read from their ## R-n headings, in order", () => {
  assert.deepEqual(parseRules(RULES), [
    { id: "R-1", title: "Secrets never enter the repository" },
    { id: "R-2", title: "Factories are data" },
  ]);
});

test("rules.md saved with CRLF line endings parses the same", () => {
  assert.deepEqual(parseRules(RULES.replace(/\n/g, "\r\n")), parseRules(RULES));
});

test("a rule ID used twice is refused, since a citation of it would be ambiguous", () => {
  assert.throws(() => parseRules("## R-1: One\n## R-1: Two\n"), /R-1 is defined twice/);
});

test("the committed rules.md parses and has at least one rule", () => {
  assert.ok(parseRules(readFileSync(RULES_PATH, "utf8")).length > 0);
});

test("a reviewer's comments are kept; the author's replies, bots and empty approvals are not", () => {
  const user = (login: string, type = "User") => ({ login, type });
  const comments = humanComments(
    [
      { body: "Put the key in .env.example", html_url: "u1", user: user("owner"), path: "a.ts", line: 3 },
      { body: "Done", html_url: "u2", user: user("factory-app[bot]", "Bot") },
      { body: "Coverage 80%", html_url: "u3", user: user("codecov", "Bot") },
      { body: "", html_url: "u4", user: user("owner") },
      { body: null, html_url: "u5", user: user("owner") },
      { body: "Outdated line", html_url: "u6", user: user("owner"), path: "b.ts", line: null, original_line: 9 },
      { body: "From a deleted account", html_url: "u7", user: null },
    ],
    PR,
  );
  assert.deepEqual(
    comments.map((c) => [c.url, c.reviewer, c.path, c.line]),
    [
      ["u1", "owner", "a.ts", 3],
      ["u6", "owner", "b.ts", 9],
      ["u7", "ghost", undefined, undefined],
    ],
  );
});

test("the PR's author is left out even when a human opened the PR", () => {
  const comments = humanComments([{ body: "Tested on a throwaway issue", html_url: "u", user: { login: "owner", type: "User" } }], {
    ...PR,
    author: "owner",
  });
  assert.deepEqual(comments, []);
});

test("a comment written in GitHub's web UI, with CRLF line endings, is drafted without stray \\r", () => {
  const [crlf] = humanComments([{ body: "Keys go in .env.example\r\n\r\nwith a comment.", html_url: "https://x/1", user: { login: "o", type: "User" } }], PR);
  const { text } = draftRules("", [crlf], "", HEADER);
  assert.doesNotMatch(text, /\r/);
  assert.match(text, /^## R-\?: Keys go in \.env\.example$/m);
  assert.match(text, /^> Keys go in \.env\.example\n>\n> with a comment\.$/m);
});

test("a new draft has the instructions, then one entry per comment with its place and source", () => {
  const { text, added } = draftRules(
    "",
    [{ ...comment("https://x/1", "Keys go in .env.example\n\nwith a comment."), path: "a.ts", line: 3 }],
    RULES,
    HEADER,
  );
  assert.equal(added, 1);
  assert.match(text, /^# Draft rules$/m);
  assert.match(text, /rejected\.md/);
  assert.match(text, /merged since 2026-11-04: 1 new\.$/m);
  assert.match(text, /^## R-\?: Keys go in \.env\.example$/m);
  assert.match(text, /^Where: `a\.ts:3`$/m);
  assert.match(text, /^Source: https:\/\/x\/1 \(@owner on #7, t\)$/m);
  assert.deepEqual(parseRules(text), [], "draft entries are not rules until a human numbers them");
});

test("collecting again keeps the draft's edits and adds only comments it does not hold", () => {
  const first = draftRules("", [comment("https://x/1", "First")], RULES, HEADER).text;
  const edited = first.replace("## R-?: First", "## R-?: First, reworded by a human");
  const { text, added } = draftRules(edited, [comment("https://x/1", "First"), comment("https://x/2", "Second")], RULES, HEADER);
  assert.equal(added, 1);
  assert.ok(text.startsWith(edited.trimEnd()), "the edited draft is kept as it was");
  assert.equal(text.match(/https:\/\/x\/1/g)?.length, 1, "the first comment is not drafted twice");
  assert.match(text, /^Source: https:\/\/x\/2 /m);
});

test("nothing new leaves the draft exactly as it was", () => {
  const draft = draftRules("", [comment("https://x/1")], RULES, HEADER).text;
  assert.deepEqual(draftRules(draft, [comment("https://x/1")], RULES, HEADER), { text: draft, added: 0 });
});

test("a comment rejected in rejected.md, or already a rule's source, is not drafted again", () => {
  const decided = `${RULES}\nSource: https://x/1\n\n# Rejected comments\n\n- https://x/2 — about one PR only\n`;
  const { added } = draftRules("", [comment("https://x/1"), comment("https://x/2")], decided, HEADER);
  assert.equal(added, 0);
});

test("a source followed by punctuation still matches its comment", () => {
  for (const cited of ["Source: https://x/1.", "Source: https://x/1, and", "see https://x/1;", "[link](https://x/1)", "<https://x/1>"]) {
    assert.ok(citedUrls(cited).has("https://x/1"), cited);
  }
});

test("a cited URL that merely starts with a comment's URL does not hide the comment", () => {
  const decided = `${RULES}\nSource: https://x/7#pullrequestreview-1234 (@owner on #7)\n`;
  assert.equal(draftRules("", [comment("https://x/7#pullrequestreview-123")], decided, HEADER).added, 1);
});

test("a long first line is shortened in the entry's title but quoted in full", () => {
  const body = "x".repeat(100);
  const { text } = draftRules("", [comment("u", body)], "", HEADER);
  assert.match(text, new RegExp(`^## R-\\?: ${"x".repeat(77)}\\.\\.\\.$`, "m"));
  assert.match(text, new RegExp(`^> ${body}$`, "m"));
});

test("--since must be a real YYYY-MM-DD date before it reaches the search qualifier", () => {
  assert.ok(validSince("2026-11-04"));
  for (const bad of ["2026-11-4", "yesterday", "2026-02-30", "2026-11-04 is:open", "2026-11-04T00:00"]) assert.ok(!validSince(bad), bad);
});

test("collect refuses an unknown flag and a malformed --since without calling GitHub", () => {
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "platform/standards/standards.ts", "collect", ...args], { encoding: "utf8" });
  assert.match(cli("--repos", "o/r").stderr, /Unknown option '--repos'/);
  assert.match(cli("--repo", "o/r", "--since", "last week").stderr, /--since must be a date as YYYY-MM-DD/);
});

const rules = parseRules(RULES);

test("a review whose findings each cite a known rule or `no rule` passes", () => {
  const review = [
    "Summary of the change.",
    "",
    "## Findings",
    "",
    "- [R-1] `.env:1` — blocking: adds an API key to the repository.",
    "- [no rule] `queue.ts:40` — should fix: reads the label before the claim.",
    "  The second line of a finding is indented prose.",
    "",
    "## Notes",
    "- [R-9] lines outside the Findings section are not findings.",
  ].join("\n");
  assert.deepEqual(checkReview(review, rules), {
    findings: [
      { rule: "R-1", text: "`.env:1` — blocking: adds an API key to the repository." },
      { rule: "no rule", text: "`queue.ts:40` — should fix: reads the label before the claim." },
    ],
    errors: [],
  });
});

test("a review with no findings says None. and passes", () => {
  assert.deepEqual(checkReview("## Findings\n\nNone.\n", rules), { findings: [], errors: [] });
});

test("a finding that cites no rule, or a rule that does not exist, fails", () => {
  const { errors } = checkReview("## Findings\n- `a.ts:1` is wrong\n- [R-7] `b.ts:2` is wrong\n- [R1] `c.ts:3`\n", rules);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /not a finding/);
  assert.match(errors[1], /cites R-7, which is not in standards\/rules\.md/);
  assert.match(errors[2], /cites R1/);
});

test("a nested bullet is a finding of its own and must cite a rule", () => {
  const { errors } = checkReview("## Findings\n- [no rule] several problems:\n  - `a.ts:1` uncited\n  * [R-1] `b.ts:2` cited\n", rules);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not a finding.*`a\.ts:1` uncited/);
});

test("a second Findings section is refused, so uncited findings cannot hide in it", () => {
  const { errors } = checkReview("## Findings\n- [R-1] fine\n\n## Findings\n- `a.ts` uncited\n", rules);
  assert.ok(errors.some((error) => /2 `## Findings` sections/.test(error)));
  assert.ok(errors.some((error) => /not a finding.*uncited/.test(error)));
});

test("a review with CRLF line endings is checked like one with LF", () => {
  const review = "Summary.\n\n## Findings\n\n- [R-1] `.env:1` — blocking: a key.\n- `a.ts` uncited\n";
  assert.deepEqual(checkReview(review.replace(/\n/g, "\r\n"), rules), checkReview(review, rules));
  assert.equal(checkReview(review.replace(/\n/g, "\r\n"), rules).findings.length, 1);
});

test("text after the findings, a horizontal rule, an h1 or a suffixed heading do not break the section", () => {
  const ok = (review: string) => assert.deepEqual(checkReview(review, rules).errors, [], review);
  ok("## Findings\n\n- [R-1] `.env:1` — blocking: a key.\n\nOverall: approve once fixed.\n");
  ok("## Findings\n\nNone.\n\n---\n\nReviewed at abc123.\n- a footer list\n");
  ok("## Findings\n- [R-1] a key\n# Appendix\n- notes\n");
  ok("## Findings (2)\n- [R-1] a key\n- [no rule] a bug\n");
  ok("## Findings:\nNone.\n");
});

test("a heading inside a code fence neither ends the section nor starts one", () => {
  const fenced = "## Findings\n- [no rule] `a.ts:3` — nit: the example:\n  ```md\n## Findings\n- this line is code\n  ```\n- [R-1] `b.ts:1` — blocking: a key.\n";
  assert.deepEqual(checkReview(fenced, rules), {
    findings: [
      { rule: "no rule", text: "`a.ts:3` — nit: the example:" },
      { rule: "R-1", text: "`b.ts:1` — blocking: a key." },
    ],
    errors: [],
  });
  assert.deepEqual(checkReview("```\n## Findings\nNone.\n```\n", rules).errors, ["the review has no `## Findings` section"]);
});

test("a review without a Findings section fails", () => {
  assert.deepEqual(checkReview("Looks good to me.", rules).errors, ["the review has no `## Findings` section"]);
});

test("an empty Findings section, or one holding only prose, fails: the reviewer must say None.", () => {
  assert.match(checkReview("## Findings\n\n## Notes\nfine\n", rules).errors.join(), /has no findings/);
  assert.match(checkReview("## Findings\n`a.ts:1` leaks a key\n", rules).errors.join(), /has no findings/);
});

test("the review hook lets a cited review finish, refuses an uncited one, and gives up after MAX_BLOCKS", () => {
  assert.deepEqual(reviewVerdict("## Findings\nNone.\n", rules, 0), { passed: true, block: false, message: "" });
  const refused = reviewVerdict("## Findings\n- `a.ts` uncited\n", rules, 0);
  assert.equal(refused.block, true);
  assert.match(refused.message, /Citation gate[\s\S]*not a finding/);
  assert.deepEqual(reviewVerdict("## Findings\n- `a.ts` uncited\n", rules, MAX_BLOCKS), {
    passed: false,
    block: false,
    message: `Gave up after ${MAX_BLOCKS} blocked attempts.`,
  });
  assert.equal(reviewVerdict(undefined, rules, 0).block, true);
});

test("the review hook, started as Claude Code starts it, blocks with exit 2 and logs each attempt", () => {
  const log = join(mkdtempSync(join(tmpdir(), "review-hook-")), "gates.jsonl");
  const hook = (message: string) =>
    spawnSync(process.execPath, ["--import", "tsx", "platform/standards/standards.ts", "review-hook", log], {
      input: JSON.stringify({ hook_event_name: "Stop", last_assistant_message: message }),
      encoding: "utf8",
    });
  const blocked = hook("## Findings\n- `a.ts:1` — blocking: uncited\n");
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /Citation gate/);
  assert.equal(hook("## Findings\n- [R-1] `a.ts:1` — blocking: a key\n").status, 0);
  const lines = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(
    lines.map((line) => [line.passed, line.checks]),
    [
      [false, [{ name: "citations", ok: false }]],
      [true, [{ name: "citations", ok: true }]],
    ],
  );
});
