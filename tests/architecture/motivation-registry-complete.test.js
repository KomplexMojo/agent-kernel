/**
 * Every core motivation kind has exactly one Actor module, and vice versa.
 *
 * A kind without a module silently behaves like the fallback — the defect that
 * let `patrolling` walk to the exit for months. A module without a kind is dead code.
 */
"use strict";

const assert = require("node:assert/strict");

test("every core motivation kind has exactly one module, and vice versa", async () => {
  const { MOTIVATION_KIND_BY_CODE } = await import("../../packages/core-ts/src/index.ts");
  const { MOTIVATION_MODULES } = await import(
    "../../packages/runtime/src/personas/actor/motivations/index.js"
  );
  const coreKinds = Object.entries(MOTIVATION_KIND_BY_CODE)
    .filter(([code]) => Number(code) > 0)
    .map(([, name]) => name)
    .sort();
  assert.deepEqual(
    Object.keys(MOTIVATION_MODULES).sort(),
    coreKinds,
    "a kind without a module silently behaves like whatever the fallback is — the defect "
      + "that let `patrolling` walk to the exit for months. A module without a kind is dead code.",
  );
});

test("every module declares its own kind and a propose function", async () => {
  const { MOTIVATION_MODULES } = await import(
    "../../packages/runtime/src/personas/actor/motivations/index.js"
  );
  for (const [key, mod] of Object.entries(MOTIVATION_MODULES)) {
    assert.equal(mod.kind, key, `module registered as ${key} declares kind ${mod.kind}`);
    assert.equal(typeof mod.propose, "function", `${key} has no propose()`);
  }
});
