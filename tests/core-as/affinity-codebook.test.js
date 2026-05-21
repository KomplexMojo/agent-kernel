const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

if (!existsSync(WASM_PATH)) {
  test.skip("WASM not built — skipping affinity codebook tests", () => {});
} else {
  // ── Kind count ──
  test("getAffinityKindCount returns 10", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.getAffinityKindCount(), 10);
  });

  // ── Expression count ──
  test("getAffinityExpressionCount returns 4", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.getAffinityExpressionCount(), 4);
  });

  // ── Target type count ──
  test("getAffinityTargetTypeCount returns 6", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.getAffinityTargetTypeCount(), 6);
  });

  // ── Kind codes are 1-based and match runtime order ──
  test("affinity kind codes match runtime AFFINITY_KINDS order (1-based)", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { AFFINITY_KINDS } = await import("../../packages/runtime/src/contracts/domain-constants.js");
    assert.equal(AFFINITY_KINDS.length, 10);
    // Core uses 1-based codes: fire=1 .. dark=10
    for (let i = 0; i < AFFINITY_KINDS.length; i++) {
      const code = i + 1;
      const opposite = core.getOppositeAffinityKind(code);
      assert.ok(opposite >= 1 && opposite <= 10, `opposite of kind ${code} should be 1..10, got ${opposite}`);
    }
  });

  // ── Opposite pairs match runtime AFFINITY_OPPOSITES ──
  test("opposite pairs match runtime AFFINITY_OPPOSITES", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { AFFINITY_KINDS, AFFINITY_OPPOSITES } = await import(
      "../../packages/runtime/src/contracts/domain-constants.js"
    );
    for (let i = 0; i < AFFINITY_KINDS.length; i++) {
      const kindCode = i + 1;
      const kindName = AFFINITY_KINDS[i];
      const expectedOppositeName = AFFINITY_OPPOSITES[kindName];
      const expectedOppositeCode = AFFINITY_KINDS.indexOf(expectedOppositeName) + 1;
      assert.equal(
        core.getOppositeAffinityKind(kindCode),
        expectedOppositeCode,
        `opposite of ${kindName} (${kindCode}) should be ${expectedOppositeName} (${expectedOppositeCode})`,
      );
    }
  });

  // ── Invalid kind returns 0 ──
  test("getOppositeAffinityKind returns 0 for invalid kind", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.getOppositeAffinityKind(0), 0);
    assert.equal(core.getOppositeAffinityKind(-1), 0);
    assert.equal(core.getOppositeAffinityKind(11), 0);
    assert.equal(core.getOppositeAffinityKind(999), 0);
  });

  // ── Relationship codes ──
  test("resolveAffinityRelationshipCode returns correct codes", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    // Same kind = 0
    assert.equal(core.resolveAffinityRelationshipCode(1, 1), 0, "fire vs fire = same");
    // Opposite = 1 (fire=1 vs water=2)
    assert.equal(core.resolveAffinityRelationshipCode(1, 2), 1, "fire vs water = opposite");
    assert.equal(core.resolveAffinityRelationshipCode(2, 1), 1, "water vs fire = opposite");
    // Neutral = 2 (fire=1 vs earth=3)
    assert.equal(core.resolveAffinityRelationshipCode(1, 3), 2, "fire vs earth = neutral");
  });

  test("resolveAffinityRelationshipCode returns -1 for invalid kinds", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.resolveAffinityRelationshipCode(0, 1), -1);
    assert.equal(core.resolveAffinityRelationshipCode(1, 0), -1);
    assert.equal(core.resolveAffinityRelationshipCode(11, 1), -1);
  });

  // ── Vital target mapping matches runtime VITAL_TARGET_BY_AFFINITY ──
  test("getAffinityTargetVital matches runtime vital mapping", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { AFFINITY_KINDS } = await import("../../packages/runtime/src/contracts/domain-constants.js");
    const targetEffects = await import(
      "../../packages/runtime/src/personas/moderator/affinity-target-effects.js"
    );
    const vitalKindMap = { health: 0, mana: 1, stamina: 2, durability: 3 };
    const vitalTarget = targetEffects.AFFINITY_VITAL_TARGETS || targetEffects.VITAL_TARGET_BY_AFFINITY;

    for (let i = 0; i < AFFINITY_KINDS.length; i++) {
      const code = i + 1;
      const name = AFFINITY_KINDS[i];
      const expectedVitalName = vitalTarget[name];
      const expectedVitalCode = vitalKindMap[expectedVitalName];
      assert.equal(
        core.getAffinityTargetVital(code),
        expectedVitalCode,
        `vital target of ${name} (${code}) should be ${expectedVitalName} (${expectedVitalCode})`,
      );
    }
  });

  test("getAffinityTargetVital returns -1 for invalid kind", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.getAffinityTargetVital(0), -1);
    assert.equal(core.getAffinityTargetVital(11), -1);
  });

  // ── Default target type by expression ──
  test("getDefaultAffinityTargetType matches runtime defaults", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { AFFINITY_EXPRESSIONS, DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION } = await import(
      "../../packages/runtime/src/contracts/domain-constants.js"
    );
    const targetTypeMap = { self: 0, ally: 1, enemy: 2, area: 3, barrier: 4, floor: 5 };

    for (let i = 0; i < AFFINITY_EXPRESSIONS.length; i++) {
      const exprCode = i + 1;
      const exprName = AFFINITY_EXPRESSIONS[i];
      const expectedTargetName = DEFAULT_AFFINITY_TARGET_TYPE_BY_EXPRESSION[exprName];
      const expectedCode = targetTypeMap[expectedTargetName];
      assert.equal(
        core.getDefaultAffinityTargetType(exprCode),
        expectedCode,
        `default target for ${exprName} (${exprCode}) should be ${expectedTargetName} (${expectedCode})`,
      );
    }
  });

  test("getDefaultAffinityTargetType returns -1 for invalid expression", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.getDefaultAffinityTargetType(0), -1);
    assert.equal(core.getDefaultAffinityTargetType(5), -1);
  });

  // ── Expression profile flags ──
  test("affinityExpressionAllowsEnvironmentMutation matches runtime profiles", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { AFFINITY_EXPRESSIONS, AFFINITY_EXPRESSION_PROFILES } = await import(
      "../../packages/runtime/src/contracts/domain-constants.js"
    );
    for (let i = 0; i < AFFINITY_EXPRESSIONS.length; i++) {
      const code = i + 1;
      const name = AFFINITY_EXPRESSIONS[i];
      const expected = AFFINITY_EXPRESSION_PROFILES[name].allowsEnvironmentMutation ? 1 : 0;
      assert.equal(
        core.affinityExpressionAllowsEnvironmentMutation(code),
        expected,
        `${name} allowsEnvironmentMutation`,
      );
    }
  });

  test("affinityExpressionAllowsTrapArming matches runtime profiles", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { AFFINITY_EXPRESSIONS, AFFINITY_EXPRESSION_PROFILES } = await import(
      "../../packages/runtime/src/contracts/domain-constants.js"
    );
    for (let i = 0; i < AFFINITY_EXPRESSIONS.length; i++) {
      const code = i + 1;
      const name = AFFINITY_EXPRESSIONS[i];
      const expected = AFFINITY_EXPRESSION_PROFILES[name].allowsTrapArming ? 1 : 0;
      assert.equal(
        core.affinityExpressionAllowsTrapArming(code),
        expected,
        `${name} allowsTrapArming`,
      );
    }
  });

  test("affinityExpressionIsPersistentField distinguishes field vs spatial channels", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    // emit and draw are field/persistent; push and pull are spatial/instantaneous
    assert.equal(core.affinityExpressionIsPersistentField(1), 0, "push = spatial");
    assert.equal(core.affinityExpressionIsPersistentField(2), 0, "pull = spatial");
    assert.equal(core.affinityExpressionIsPersistentField(3), 1, "emit = field/persistent");
    assert.equal(core.affinityExpressionIsPersistentField(4), 1, "draw = field/persistent");
  });

  test("expression profile flags return 0 for invalid expression codes", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.affinityExpressionAllowsEnvironmentMutation(0), 0);
    assert.equal(core.affinityExpressionAllowsTrapArming(0), 0);
    assert.equal(core.affinityExpressionIsPersistentField(0), 0);
    assert.equal(core.affinityExpressionAllowsEnvironmentMutation(5), 0);
  });

  // ── Existing static trap compatibility ──
  test("static trap API still accepts valid affinity kind codes", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    core.init(42);
    core.configureGrid(10, 10);
    core.setTileAt(3, 3, 1); // floor tile
    // earth = kind 3, emit = expression 3, stacks = 1, mana = 5
    const result = core.armStaticTrapAt(3, 3, 3, 3, 1, 5);
    assert.equal(result, 1, "armStaticTrapAt should accept kind=3 (earth)");
    assert.equal(core.getStaticTrapAffinityAt(3, 3), 3);
    assert.equal(core.getStaticTrapExpressionAt(3, 3), 3);
  });
}

// ## TODO: Test Permutations
// - [ ] Exhaustive opposite pair symmetry: for all 10 kinds, opposite(opposite(k)) == k
// - [ ] All 5 explicit opposite pairs produce relationship code 1 in both directions
// - [ ] All neutral pairs (non-same, non-opposite) produce relationship code 2
// - [ ] Boundary: kind codes 1 and 10 behave correctly (no off-by-one)
// - [ ] Expression flag combinations: verify all 4 expressions have correct {envMutation, trapArming, persistent} triple
// - [ ] Vital target coverage: each of the 4 vital kinds is targeted by at least one affinity kind
