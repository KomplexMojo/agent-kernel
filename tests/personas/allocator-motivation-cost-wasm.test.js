const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const bindingsModule = moduleUrl("packages/bindings-ts/src/index.js");
const policyModule = moduleUrl("packages/runtime/src/personas/allocator/motivation-price-policy.js");
const wasmUrl = moduleUrl("build/core-as.wasm");
const WASM_PATH = resolve(__dirname, "../../build/core-as.wasm");

const script = `
import assert from "node:assert/strict";
import { loadCore } from ${JSON.stringify(bindingsModule)};
import {
  calculateMotivationStackCost,
  calculateMotivationStackCostFromCore,
  MOTIVATION_KIND_TO_CODE,
  DEFAULT_MOTIVATION_COSTS,
} from ${JSON.stringify(policyModule)};

const wasmUrl = new URL(${JSON.stringify(wasmUrl)});
const core = await loadCore({ wasmUrl });
core.init(0);

// ── MOTIVATION_KIND_TO_CODE covers all 12 kinds ──

assert.equal(Object.keys(MOTIVATION_KIND_TO_CODE).length, 12, "12 kind codes");
assert.equal(MOTIVATION_KIND_TO_CODE.random, 1);
assert.equal(MOTIVATION_KIND_TO_CODE.attacking, 5);
assert.equal(MOTIVATION_KIND_TO_CODE.user_controlled, 12);

// ── Single motivation: WASM matches JS ──

{
  const motivations = [{ kind: "reflexive", intensity: 1 }];
  const jsResult = calculateMotivationStackCost(motivations);
  const wasmResult = calculateMotivationStackCostFromCore(core, motivations);
  assert.equal(wasmResult.cost, jsResult.cost, "reflexive: WASM cost == JS cost");
  assert.equal(wasmResult.cost, 25, "reflexive = 25 tokens");
  assert.equal(wasmResult.lineItems.length, 1, "one line item");
  assert.equal(wasmResult.lineItems[0].motivationKind, "reflexive");
  assert.equal(wasmResult.lineItems[0].category, "motivation");
  assert.equal(wasmResult.lineItems[0].quantity, 1);
  assert.equal(wasmResult.lineItems[0].unitCostTokens, 25);
  assert.equal(wasmResult.lineItems[0].spendTokens, 25);
}

// ── Multiple motivations: additive ──

{
  const motivations = [
    { kind: "random", intensity: 1 },
    { kind: "attacking", intensity: 1 },
    { kind: "goal_oriented", intensity: 1 },
  ];
  const jsResult = calculateMotivationStackCost(motivations);
  const wasmResult = calculateMotivationStackCostFromCore(core, motivations);
  // random(25) + attacking(25) + goal_oriented(50) = 100
  assert.equal(wasmResult.cost, 100, "multi-motivation total = 100");
  assert.equal(wasmResult.cost, jsResult.cost, "WASM == JS for multi-motivation");
  assert.equal(wasmResult.lineItems.length, 3, "three line items");
}

// ── Intensity multiplier ──

{
  const motivations = [{ kind: "strategy_focused", intensity: 2 }];
  const jsResult = calculateMotivationStackCost(motivations);
  const wasmResult = calculateMotivationStackCostFromCore(core, motivations);
  // strategy_focused(50) * intensity(2) = 100
  assert.equal(wasmResult.cost, 100, "intensity multiplier");
  assert.equal(wasmResult.cost, jsResult.cost, "WASM == JS with intensity");
  assert.equal(wasmResult.lineItems[0].quantity, 2);
}

// ── String shorthand motivations (WASM supports, JS does not) ──

{
  const motivations = ["reflexive", "attacking"];
  const wasmResult = calculateMotivationStackCostFromCore(core, motivations);
  // reflexive(25) + attacking(25) = 50
  assert.equal(wasmResult.cost, 50, "string shorthand total = 50");
  assert.equal(wasmResult.lineItems.length, 2, "two line items from strings");
  assert.equal(wasmResult.lineItems[0].motivationKind, "reflexive");
  assert.equal(wasmResult.lineItems[1].motivationKind, "attacking");
}

// ── Empty motivations ──

{
  const wasmResult = calculateMotivationStackCostFromCore(core, []);
  assert.equal(wasmResult.cost, 0, "empty = 0");
  assert.equal(wasmResult.lineItems.length, 0, "empty line items");
}

// ── No core (graceful fallback) ──

{
  const wasmResult = calculateMotivationStackCostFromCore(null, ["reflexive"]);
  assert.equal(wasmResult.cost, 0, "null core = 0");
}

// ── All 12 kinds: WASM matches JS defaults ──

{
  for (const [kindName, defaultCost] of Object.entries(DEFAULT_MOTIVATION_COSTS)) {
    const motivations = [{ kind: kindName, intensity: 1 }];
    const jsResult = calculateMotivationStackCost(motivations);
    const wasmResult = calculateMotivationStackCostFromCore(core, motivations);
    assert.equal(
      wasmResult.cost, jsResult.cost,
      kindName + ": WASM (" + wasmResult.cost + ") != JS (" + jsResult.cost + ")"
    );
  }
}

// ── Line item shape matches JS ──

{
  const motivations = [{ kind: "attacking", intensity: 3 }];
  const wasmResult = calculateMotivationStackCostFromCore(core, motivations);
  const line = wasmResult.lineItems[0];
  assert.equal(line.category, "motivation");
  assert.equal(line.id, "motivation_attacking");
  assert.equal(line.motivationKind, "attacking");
  assert.equal(line.family, "posture");
  assert.equal(line.label, "motivation:attacking");
  assert.equal(line.quantity, 3);
  assert.ok(line.unitCostTokens > 0);
  assert.equal(line.spendTokens, line.quantity * line.unitCostTokens);
}

console.log("allocator-motivation-cost-wasm: all assertions passed");
`;

test("motivation cost delegation: WASM matches JS for all kinds and intensities", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip("WASM not built.");
    return;
  }
  const result = runEsm(script);
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    const stdout = result.stdout?.toString() ?? "";
    throw new Error(`ESM script failed (exit ${result.status}):\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
});

// ## TODO: Test Permutations
// - [ ] All 12 motivation kinds with intensity 1: verify WASM == JS default cost
// - [ ] All 12 kinds with intensity 10 (max): verify WASM == JS
// - [ ] Mixed string + object motivations: verify WASM == JS
// - [ ] Duplicate kinds: verify each counted separately
// - [ ] Invalid kind names: verify skipped in WASM and JS
// - [ ] Sequential calls: verify accumulator resets correctly
// - [ ] Control tier (user_controlled): verify cost = 10
// - [ ] calculateMotivationStackCostFromCore with priceMap is not supported: document gap
