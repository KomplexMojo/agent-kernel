const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

if (!existsSync(WASM_PATH)) {
  test.skip("WASM not built — skipping affinity spatial tests", () => {});
} else {
  // ── Radius parity ──

  test("computeAffinityRadius matches JS radius for push/emit representative values", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { computeRadius } = await import("../../packages/runtime/src/render/affinity-spatial-formulas.js");
    const { SPATIAL_WEIGHTS } = await import("../../packages/runtime/src/contracts/affinity-spatial-rules.js");

    const expressions = ["push", "pull", "emit", "draw"];
    const exprCodes = [1, 2, 3, 4];
    const stackValues = [1, 2, 3, 5, 8];

    for (let e = 0; e < expressions.length; e++) {
      for (const stacks of stackValues) {
        const jsRadius = computeRadius(expressions[e], stacks, SPATIAL_WEIGHTS);
        const wasmRadius = core.computeAffinityRadius(exprCodes[e], stacks);
        assert.equal(wasmRadius, jsRadius, `radius(${expressions[e]}, stacks=${stacks})`);
      }
    }
  });

  // ── Intensity parity ──

  test("computeAffinityIntensity matches JS intensity for representative values", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { computeIntensity } = await import("../../packages/runtime/src/render/affinity-spatial-formulas.js");
    const { SPATIAL_WEIGHTS } = await import("../../packages/runtime/src/contracts/affinity-spatial-rules.js");

    const cases = [
      // [expression, exprCode, stacks, distance]
      ["push", 1, 1, 0],
      ["push", 1, 1, 1],
      ["push", 1, 3, 1],
      ["emit", 3, 2, 1],
      ["emit", 3, 2, 2],
      ["emit", 3, 3, 3],
      ["draw", 4, 1, 0],
      ["draw", 4, 2, 1],
    ];

    for (const [exprName, exprCode, stacks, dist] of cases) {
      const jsVal = computeIntensity(dist, stacks, exprName, SPATIAL_WEIGHTS);
      const wasmVal = core.computeAffinityIntensity(dist, stacks, exprCode);
      assert.ok(
        Math.abs(wasmVal - jsVal) < 1e-10,
        `intensity(${exprName}, stacks=${stacks}, d=${dist}): wasm=${wasmVal}, js=${jsVal}`,
      );
    }
  });

  // ── Potency parity ──

  test("computeAffinityPotency matches JS potency", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { computePotency } = await import("../../packages/runtime/src/render/affinity-spatial-formulas.js");
    const { SPATIAL_WEIGHTS } = await import("../../packages/runtime/src/contracts/affinity-spatial-rules.js");

    // push: quadratic (1, 4, 9, 16, 25)
    assert.equal(core.computeAffinityPotency(1, 1), computePotency(1, "push", SPATIAL_WEIGHTS));
    assert.equal(core.computeAffinityPotency(2, 1), computePotency(2, "push", SPATIAL_WEIGHTS));
    assert.equal(core.computeAffinityPotency(5, 1), computePotency(5, "push", SPATIAL_WEIGHTS));

    // pull/emit/draw: linear (1, 2, 3, 4, 5)
    assert.equal(core.computeAffinityPotency(3, 2), computePotency(3, "pull", SPATIAL_WEIGHTS));
    assert.equal(core.computeAffinityPotency(3, 3), computePotency(3, "emit", SPATIAL_WEIGHTS));
    assert.equal(core.computeAffinityPotency(3, 4), computePotency(3, "draw", SPATIAL_WEIGHTS));
  });

  // ── Mana cost parity ──

  test("computeAffinityManaCost matches JS mana cost", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { computeManaCost } = await import("../../packages/runtime/src/render/affinity-spatial-formulas.js");
    const { SPATIAL_WEIGHTS } = await import("../../packages/runtime/src/contracts/affinity-spatial-rules.js");

    // push/pull: always 0
    assert.equal(core.computeAffinityManaCost(5, 1), 0, "push mana cost = 0");
    assert.equal(core.computeAffinityManaCost(5, 2), 0, "pull mana cost = 0");

    // emit: ceil(1 + 0.5 * stacks^2)
    for (const stacks of [1, 2, 3, 5]) {
      const jsVal = computeManaCost(stacks, "emit", SPATIAL_WEIGHTS);
      assert.equal(core.computeAffinityManaCost(stacks, 3), jsVal, `emit mana cost stacks=${stacks}`);
    }

    // draw: ceil(0 + 0.25 * stacks^2)
    for (const stacks of [1, 2, 3, 5]) {
      const jsVal = computeManaCost(stacks, "draw", SPATIAL_WEIGHTS);
      assert.equal(core.computeAffinityManaCost(stacks, 4), jsVal, `draw mana cost stacks=${stacks}`);
    }
  });

  // ── Stack cancellation ──

  test("resolveAffinityStackCancellation: source 5 vs target 2", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const canceled = core.resolveAffinityStackCancellation(5, 2);
    assert.equal(canceled, 2, "canceled");
    assert.equal(core.getLastAffinityCanceledStacks(), 2, "last canceled");
    assert.equal(core.getLastAffinityNetSourceStacks(), 3, "net source");
    assert.equal(core.getLastAffinityNetTargetStacks(), 0, "net target");
  });

  test("resolveAffinityStackCancellation: equal stacks", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    core.resolveAffinityStackCancellation(3, 3);
    assert.equal(core.getLastAffinityCanceledStacks(), 3);
    assert.equal(core.getLastAffinityNetSourceStacks(), 0);
    assert.equal(core.getLastAffinityNetTargetStacks(), 0);
  });

  // ── Merged stacks ──

  test("resolveAffinityMergedStacks caps at 8", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.resolveAffinityMergedStacks(3, 2), 5);
    assert.equal(core.resolveAffinityMergedStacks(5, 5), 8);
    assert.equal(core.resolveAffinityMergedStacks(8, 1), 8);
  });

  // ── Matrix cell count ──

  test("getAffinityInteractionCellCount returns 48", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.getAffinityInteractionCellCount(), 48);
  });

  // ── Matrix parity: push→emit opposite = disruption with cancellation ──

  test("matrix push→emit opposite: potency_reduced, disruption, cancel=true", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const PUSH = 1, EMIT = 3, OPPOSITE = 1;
    assert.equal(core.getAffinityMatrixSourceEffect(PUSH, EMIT, OPPOSITE), 3, "src = potency_reduced");
    assert.equal(core.getAffinityMatrixTargetEffect(PUSH, EMIT, OPPOSITE), 3, "tgt = potency_reduced");
    assert.equal(core.getAffinityMatrixVisualState(PUSH, EMIT, OPPOSITE), 5, "visual = disruption");
    assert.equal(core.getAffinityMatrixUsesStackCancellation(PUSH, EMIT, OPPOSITE), 1, "cancel = true");
  });

  // ── Matrix parity: all unrelated cells are layered/none/no-cancel ──

  test("all unrelated matrix cells are (none, none, layered, no cancel)", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const NEUTRAL = 2, LAYERED = 20;
    for (let src = 1; src <= 4; src++) {
      for (let tgt = 1; tgt <= 4; tgt++) {
        assert.equal(core.getAffinityMatrixSourceEffect(src, tgt, NEUTRAL), 0,
          `src effect (${src},${tgt},neutral) = none`);
        assert.equal(core.getAffinityMatrixTargetEffect(src, tgt, NEUTRAL), 0,
          `tgt effect (${src},${tgt},neutral) = none`);
        assert.equal(core.getAffinityMatrixVisualState(src, tgt, NEUTRAL), LAYERED,
          `visual (${src},${tgt},neutral) = layered`);
        assert.equal(core.getAffinityMatrixUsesStackCancellation(src, tgt, NEUTRAL), 0,
          `cancel (${src},${tgt},neutral) = false`);
      }
    }
  });

  // ── Matrix parity: all opposite cells use stack cancellation ──

  test("all opposite matrix cells use stack cancellation", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const OPPOSITE = 1;
    for (let src = 1; src <= 4; src++) {
      for (let tgt = 1; tgt <= 4; tgt++) {
        assert.equal(core.getAffinityMatrixUsesStackCancellation(src, tgt, OPPOSITE), 1,
          `cancel (${src},${tgt},opposite) = true`);
      }
    }
  });

  // ── Full 48-cell matrix parity against JS ──

  test("all 48 matrix cells match runtime INTERACTION_MATRIX", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    const { INTERACTION_MATRIX } = await import("../../packages/runtime/src/contracts/affinity-spatial-rules.js");

    const exprs = ["push", "pull", "emit", "draw"];
    const rels = ["same", "opposite", "unrelated"];
    const effectMap = {
      none: 0, damage: 1, conditional_damage: 2, potency_reduced: 3,
      mana_gain: 4, mana_loss: 5, amplified_damage: 6,
    };

    let count = 0;
    for (let s = 0; s < 4; s++) {
      for (let t = 0; t < 4; t++) {
        for (let r = 0; r < 3; r++) {
          const jsCell = INTERACTION_MATRIX[exprs[s]][exprs[t]][rels[r]];
          const srcCode = s + 1, tgtCode = t + 1;

          assert.equal(
            core.getAffinityMatrixSourceEffect(srcCode, tgtCode, r),
            effectMap[jsCell.sourceEffect],
            `srcEffect ${exprs[s]}→${exprs[t]}:${rels[r]}`,
          );
          assert.equal(
            core.getAffinityMatrixTargetEffect(srcCode, tgtCode, r),
            effectMap[jsCell.targetEffect],
            `tgtEffect ${exprs[s]}→${exprs[t]}:${rels[r]}`,
          );
          assert.equal(
            core.getAffinityMatrixUsesStackCancellation(srcCode, tgtCode, r),
            jsCell.usesStackCancellation ? 1 : 0,
            `cancel ${exprs[s]}→${exprs[t]}:${rels[r]}`,
          );
          count++;
        }
      }
    }
    assert.equal(count, 48, "verified all 48 cells");
  });

  // ── Invalid arguments ──

  test("matrix getters return -1 for invalid arguments", async () => {
    const core = await loadCoreFromWasmPath(WASM_PATH);
    assert.equal(core.getAffinityMatrixSourceEffect(0, 1, 0), -1);
    assert.equal(core.getAffinityMatrixTargetEffect(1, 5, 0), -1);
    assert.equal(core.getAffinityMatrixVisualState(1, 1, 3), -1);
  });
}

// ## TODO: Test Permutations
// - [ ] Radius formula: all 4 expressions × stacks 1..10 match JS parity
// - [ ] Intensity falloff: distance sweep 0..radius for each expression
// - [ ] Potency quadratic vs linear: push at stacks 1..10 produces n^2, others produce n
// - [ ] Mana cost: emit and draw at stacks 1..10 match ceil formula
// - [ ] Stack cancellation: asymmetric cases (1 vs 10, 10 vs 1)
// - [ ] Matrix visual state codes: every non-layered visual state appears at least once
// - [ ] Matrix symmetry: push→draw:same vs draw→push:same produce mirror effects
