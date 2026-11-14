/** Tests the factory validator (TL-20): a valid factory passes, and each broken fixture fails with a named reason,
 *  through the function and through `pnpm validate-factory`'s CLI. Run: pnpm test */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { END } from "./factory";
import { validateFactory } from "./validate";

/** Writes a factory into a temporary directory and returns its path. */
function write(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "validate-test-"));
  const dir = join(root, "demo");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  test.after(() => rmSync(root, { recursive: true, force: true }));
  return dir;
}

const agent = (contract: string) =>
  `---\ndescription: An agent.\ncontract: ${contract}\nmodel: haiku\ntools: Read\nbudget_usd: 0.5\ntime_limit_seconds: 60\n---\nDo the work.\n`;

const trigger = (label: string, agentName: string, next: string) =>
  `on: label\nlabel: ${label}\nagent: ${agentName}\nnext: ${next}\ncolor: "0E8A16"\ndescription: Starts ${agentName}.\n`;

/** A valid two-agent factory, with any file replaced or removed (an empty string removes it). */
function demo(changes: Record<string, string> = {}): Record<string, string> {
  const files: Record<string, string> = {
    "factory.yaml": "repositories: [o/r]\nforeman: plan\n",
    "agents/plan/agent.md": agent("note"),
    "agents/build/agent.md": agent("pull-request"),
    "skills/pr-description/SKILL.md": "Describe the change.\n",
    "triggers/go/trigger.yaml": trigger("factory:go", "plan", "factory:build"),
    "triggers/go/comment.md": "Planned: {output}\n",
    "triggers/build/trigger.yaml": trigger("factory:build", "build", END),
    "triggers/build/comment.md": "Built {output}.\n",
    "scorers/cost/scorer.md": "---\nmeasure: cost\n---\nWhat it cost.\n",
    ...changes,
  };
  return Object.fromEntries(Object.entries(files).filter(([, text]) => text !== ""));
}

// Assembled here so this file holds no string a secret scanner would flag.
const fakeKey = ["sk", "ant", "api03", "x".repeat(40)].join("-");
const fakePem = `-----BEGIN ${"RSA PRIVATE"} KEY-----`;

test("a valid factory has no problems", () => {
  assert.deepEqual(validateFactory(write(demo())), []);
});

const broken: [string, Record<string, string>, RegExp][] = [
  ["a directory with no factory.yaml", { "factory.yaml": "" }, /has no factory\.yaml/],
  ["a foreman that is not the entry trigger's agent", { "factory.yaml": "repositories: [o/r]\nforeman: build\n" }, /the foreman is build/],
  ["a trigger naming an agent that does not exist", { "triggers/build/trigger.yaml": trigger("factory:build", "ghost", END) }, /calls ghost, which has no agents\/ghost\/agent\.md/],
  ["an agent.md that does not parse", { "agents/build/agent.md": "---\ncontract: note\n---\nDo it.\n" }, /agents\/build\/agent\.md: missing setting: /],
  ["a pull-request agent without the pr-description skill", { "skills/pr-description/SKILL.md": "" }, /a pull-request agent needs skills\/pr-description\/SKILL\.md/],
  ["a scorer folder with no scorer.md", { "scorers/speed/README.md": "Fast.\n" }, /scorers\/speed: has no scorer\.md/],
  ["a scorer naming a measure that does not exist", { "scorers/cost/scorer.md": "---\nmeasure: speed\n---\nHow fast.\n" }, /scorers\/cost\/scorer\.md: measure must be one of/],
  ["a file that is code", { "triggers/go/run.sh": "echo hi\n" }, /triggers\/go\/run\.sh: is not Markdown or YAML/],
  ["an API key in a prompt", { "agents/plan/agent.md": `${agent("note")}Use ${fakeKey}.\n` }, /agents\/plan\/agent\.md:10: looks like an Anthropic API key/],
  ["a private key in a skill", { "skills/pr-description/SKILL.md": `${fakePem}\n` }, /skills\/pr-description\/SKILL\.md:1: looks like a private key/],
  ["a bypass secret assigned in a comment", { "triggers/go/comment.md": "THROUGHLINE_BYPASS_SECRET=abc123\n" }, /triggers\/go\/comment\.md:1: looks like a secret assigned/],
];

for (const [name, changes, reason] of broken) {
  test(`refused: ${name}`, () => {
    const problems = validateFactory(write(demo(changes)));
    assert.equal(problems.length, 1, problems.join("\n"));
    assert.match(problems[0], reason);
  });
}

test("a secret is named without repeating its value", () => {
  const [problem] = validateFactory(write(demo({ "agents/plan/agent.md": `${agent("note")}${fakeKey}\n` })));
  assert.ok(!problem.includes(fakeKey), problem);
});

test("pnpm validate-factory exits 0 on a valid factory and 1 naming each problem on a broken one", () => {
  const run = (...dirs: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "platform/factory/validate.ts", ...dirs], { encoding: "utf8" });

  const valid = write(demo());
  const ok = run(valid);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /: valid/);

  const bad = write(demo({ "triggers/build/trigger.yaml": trigger("factory:build", "ghost", END), "triggers/go/run.sh": "echo hi\n" }));
  const failed = run(valid, bad);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /not a valid factory/);
  assert.match(failed.stderr, /calls ghost/);
  assert.match(failed.stderr, /run\.sh: is not Markdown or YAML/);

  assert.equal(run().status, 2);
});
