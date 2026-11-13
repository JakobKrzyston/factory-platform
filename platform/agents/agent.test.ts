/** Tests the agent.md parser. Run: pnpm test */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAgent } from "./agent";

const VALID = `---
description: A role.
contract: note
model: haiku
tools: Bash, Read
budget_usd: 0.5
time_limit_seconds: 300
---
Do the role.
`;

test("an agent file gives its settings and the prompt after the fence", () => {
  assert.deepEqual(parseAgent(VALID), {
    description: "A role.",
    contract: "note",
    model: "haiku",
    tools: ["Bash", "Read"],
    budget_usd: 0.5,
    time_limit_seconds: 300,
    prompt: "Do the role.",
  });
});

test("changing the model is one line", () => {
  assert.equal(parseAgent(VALID.replace("model: haiku", "model: opus")).model, "opus");
});

test("the contract is one the run script keeps, whatever the agent is called", () => {
  assert.equal(parseAgent(VALID.replace("contract: note", "contract: pull-request")).contract, "pull-request");
  assert.throws(() => parseAgent(VALID.replace("contract: note", "contract: implement")), /contract must be one of note, spec, pull-request, review; got implement/);
  assert.throws(() => parseAgent(VALID.replace("contract: note\n", "")), /missing setting: contract/);
});

test("a tool the run script cannot confine is refused", () => {
  assert.throws(() => parseAgent(VALID.replace("tools: Bash, Read", "tools: Bash, WebFetch")), /WebFetch/);
});

test("an agent without Read is refused", () => {
  assert.throws(() => parseAgent(VALID.replace("tools: Bash, Read", "tools: Bash")), /must include Read/);
});

test("a missing or unknown setting is refused, not defaulted", () => {
  assert.throws(() => parseAgent(VALID.replace("model: haiku\n", "")), /missing setting: model/);
  assert.throws(() => parseAgent(VALID.replace("description: A role.\n", "")), /missing setting: description/);
  assert.throws(() => parseAgent(VALID.replace("model:", "modle:")), /unknown settings: modle/);
});

test("a time limit must be whole seconds and a budget positive", () => {
  assert.throws(() => parseAgent(VALID.replace("time_limit_seconds: 300", "time_limit_seconds: 1.5")), /whole number/);
  assert.throws(() => parseAgent(VALID.replace("budget_usd: 0.5", "budget_usd: 0")), /positive/);
  assert.throws(() => parseAgent(VALID.replace("budget_usd: 0.5", "budget_usd: Infinity")), /positive/);
  assert.throws(() => parseAgent(VALID.replace("budget_usd: 0.5", "budget_usd: 1e400")), /positive/);
});

test("a file without settings fences or without a prompt is refused", () => {
  assert.throws(() => parseAgent("Do the role.\n"), /settings between ---/);
  assert.throws(() => parseAgent(VALID.replace("Do the role.\n", "")), /prompt/);
});
