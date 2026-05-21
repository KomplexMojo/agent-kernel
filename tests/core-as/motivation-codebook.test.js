const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

if (!existsSync(WASM_PATH)) {
  test.skip("WASM not built — skipping motivation codebook tests", () => {});
} else {
  // ── Kind count ──
  test("getMotivationKindCount returns 12", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.getMotivationKindCount(), 12);
  });

  // ── Family membership matches runtime MOTIVATION_FAMILIES ──
  test("getMotivationFamily matches runtime family membership", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { MOTIVATION_FAMILIES, MOTIVATION_KINDS } = await import(
      "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
    );

    // Build expected: kind name -> family name
    const kindToFamily = {};
    for (const [familyName, kinds] of Object.entries(MOTIVATION_FAMILIES)) {
      for (const kind of kinds) {
        kindToFamily[kind] = familyName;
      }
    }

    // Family codes: mobility=0, posture=1, cognition=2, control=3
    const familyCodeMap = { mobility: 0, posture: 1, cognition: 2, control: 3 };

    for (let i = 0; i < MOTIVATION_KINDS.length; i++) {
      const code = i + 1;
      const name = MOTIVATION_KINDS[i];
      const expectedFamily = kindToFamily[name];
      const expectedFamilyCode = familyCodeMap[expectedFamily];
      assert.equal(
        core.getMotivationFamily(code),
        expectedFamilyCode,
        `family of ${name} (${code}) should be ${expectedFamily} (${expectedFamilyCode})`,
      );
    }
  });

  test("getMotivationFamily returns -1 for invalid kind", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.getMotivationFamily(0), -1);
    assert.equal(core.getMotivationFamily(13), -1);
    assert.equal(core.getMotivationFamily(-1), -1);
  });

  // ── Exclusive group ──
  test("getMotivationExclusiveGroup returns correct groups", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    // mobility (kinds 1-4) -> group 0
    assert.equal(core.getMotivationExclusiveGroup(1), 0, "random -> mobility group");
    assert.equal(core.getMotivationExclusiveGroup(4), 0, "patrolling -> mobility group");
    // posture (kinds 5-8) -> group 1
    assert.equal(core.getMotivationExclusiveGroup(5), 1, "attacking -> posture group");
    assert.equal(core.getMotivationExclusiveGroup(8), 1, "friendly -> posture group");
    // cognition (kinds 9-11) -> group 2
    assert.equal(core.getMotivationExclusiveGroup(9), 2, "reflexive -> cognition group");
    assert.equal(core.getMotivationExclusiveGroup(11), 2, "strategy_focused -> cognition group");
    // control (kind 12) -> -1 (no exclusive group, composes freely)
    assert.equal(core.getMotivationExclusiveGroup(12), -1, "user_controlled -> no exclusive group");
  });

  // ── Conflict detection ──
  test("motivationKindsConflict detects same-group conflicts", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    // Two mobility kinds conflict
    assert.equal(core.motivationKindsConflict(1, 2), 1, "random vs stationary = conflict");
    assert.equal(core.motivationKindsConflict(3, 4), 1, "exploring vs patrolling = conflict");
    // Two posture kinds conflict
    assert.equal(core.motivationKindsConflict(5, 6), 1, "attacking vs defending = conflict");
    // Two cognition kinds conflict
    assert.equal(core.motivationKindsConflict(9, 10), 1, "reflexive vs goal_oriented = conflict");
  });

  test("motivationKindsConflict allows cross-group combinations", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    // mobility + posture = ok
    assert.equal(core.motivationKindsConflict(1, 5), 0, "random + attacking = ok");
    // mobility + cognition = ok
    assert.equal(core.motivationKindsConflict(4, 9), 0, "patrolling + reflexive = ok");
    // posture + cognition = ok
    assert.equal(core.motivationKindsConflict(5, 9), 0, "attacking + reflexive = ok");
  });

  test("user_controlled composes freely with all other kinds", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    for (let kind = 1; kind <= 11; kind++) {
      assert.equal(
        core.motivationKindsConflict(12, kind),
        0,
        `user_controlled + kind ${kind} should not conflict`,
      );
    }
  });

  test("same kind does not conflict with itself", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    for (let kind = 1; kind <= 12; kind++) {
      assert.equal(
        core.motivationKindsConflict(kind, kind),
        0,
        `kind ${kind} vs itself should not conflict`,
      );
    }
  });

  test("motivationKindsConflict returns 0 for invalid kinds", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.motivationKindsConflict(0, 1), 0);
    assert.equal(core.motivationKindsConflict(1, 13), 0);
  });

  // ── Pattern metadata ──
  test("getMotivationPatternCount returns correct counts", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    // patrolling (kind 4) has 3 patterns: loop, ping_pong, random_walk
    assert.equal(core.getMotivationPatternCount(4), 3, "patrolling has 3 patterns");
    // attacking (kind 5) has 3 patterns: melee, ranged, mixed
    assert.equal(core.getMotivationPatternCount(5), 3, "attacking has 3 patterns");
    // defending (kind 6) has 2 patterns: hold_point, bodyguard
    assert.equal(core.getMotivationPatternCount(6), 2, "defending has 2 patterns");
    // all other kinds have 0 patterns
    assert.equal(core.getMotivationPatternCount(1), 0, "random has 0 patterns");
    assert.equal(core.getMotivationPatternCount(12), 0, "user_controlled has 0 patterns");
  });

  test("getDefaultMotivationPattern returns first pattern code", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    // Default pattern is first in the list = code 1
    assert.equal(core.getDefaultMotivationPattern(4), 1, "patrolling default = loop (1)");
    assert.equal(core.getDefaultMotivationPattern(5), 1, "attacking default = melee (1)");
    assert.equal(core.getDefaultMotivationPattern(6), 1, "defending default = hold_point (1)");
    // No patterns = 0
    assert.equal(core.getDefaultMotivationPattern(1), 0, "random has no default pattern");
    assert.equal(core.getDefaultMotivationPattern(0), 0, "invalid kind = 0");
  });

  test("getMotivationPatternCodeAt returns indexed pattern codes", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    // patrolling: loop=1, ping_pong=2, random_walk=3
    assert.equal(core.getMotivationPatternCodeAt(4, 0), 1, "patrolling[0] = loop");
    assert.equal(core.getMotivationPatternCodeAt(4, 1), 2, "patrolling[1] = ping_pong");
    assert.equal(core.getMotivationPatternCodeAt(4, 2), 3, "patrolling[2] = random_walk");
    // attacking: melee=1, ranged=2, mixed=3
    assert.equal(core.getMotivationPatternCodeAt(5, 0), 1, "attacking[0] = melee");
    assert.equal(core.getMotivationPatternCodeAt(5, 1), 2, "attacking[1] = ranged");
    assert.equal(core.getMotivationPatternCodeAt(5, 2), 3, "attacking[2] = mixed");
    // defending: hold_point=1, bodyguard=2
    assert.equal(core.getMotivationPatternCodeAt(6, 0), 1, "defending[0] = hold_point");
    assert.equal(core.getMotivationPatternCodeAt(6, 1), 2, "defending[1] = bodyguard");
    // out of bounds
    assert.equal(core.getMotivationPatternCodeAt(4, 3), 0, "patrolling[3] = out of bounds");
    assert.equal(core.getMotivationPatternCodeAt(6, 2), 0, "defending[2] = out of bounds");
    // no patterns
    assert.equal(core.getMotivationPatternCodeAt(1, 0), 0, "random[0] = none");
  });

  // ── Existing tests still pass ──
  test("existing motivation-loadouts runtime tests are unaffected", async () => {
    // Import to verify the module still loads
    const loadouts = await import(
      "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
    );
    assert.ok(loadouts.MOTIVATION_KINDS.length === 12);
    assert.ok(Object.keys(loadouts.MOTIVATION_FAMILIES).length === 4);
  });
}

// ## TODO: Test Permutations
// - [ ] All 12 kinds map to exactly one of the 4 families
// - [ ] Family membership is exhaustive: union of all families = all 12 kinds
// - [ ] Exclusive group symmetry: conflict(a,b) == conflict(b,a) for all pairs
// - [ ] Cross-group pairs: every mobility+posture, mobility+cognition, posture+cognition pair is non-conflicting
// - [ ] Pattern index bounds: getMotivationPatternCodeAt(kind, patternCount) returns 0 for all patterned kinds
// - [ ] All patterned kinds have default pattern == first pattern code (1)
