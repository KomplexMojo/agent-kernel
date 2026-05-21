const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

if (!existsSync(WASM_PATH)) {
  test.skip("WASM not built — skipping motivation cost tests", () => {});
} else {
  // ── Intensity normalization ──

  test("normalizeMotivationIntensity clamps to [1, 10]", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    // Below minimum → 1
    assert.equal(core.normalizeMotivationIntensity(0), 1, "zero → 1");
    assert.equal(core.normalizeMotivationIntensity(-5), 1, "negative → 1");

    // Valid range
    assert.equal(core.normalizeMotivationIntensity(1), 1, "min");
    assert.equal(core.normalizeMotivationIntensity(5), 5, "mid");
    assert.equal(core.normalizeMotivationIntensity(10), 10, "max");

    // Above maximum → 10
    assert.equal(core.normalizeMotivationIntensity(11), 10, "11 → 10");
    assert.equal(core.normalizeMotivationIntensity(100), 10, "100 → 10");
  });

  // ── Tier classification ──

  test("getMotivationTier matches JS MOTIVATION_TIER", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { MOTIVATION_TIER } = await import("../../packages/runtime/src/personas/allocator/motivation-price-policy.js");

    const TIER_SIMPLE = 0, TIER_ADVANCED = 1, TIER_CONTROL = 2;
    const tierMap = { simple: TIER_SIMPLE, advanced: TIER_ADVANCED, control: TIER_CONTROL };

    // 1-based kind codes matching MOTIVATION_KINDS order from motivation-loadouts.js
    const kindNames = [
      "random", "stationary", "exploring", "patrolling",
      "attacking", "defending", "stealthy", "friendly",
      "reflexive", "goal_oriented", "strategy_focused", "user_controlled",
    ];

    for (let code = 1; code <= 12; code++) {
      const name = kindNames[code - 1];
      const jsTier = MOTIVATION_TIER[name];
      const expectedCode = tierMap[jsTier];
      assert.equal(core.getMotivationTier(code), expectedCode,
        `tier(${name}/${code}) = ${jsTier}/${expectedCode}`);
    }

    // Invalid kind → -1
    assert.equal(core.getMotivationTier(0), -1, "kind 0 invalid");
    assert.equal(core.getMotivationTier(13), -1, "kind 13 invalid");
  });

  // ── Default unit cost ──

  test("getMotivationDefaultUnitCost matches JS DEFAULT_MOTIVATION_COSTS", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { DEFAULT_MOTIVATION_COSTS } = await import("../../packages/runtime/src/personas/allocator/motivation-price-policy.js");

    const kindNames = [
      "random", "stationary", "exploring", "patrolling",
      "attacking", "defending", "stealthy", "friendly",
      "reflexive", "goal_oriented", "strategy_focused", "user_controlled",
    ];

    for (let code = 1; code <= 12; code++) {
      const name = kindNames[code - 1];
      const jsCost = DEFAULT_MOTIVATION_COSTS[name];
      assert.equal(core.getMotivationDefaultUnitCost(code), jsCost,
        `cost(${name}/${code}) = ${jsCost}`);
    }

    // Invalid kind → 0
    assert.equal(core.getMotivationDefaultUnitCost(0), 0, "invalid kind 0");
    assert.equal(core.getMotivationDefaultUnitCost(13), 0, "invalid kind 13");
  });

  // ── Cost accumulator: empty ──

  test("cost accumulator starts empty", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    core.resetMotivationCostAccumulator();
    assert.equal(core.getMotivationCostTotal(), 0, "total = 0");
    assert.equal(core.getMotivationCostLineCount(), 0, "line count = 0");
  });

  // ── Cost accumulator: single entry ──

  test("addMotivationCostEntry: single reflexive intensity=1", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    core.resetMotivationCostAccumulator();
    const result = core.addMotivationCostEntry(9, 1); // reflexive=9, intensity=1
    assert.equal(result, 1, "returns 1 on success");
    assert.equal(core.getMotivationCostTotal(), 25, "reflexive=25");
    assert.equal(core.getMotivationCostLineCount(), 1, "1 line item");

    // Line item details
    assert.equal(core.getMotivationCostLineKind(0), 9, "kind = reflexive");
    assert.equal(core.getMotivationCostLineFamily(0), 2, "family = cognition");
    assert.equal(core.getMotivationCostLineQuantity(0), 1, "quantity = 1");
    assert.equal(core.getMotivationCostLineUnitCost(0), 25, "unitCost = 25");
    assert.equal(core.getMotivationCostLineSpend(0), 25, "spend = 25");
  });

  // ── Cost accumulator: intensity scales cost ──

  test("addMotivationCostEntry: goal_oriented intensity=3 costs 150", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    core.resetMotivationCostAccumulator();
    core.addMotivationCostEntry(10, 3); // goal_oriented=10, intensity=3
    assert.equal(core.getMotivationCostTotal(), 150, "50 * 3 = 150");
    assert.equal(core.getMotivationCostLineQuantity(0), 3, "quantity = 3");
    assert.equal(core.getMotivationCostLineUnitCost(0), 50, "unitCost = 50");
    assert.equal(core.getMotivationCostLineSpend(0), 150, "spend = 150");
  });

  // ── Cost accumulator: additive multi-entry ──

  test("cost accumulator is additive: attacking:3 + reflexive:1 = 100", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    core.resetMotivationCostAccumulator();
    core.addMotivationCostEntry(5, 3); // attacking=5, intensity=3 → 25*3 = 75
    core.addMotivationCostEntry(9, 1); // reflexive=9, intensity=1 → 25*1 = 25
    assert.equal(core.getMotivationCostTotal(), 100, "75 + 25 = 100");
    assert.equal(core.getMotivationCostLineCount(), 2, "2 line items");

    // Verify each line
    assert.equal(core.getMotivationCostLineKind(0), 5, "line 0 kind = attacking");
    assert.equal(core.getMotivationCostLineSpend(0), 75, "line 0 spend = 75");
    assert.equal(core.getMotivationCostLineKind(1), 9, "line 1 kind = reflexive");
    assert.equal(core.getMotivationCostLineSpend(1), 25, "line 1 spend = 25");
  });

  // ── Cost accumulator: matches JS calculateMotivationStackCost ──

  test("cost accumulator matches JS: patrolling:2 + stealthy:1 + strategy_focused:1 = 150", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    core.resetMotivationCostAccumulator();
    core.addMotivationCostEntry(4, 2);  // patrolling=4, intensity=2 → 25*2 = 50
    core.addMotivationCostEntry(7, 1);  // stealthy=7, intensity=1 → 50*1 = 50
    core.addMotivationCostEntry(11, 1); // strategy_focused=11, intensity=1 → 50*1 = 50
    assert.equal(core.getMotivationCostTotal(), 150, "50 + 50 + 50 = 150");
    assert.equal(core.getMotivationCostLineCount(), 3, "3 line items");
  });

  // ── Cost accumulator: user_controlled costs 10 ──

  test("user_controlled costs 10 tokens", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    core.resetMotivationCostAccumulator();
    core.addMotivationCostEntry(12, 1); // user_controlled=12, intensity=1
    assert.equal(core.getMotivationCostTotal(), 10, "control tier = 10");
    assert.equal(core.getMotivationCostLineUnitCost(0), 10, "unitCost = 10");
  });

  // ── Cost accumulator: intensity auto-normalizes ──

  test("addMotivationCostEntry normalizes intensity to [1, 10]", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    // Zero intensity → normalized to 1
    core.resetMotivationCostAccumulator();
    core.addMotivationCostEntry(1, 0); // random=1, raw intensity=0 → normalized to 1
    assert.equal(core.getMotivationCostTotal(), 25, "25 * 1");
    assert.equal(core.getMotivationCostLineQuantity(0), 1, "normalized to 1");

    // Intensity > 10 → clamped to 10
    core.resetMotivationCostAccumulator();
    core.addMotivationCostEntry(1, 15); // random=1, raw intensity=15 → clamped to 10
    assert.equal(core.getMotivationCostTotal(), 250, "25 * 10");
    assert.equal(core.getMotivationCostLineQuantity(0), 10, "clamped to 10");
  });

  // ── Cost accumulator: invalid kind returns 0 ──

  test("addMotivationCostEntry rejects invalid kind", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    core.resetMotivationCostAccumulator();
    const result = core.addMotivationCostEntry(0, 1); // invalid kind
    assert.equal(result, 0, "returns 0 for invalid");
    assert.equal(core.getMotivationCostTotal(), 0, "no cost added");
    assert.equal(core.getMotivationCostLineCount(), 0, "no line added");
  });

  // ── Cost accumulator: line getters return 0 for out-of-bounds index ──

  test("cost line getters return 0 for out-of-bounds index", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    core.resetMotivationCostAccumulator();
    assert.equal(core.getMotivationCostLineKind(-1), 0, "negative index");
    assert.equal(core.getMotivationCostLineKind(0), 0, "empty list index 0");
    assert.equal(core.getMotivationCostLineFamily(0), -1, "empty list family");
    assert.equal(core.getMotivationCostLineQuantity(0), 0, "empty list quantity");
    assert.equal(core.getMotivationCostLineUnitCost(0), 0, "empty list unitCost");
    assert.equal(core.getMotivationCostLineSpend(0), 0, "empty list spend");
  });

  // ── Reset clears previous accumulation ──

  test("resetMotivationCostAccumulator clears previous state", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);

    core.resetMotivationCostAccumulator();
    core.addMotivationCostEntry(5, 2); // attacking:2 → 50
    assert.equal(core.getMotivationCostTotal(), 50);

    core.resetMotivationCostAccumulator();
    assert.equal(core.getMotivationCostTotal(), 0, "cleared");
    assert.equal(core.getMotivationCostLineCount(), 0, "cleared lines");
  });
}

// ## TODO: Test Permutations
// - [ ] All 12 motivation kinds: verify tier classification and default cost for each
// - [ ] Intensity normalization: boundary values 0, 1, 10, 11, -1, MAX_INT
// - [ ] Cost accumulator with all 12 kinds at intensity=1: total = sum of all default costs
// - [ ] Cost accumulator overflow: 12 entries (max capacity), verify all line items readable
// - [ ] Cost accumulator: attempt 13th entry beyond capacity, verify no crash
// - [ ] Tier codes: simple=0, advanced=1, control=2 — verify for every kind
// - [ ] Family lookup in line items: mobility=0, posture=1, cognition=2, control=3
// - [ ] Cross-parity: JS calculateMotivationStackCost vs WASM accumulator for 10 representative stacks
