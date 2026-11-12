/** Tests reading a factory directory: factory.yaml, the triggers and the checks on the chain. Run: pnpm test */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { END, parseSettings, readFactories, readFactory, route } from "./factory";

test("the code factory chains triage, spec, implement and review, and ends with a human", () => {
  const code = readFactories().find((factory) => factory.name === "code");
  assert.ok(code, "factories/code/ is missing");
  assert.equal(code.foreman, "triage");
  assert.deepEqual(code.repositories, ["JakobKrzyston/factory-platform"]);
  const agents: string[] = [];
  let at = "factory:ready";
  for (let trigger = code.triggers.find((t) => t.label === at); trigger; trigger = code.triggers.find((t) => t.label === at)) {
    agents.push(trigger.agent);
    at = trigger.next;
  }
  assert.deepEqual(agents, ["triage", "spec", "implement", "review"]);
  assert.equal(at, END);
});

test("settings are key: value lines, with comments, quoted values and flow lists", () => {
  const settings = parseSettings('# a comment\nforeman: triage\n\ncolor: "5319E7"\nrepositories: [a/b, "c/d"]\n', "f.yaml");
  assert.deepEqual(Object.fromEntries(settings), { foreman: "triage", color: "5319E7", repositories: ["a/b", "c/d"] });
});

test("a line that is not key: value, or a key given twice, is refused", () => {
  assert.throws(() => parseSettings("- triage\n", "f.yaml"), /not a "key: value" line/);
  assert.throws(() => parseSettings("foreman: a\nforeman: b\n", "f.yaml"), /given twice/);
});

/** Writes a factory into a temporary directory and returns its path. */
function write(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "factory-test-"));
  const dir = join(root, "demo");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  test.after(() => rmSync(root, { recursive: true, force: true }));
  return dir;
}

const trigger = (label: string, agent: string, next: string) =>
  `on: label\nlabel: ${label}\nagent: ${agent}\nnext: ${next}\ncolor: "0E8A16"\ndescription: Starts ${agent}.\n`;

/** A two-agent factory, with any file replaced or removed (an empty string removes it). */
function demo(changes: Record<string, string> = {}): Record<string, string> {
  const files: Record<string, string> = {
    "factory.yaml": "repositories: [o/r]\nforeman: plan\n",
    "agents/plan/agent.md": "x",
    "agents/build/agent.md": "x",
    "triggers/go/trigger.yaml": trigger("factory:go", "plan", "factory:build"),
    "triggers/go/comment.md": "Planned: {output}\n",
    "triggers/build/trigger.yaml": trigger("factory:build", "build", END),
    "triggers/build/comment.md": "Built {output}.\n",
    "triggers/build/question.md": "Or add `factory:go`.\n",
    ...changes,
  };
  return Object.fromEntries(Object.entries(files).filter(([, text]) => text !== ""));
}

test("a factory's name is its folder, and its triggers carry their comment and question", () => {
  const factory = readFactory(write(demo()));
  assert.equal(factory.name, "demo");
  assert.deepEqual(factory.agents, ["build", "plan"]);
  assert.deepEqual(
    factory.triggers.map(({ name, label, agent, next, question }) => ({ name, label, agent, next, question })),
    [
      { name: "build", label: "factory:build", agent: "build", next: END, question: "Or add `factory:go`.\n" },
      { name: "go", label: "factory:go", agent: "plan", next: "factory:build", question: null },
    ],
  );
  assert.equal(factory.triggers[1].comment, "Planned: {output}\n");
});

test("a missing or unknown field is refused", () => {
  assert.throws(() => readFactory(write(demo({ "factory.yaml": "repositories: [o/r]\n" }))), /foreman must be a value/);
  assert.throws(() => readFactory(write(demo({ "factory.yaml": "repositories: o/r\nforeman: plan\n" }))), /repositories must be a list/);
  assert.throws(
    () => readFactory(write(demo({ "factory.yaml": "repositories: [o/r]\nforeman: plan\nmodel: opus\n" }))),
    /unknown fields: model/,
  );
  assert.throws(
    () => readFactory(write(demo({ "triggers/go/trigger.yaml": trigger("factory:go", "plan", "factory:build").replace("on: label", "on: schedule") }))),
    /on must be label/,
  );
  assert.throws(() => readFactory(write(demo({ "triggers/go/comment.md": "" }))), /has no comment.md/);
});

test("a trigger label outside the queue's factory: prefix, or a bad colour, is refused", () => {
  assert.throws(() => readFactory(write(demo({ "triggers/go/trigger.yaml": trigger("go", "plan", "factory:build") }))), /must start with factory:/);
  assert.throws(
    () => readFactory(write(demo({ "triggers/go/trigger.yaml": trigger("factory:go", "plan", "factory:build").replace('"0E8A16"', "green") }))),
    /six hex digits/,
  );
});

test("a trigger that calls an agent with no agent.md is refused", () => {
  assert.throws(() => readFactory(write(demo({ "agents/build/agent.md": "" }))), /calls build, which has no agents\/build\/agent.md/);
});

test("a chain that leads nowhere or loops never reaches a human, so it is refused", () => {
  assert.throws(
    () => readFactory(write(demo({ "triggers/build/trigger.yaml": trigger("factory:build", "build", "factory:done") }))),
    /moves to factory:done, which is neither/,
  );
  assert.throws(
    () => readFactory(write(demo({ "triggers/build/trigger.yaml": trigger("factory:build", "build", "factory:go") }))),
    /loops back/,
  );
});

test("two triggers on one label are refused", () => {
  assert.throws(
    () => readFactory(write(demo({ "triggers/again/trigger.yaml": trigger("factory:go", "plan", END), "triggers/again/comment.md": "x" }))),
    /two triggers have the label factory:go/,
  );
});

test("the foreman is the agent of the one trigger no other leads to", () => {
  assert.throws(() => readFactory(write(demo({ "factory.yaml": "repositories: [o/r]\nforeman: build\n" }))), /the foreman is build, but the entry trigger factory:go calls plan/);
  assert.throws(
    () => readFactory(write(demo({ "triggers/other/trigger.yaml": trigger("factory:other", "build", END), "triggers/other/comment.md": "x" }))),
    /exactly one trigger that no other leads to; found 2/,
  );
});

test("a label routes to the trigger of the factory serving that repository", () => {
  const factory = readFactory(write(demo()));
  assert.equal(route([factory], "o/r", "factory:build")?.trigger.agent, "build");
  assert.equal(route([factory], "o/r", "factory:in-progress"), null);
  assert.equal(route([factory], "someone/else", "factory:build"), null);
  assert.throws(() => route([factory, { ...factory, name: "copy" }], "o/r", "factory:go"), /starts demo and copy/);
});
