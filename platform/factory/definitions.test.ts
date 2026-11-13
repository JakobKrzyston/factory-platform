/** Checks the factories in this repository, whichever they are, with the validator CI runs (TL-20), so the stop
 *  hook's tests refuse a broken factory too. The platform's own tests use factories of their own (TL-18).
 *  Run: pnpm test */
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { FACTORIES_DIR, readFactories } from "./factory";
import { validateFactory } from "./validate";

for (const factory of readFactories()) {
  test(`factory ${factory.name}: pnpm validate-factory finds no problems`, () => {
    assert.deepEqual(validateFactory(join(FACTORIES_DIR, factory.name)), []);
  });
}
