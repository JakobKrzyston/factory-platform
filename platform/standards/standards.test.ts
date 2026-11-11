/** Tests the standing rules: reading rules.md, drafting rules from comments and checking citations. Run: pnpm test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { RULES_PATH, checkReview, draftRules, humanComments, parseRules } from "./standards";

const RULES = "# Standing rules\n\n## R-1: Secrets never enter the repository\n\nText.\n\n## R-2: Factories are data\n\nText.\n";
const PR = { number: 7, title: "TL-7: agents", author: "factory-app[bot]" };

test("rules are read from their ## R-n headings, in order", () => {
  assert.deepEqual(parseRules(RULES), [
    { id: "R-1", title: "Secrets never enter the repository" },
    { id: "R-2", title: "Factories are data" },
  ]);
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
    comments.map((comment) => [comment.url, comment.reviewer, comment.path, comment.line]),
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

test("the draft has one entry per comment, quoting it with its place and source", () => {
  const draft = draftRules(
    [{ pr: 7, prTitle: "TL-7: agents", reviewer: "owner", body: "Keys go in .env.example\n\nwith a comment.", url: "https://x/1", path: "a.ts", line: 3 }],
    RULES,
    { repo: "o/r", since: "2026-11-04", today: "2026-11-11" },
  );
  assert.match(draft, /merged since 2026-11-04: 1 human review comments/);
  assert.match(draft, /^## R-\?: Keys go in \.env\.example$/m);
  assert.match(draft, /^> Keys go in \.env\.example\n>\n> with a comment\.$/m);
  assert.match(draft, /^Where: `a\.ts:3`$/m);
  assert.match(draft, /^Source: https:\/\/x\/1 \(@owner on #7, TL-7: agents\)$/m);
  assert.deepEqual(parseRules(draft), [], "draft entries are not rules until a human numbers them");
});

test("a comment already cited as a rule's source is not drafted again", () => {
  const comment = { pr: 7, prTitle: "t", reviewer: "owner", body: "Same as before", url: "https://x/1" };
  const draft = draftRules([comment], `${RULES}\nSource: https://x/1\n`, { repo: "o/r", since: "d", today: "d" });
  assert.match(draft, /: 0 human review comments/);
  assert.doesNotMatch(draft, /Same as before/);
});

test("a cited URL that merely starts with a comment's URL does not hide the comment", () => {
  const comment = { pr: 7, prTitle: "t", reviewer: "owner", body: "New point", url: "https://x/7#pullrequestreview-123" };
  const draft = draftRules([comment], `${RULES}\nSource: https://x/7#pullrequestreview-1234 (@owner on #7)\n`, {
    repo: "o/r",
    since: "d",
    today: "d",
  });
  assert.match(draft, /New point/);
});

test("a long first line is shortened in the entry's title but quoted in full", () => {
  const body = "x".repeat(100);
  const draft = draftRules([{ pr: 1, prTitle: "t", reviewer: "r", body, url: "u" }], "", { repo: "o/r", since: "d", today: "d" });
  assert.match(draft, new RegExp(`^## R-\\?: ${"x".repeat(77)}\\.\\.\\.$`, "m"));
  assert.match(draft, new RegExp(`^> ${body}$`, "m"));
});

const rules = parseRules(RULES);

test("a review whose findings each cite a known rule or `no rule` passes", () => {
  const review = [
    "Summary of the change.",
    "",
    "## Findings",
    "",
    "- [R-1] `.env:1` adds an API key to the repository.",
    "- [no rule] `queue.ts:40` — major: reads the label before the claim.",
    "  The second line of a finding is indented.",
    "",
    "## Notes",
    "- [R-9] lines outside the Findings section are not findings.",
  ].join("\n");
  assert.deepEqual(checkReview(review, rules), {
    findings: [
      { rule: "R-1", text: "`.env:1` adds an API key to the repository." },
      { rule: "no rule", text: "`queue.ts:40` — major: reads the label before the claim." },
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

test("a review without a Findings section fails", () => {
  assert.deepEqual(checkReview("Looks good to me.", rules).errors, ["the review has no `## Findings` section"]);
});

test("an empty Findings section fails: the reviewer must say None.", () => {
  assert.match(checkReview("## Findings\n\n## Notes\nfine\n", rules).errors.join(), /section is empty/);
});
