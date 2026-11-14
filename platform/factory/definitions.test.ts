/** Checks the factories in this repository, whichever they are, with the validator CI runs (TL-20), so the stop
 *  hook's tests refuse a broken factory too. The platform's own tests use factories of their own (TL-18).
 *  Run: pnpm test */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { FACTORIES_DIR, readFactories, route } from "./factory";
import { validateFactory } from "./validate";

for (const factory of readFactories()) {
  test(`factory ${factory.name}: pnpm validate-factory finds no problems`, () => {
    assert.deepEqual(validateFactory(join(FACTORIES_DIR, factory.name)), []);
  });
}

// The validator reads one factory at a time, so it passes a label that two factories on one repository share. The
// workflow's route job would then fail on that label, stopping both factories' chains there (TL-19).
test("every trigger label starts only its own factory on each repository that factory serves", () => {
  const factories = readFactories();
  for (const factory of factories) {
    for (const repo of factory.repositories) {
      for (const trigger of factory.triggers) {
        assert.equal(route(factories, repo, trigger.label)?.factory.name, factory.name);
      }
    }
  }
});
