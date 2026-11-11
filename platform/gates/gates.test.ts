/** Tests the quality gate: which checks it runs, its sandbox, and the stop hook's decision. Run: pnpm test */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { type CheckResult, baseChecks, runChecks } from "./checks";
import { type GateConfig, MAX_BLOCKS, verdict } from "./stop-hook";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
// srt sandboxes with Seatbelt on macOS and bubblewrap on Linux; GitHub's Ubuntu runners do not allow bubblewrap's
// user namespaces, so the tests that start a sandbox run only on macOS. They also cannot run inside srt, as when the
// gate runs this repository's own tests: srt sets SANDBOX_RUNTIME, and cannot start a sandbox inside its own.
const NO_SANDBOX =
  process.platform !== "darwin"
    ? "the sandbox tests need macOS"
    : process.env.SANDBOX_RUNTIME === "1" && "the sandbox tests cannot start a sandbox inside the gate's";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** Makes a temporary directory holding `files`, removed when the tests finish. */
function scratch(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "gates-test-"));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

/** A secret in the real temp directory, like run-issue.sh's API key file. */
function secret(): { dir: string; file: string } {
  const dir = scratch({ key: "sk-not-a-real-key" });
  return { dir, file: join(dir, "key") };
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

test("an agent stopping to ask a question is let through without running the checks", () => {
  const dir = scratch();
  const run = scratch({ "base-package.json": JSON.stringify({ scripts: { test: "exit 1" } }) });
  const config: GateConfig = { checkout: dir, package_json: join(run, "base-package.json"), log: join(run, "gates.jsonl"), deny_read: [] };
  writeFileSync(join(run, "gate.json"), JSON.stringify(config));
  const input = JSON.stringify({ hook_event_name: "Stop", last_assistant_message: "QUESTION: Zero words, or an error?" });
  // tsx's loader rather than its CLI, whose IPC socket the gate's sandbox denies: this test also runs inside the gate.
  const hook = spawnSync(process.execPath, ["--import", "tsx", "platform/gates/stop-hook.ts", join(run, "gate.json")], {
    cwd: ROOT,
    encoding: "utf8",
    input,
  });
  assert.equal(hook.status, 0, hook.stderr);
  assert.equal(existsSync(config.log), false);
});

test("checks are the typecheck, lint and test scripts of the copied package.json, in that order", () => {
  const dir = scratch({ "package.json": JSON.stringify({ scripts: { test: "node --test", lint: "biome lint", build: "tsc" } }) });
  assert.deepEqual(baseChecks(join(dir, "package.json")), [
    { name: "lint", script: "biome lint" },
    { name: "test", script: "node --test" },
  ]);
});

test("no package.json means no checks, but an unreadable one fails closed", () => {
  const dir = scratch({ "package.json": "﻿{}" });
  assert.deepEqual(baseChecks(join(dir, "missing.json")), []);
  assert.throws(() => baseChecks(join(dir, "package.json")), SyntaxError);
});

test("checks run in the sandbox: the checkout is writable; home, denied paths, network and host sockets are not", { skip: NO_SANDBOX }, async () => {
  const key = secret();
  const dir = scratch();
  // A Unix socket on the host, standing in for Docker's or an agent's. The kernel completes a connection to a
  // listening socket even while spawnSync blocks this process, so the probe needs no accept loop.
  const socketPath = join(scratch(), "host.sock");
  const server = createServer().listen(socketPath);
  await once(server, "listening");
  const probe = `node -e "require('node:net').connect(process.argv[1]).on('connect', () => process.exit(0)).on('error', (e) => { console.log(e.code); process.exit(1); })" ${JSON.stringify(socketPath)}`;
  const unsandboxed = spawnSync("sh", ["-c", probe], { encoding: "utf8" });
  const [inside, home, keyRead, network, socket] = runChecks(
    dir,
    [
      { name: "inside", script: "touch written-by-check && node -e 0" },
      { name: "home", script: `ls ${JSON.stringify(homedir())}` },
      { name: "key", script: `cat ${JSON.stringify(key.file)}` },
      { name: "network", script: "curl -sS -m 5 https://example.com" },
      { name: "socket", script: probe },
    ],
    [homedir(), key.dir],
  );
  server.close();
  assert.equal(unsandboxed.status, 0, `the probe should reach the socket outside the sandbox: ${unsandboxed.stdout}`);
  assert.equal(socket.ok, false);
  assert.match(socket.output, /EPERM/);
  assert.equal(inside.ok, true, inside.output);
  assert.ok(existsSync(join(dir, "written-by-check")));
  assert.equal(home.ok, false);
  assert.match(home.output, /Operation not permitted/);
  assert.equal(keyRead.ok, false);
  assert.doesNotMatch(keyRead.output, /sk-not-a-real-key/);
  assert.equal(network.ok, false);
  assert.match(network.output, /CONNECT tunnel failed, response 403/);
});

test("a node planted in the checkout's node_modules/.bin runs inside the sandbox", { skip: NO_SANDBOX }, () => {
  const outside = scratch();
  const dir = scratch({
    "node_modules/.bin/node": `#!/bin/sh\necho ran > planted-ran\ntouch ${JSON.stringify(join(outside, "escaped"))}\nexec ${JSON.stringify(process.execPath)} "$@"\n`,
  });
  chmodSync(join(dir, "node_modules/.bin/node"), 0o755);
  const [check] = runChecks(dir, [{ name: "test", script: "node -e 0" }], [homedir()]);
  assert.equal(check.ok, true, check.output);
  assert.ok(existsSync(join(dir, "planted-ran")), "the planted node should have run");
  assert.equal(existsSync(join(outside, "escaped")), false, "the planted node ran outside the sandbox");
});

test("the stop hook, started as Claude Code starts it, blocks a broken checkout without leaking the key", { skip: NO_SANDBOX }, () => {
  const key = secret();
  const dir = scratch({
    "add.test.mjs": "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('adds', () => assert.equal(1 + 1, 3));\n",
  });
  const run = scratch({ "base-package.json": JSON.stringify({ scripts: { test: `cat ${JSON.stringify(key.file)}; node --test` } }) });
  const config: GateConfig = {
    checkout: dir,
    package_json: join(run, "base-package.json"),
    log: join(run, "gates.jsonl"),
    deny_read: [homedir(), key.dir],
  };
  writeFileSync(join(run, "gate.json"), JSON.stringify(config));
  // run-issue.sh starts claude with only PATH and HOME, and the hook inherits that: no TMPDIR, no NODE_TEST_CONTEXT.
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  const hook = () =>
    spawnSync("node_modules/.bin/tsx", ["platform/gates/stop-hook.ts", join(run, "gate.json")], { cwd: ROOT, encoding: "utf8", env });

  const blocked = hook();
  assert.equal(blocked.status, 2, blocked.stderr);
  assert.match(blocked.stderr, /^Quality gate: test failed/);
  assert.match(blocked.stderr, /not ok 1 - adds/);
  assert.doesNotMatch(blocked.stderr, /sk-not-a-real-key/);

  writeFileSync(join(dir, "add.test.mjs"), readFileSync(join(dir, "add.test.mjs"), "utf8").replace("3", "2"));
  const fixed = hook();
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.deepEqual(
    readFileSync(config.log, "utf8").trim().split("\n").map((line) => JSON.parse(line).passed),
    [false, true],
  );
});
