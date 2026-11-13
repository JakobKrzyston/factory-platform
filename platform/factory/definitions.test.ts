/** Checks the factories in this repository, whichever they are: each reads, each agent.md parses, and each holds
 *  only definitions. The platform's own tests use factories of their own (TL-18). Run: pnpm test */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";

import { parseAgent } from "../agents/agent";
import { FACTORIES_DIR, readFactories } from "./factory";

for (const factory of readFactories()) {
  const dir = join(FACTORIES_DIR, factory.name);

  test(`factory ${factory.name}: every agent's definition parses, and a pull-request agent has the skill its gate checks`, () => {
    for (const agent of factory.agents) {
      const { contract } = parseAgent(readFileSync(join(dir, "agents", agent, "agent.md"), "utf8"));
      // run-issue.sh appends it to a pull-request agent's prompt; a missing one would leave that part empty.
      if (contract === "pull-request") assert.ok(existsSync(join(dir, "skills/pr-description/SKILL.md")), `${agent} needs skills/pr-description/`);
    }
  });

  // Rule 5: the queue, the run log and the gates are the platform's, so a factory has no code to run.
  test(`factory ${factory.name}: holds only Markdown and YAML, so no code`, () => {
    const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => !entry.isDirectory());
    const code = files.map((entry) => join(entry.parentPath, entry.name)).filter((path) => ![".md", ".yaml"].includes(extname(path)));
    assert.deepEqual(code, []);
  });
}
