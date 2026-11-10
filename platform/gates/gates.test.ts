/** Tests the quality gate: which checks it runs, its sandbox, and the stop hook's decision. Run: pnpm test */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { type CheckResult, committedChecks, runChecks } from "./checks";
import { MAX_BLOCKS, verdict } from "./stop-hook";

const HERE = dirname(fileURLToPath(import.meta.url));
// srt sandboxes with Seatbelt on macOS and bubblewrap on Linux; GitHub's Ubuntu runners do not allow bubblewrap's
// user namespaces, so the tests that start a sandbox run only where scripts/run-issue.sh runs today.
const NO_SANDBOX = process.platform !== "darwin" && "the sandbox tests need macOS";

/** Makes a git checkout whose committed package.json defines `scripts`, plus any extra committed files. */
function checkout(scripts: Record<string, string>, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "gates-test-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture");
  return dir;
}

const result = (name: string, ok: boolean, output = ""): CheckResult => ({ name, ok, exitCode: ok ? 0 : 1, seconds: 0, output });

test("the agent may stop when every check passes", () => {
  assert.deepEqual(verdict([result("typecheck", true), result("test", true)], 0), { block: false, message: "" });
});

test("a failing check blocks the stop and is named with its output", () => {
  const { block, message } = verdict([result("typecheck", true), result("test", false, "not ok 1 - adds\n")], 0);
  assert.equal(block, true);
  assert.match(message, /^Quality gate: test failed, so you cannot finish yet\. Passed: typecheck\./);
  assert.match(message, /--- test \(exit 1\) ---\nnot ok 1 - adds/);
});

test("long output is cut to its last lines", () => {
  const output = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
  const { message } = verdict([result("lint", false, output)], 0);
  assert.match(message, /--- lint \(exit 1, last 60 of 100 lines\) ---\nline 41\n/);
  assert.doesNotMatch(message, /line 40\n/);
});

test(`the hook stops blocking after ${MAX_BLOCKS} blocked attempts`, () => {
  assert.equal(verdict([result("test", false)], MAX_BLOCKS - 1).block, true);
  assert.equal(verdict([result("test", false)], MAX_BLOCKS).block, false);
});

test("checks come from the committed package.json, not the working copy", () => {
  const dir = checkout({ test: "node --test", lint: "biome lint", build: "tsc" });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
  assert.deepEqual(committedChecks(dir), [
    { name: "lint", script: "biome lint" },
    { name: "test", script: "node --test" },
  ]);
  rmSync(join(dir, "package.json"));
  assert.equal(committedChecks(dir).length, 2);
});

test("a checkout without a committed package.json has no checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "gates-test-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  assert.deepEqual(committedChecks(dir), []);
});

test("checks run in the sandbox: the checkout is writable, home, temp and network are not", { skip: NO_SANDBOX }, () => {
  const secret = mkdtempSync(join(tmpdir(), "gates-secret-"));
  writeFileSync(join(secret, "key"), "sk-not-a-real-key");
  const dir = checkout({
    typecheck: "touch written-by-check && node -e \"require('fs').readFileSync('package.json')\"",
    lint: `ls ${JSON.stringify(homedir())}`,
    test: `cat ${JSON.stringify(join(secret, "key"))}`,
  });
  const [inside, home, key] = runChecks(dir, committedChecks(dir));
  assert.equal(inside.ok, true, inside.output);
  assert.equal(home.ok, false);
  assert.match(home.output, /Operation not permitted/);
  assert.equal(key.ok, false);
  assert.doesNotMatch(key.output, /sk-not-a-real-key/);

  const [network] = runChecks(dir, [{ name: "test", script: "curl -sS -m 5 https://example.com" }]);
  assert.equal(network.ok, false);
});

test("the stop hook blocks a broken checkout, names the check, and passes once it is fixed", { skip: NO_SANDBOX }, () => {
  const dir = checkout(
    { test: "node --test" },
    { "add.test.mjs": "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('adds', () => assert.equal(1 + 1, 3));\n" },
  );
  const log = join(mkdtempSync(join(tmpdir(), "gates-log-")), "gates.jsonl");
  // Inherited from this test run, NODE_TEST_CONTEXT makes the fixture's `node --test` skip its files and exit 0.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const hook = () =>
    spawnSync(join(HERE, "../../node_modules/.bin/tsx"), [join(HERE, "stop-hook.ts"), dir, log], { encoding: "utf8", env });

  const blocked = hook();
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /^Quality gate: test failed/);
  assert.match(blocked.stderr, /not ok 1 - adds/);

  writeFileSync(join(dir, "add.test.mjs"), readFileSync(join(dir, "add.test.mjs"), "utf8").replace("3", "2"));
  const fixed = hook();
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.deepEqual(
    readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line).passed),
    [false, true],
  );
});
