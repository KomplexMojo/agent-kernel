const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
}

function setAllFloors(core, width, height) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      core.setTileAt(x, y, 1);
    }
  }
}

test("core-as raises/destroys barriers and arms/disarms static traps", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  if (
    typeof core.raiseBarrierAt !== "function"
    || typeof core.destroyBarrierAt !== "function"
    || typeof core.armStaticTrapAt !== "function"
  ) {
    t.skip("WASM binary does not expose affinity environment helpers yet.");
    return;
  }

  core.init(0);
  core.configureGrid(4, 4);
  setAllFloors(core, 4, 4);

  core.setTileAt(1, 1, 4);
  assert.equal(core.getTileActorKind(1, 1), 1);
  assert.equal(core.destroyBarrierAt(1, 1), 1);
  assert.equal(core.getTileActorKind(1, 1), 0);
  assert.equal(core.raiseBarrierAt(1, 1), 1);
  assert.equal(core.getTileActorKind(1, 1), 1);

  assert.equal(core.armStaticTrapAt(2, 2, 1, 1, 2, 5), 1);
  assert.equal(core.getStaticTrapCount(), 1);
  assert.equal(core.getStaticTrapAffinityAt(2, 2), 1);
  assert.equal(core.getStaticTrapExpressionAt(2, 2), 1);
  assert.equal(core.getStaticTrapStacksAt(2, 2), 2);
  assert.equal(core.getStaticTrapManaReserveAt(2, 2), 5);

  // Traps only arm on floor tiles.
  assert.equal(core.armStaticTrapAt(1, 1, 2, 3, 3, 4), 0);
  assert.equal(core.getStaticTrapCount(), 1);

  assert.equal(core.disarmStaticTrapAt(2, 2), 1);
  assert.equal(core.getStaticTrapCount(), 0);
});

// ── Field buffer tests (AK-AFF-M3) ──

function hasFieldAPI(core) {
  return typeof core.clearAffinityField === "function"
    && typeof core.computeStaticTrapAffinityField === "function"
    && typeof core.getAffinityFieldIntensityAt === "function"
    && typeof core.getAffinityFieldStacksAt === "function"
    && typeof core.getAffinityFieldExpressionAt === "function"
    && typeof core.getAffinityFieldContributionCountAt === "function";
}

test("clearAffinityField zeros all field arrays", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasFieldAPI(core)) { t.skip("Field buffer API not yet exported."); return; }

  const FIRE = 1, EMIT = 3;
  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);

  // Arm a trap and compute so fields are populated
  core.armStaticTrapAt(2, 2, FIRE, EMIT, 1, 5);
  core.computeStaticTrapAffinityField();
  assert.equal(core.getAffinityFieldIntensityAt(2, 2, FIRE), 1.0, "source before clear");

  // Clear and verify zeros
  core.clearAffinityField();
  assert.equal(core.getAffinityFieldIntensityAt(2, 2, FIRE), 0.0, "source after clear");
  assert.equal(core.getAffinityFieldStacksAt(2, 2, FIRE), 0, "stacks after clear");
  assert.equal(core.getAffinityFieldExpressionAt(2, 2, FIRE), 0, "expression after clear");
  assert.equal(core.getAffinityFieldContributionCountAt(2, 2, FIRE), 0, "count after clear");
});

test("computeStaticTrapAffinityField: fire emit stacks=1 on 5x5 grid", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasFieldAPI(core)) { t.skip("Field buffer API not yet exported."); return; }

  const FIRE = 1, EMIT = 3;
  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);

  // Fire emit at (2,2), stacks=1, mana=5
  // emit stacks=1: radius = floor(1.0 + 1.0 * 1) = 2
  core.armStaticTrapAt(2, 2, FIRE, EMIT, 1, 5);
  const projected = core.computeStaticTrapAffinityField();
  assert.equal(projected, 1, "one trap projected");

  // Source tile (d=0): intensity 1.0 (special case)
  assert.equal(core.getAffinityFieldIntensityAt(2, 2, FIRE), 1.0, "source intensity");
  assert.equal(core.getAffinityFieldStacksAt(2, 2, FIRE), 1, "source stacks");
  assert.equal(core.getAffinityFieldExpressionAt(2, 2, FIRE), EMIT, "source expression");
  assert.equal(core.getAffinityFieldContributionCountAt(2, 2, FIRE), 1, "source contrib count");

  // d=1 cells: emit buffer zone → intensity 0.0
  assert.equal(core.getAffinityFieldIntensityAt(1, 2, FIRE), 0.0, "d=1 west");
  assert.equal(core.getAffinityFieldIntensityAt(3, 2, FIRE), 0.0, "d=1 east");
  assert.equal(core.getAffinityFieldIntensityAt(2, 1, FIRE), 0.0, "d=1 north");
  assert.equal(core.getAffinityFieldIntensityAt(2, 3, FIRE), 0.0, "d=1 south");

  // d=2 cells: emit stacks=1 → intensity = 1.0 * 1^0.3 * (1 - 0.5) = 0.5
  const expectedD2 = 0.5;
  assert.ok(
    Math.abs(core.getAffinityFieldIntensityAt(0, 2, FIRE) - expectedD2) < 1e-10,
    `d=2 west: got ${core.getAffinityFieldIntensityAt(0, 2, FIRE)}, expected ${expectedD2}`,
  );
  assert.ok(
    Math.abs(core.getAffinityFieldIntensityAt(4, 2, FIRE) - expectedD2) < 1e-10,
    `d=2 east: got ${core.getAffinityFieldIntensityAt(4, 2, FIRE)}, expected ${expectedD2}`,
  );
  // Diagonal d=2: (1,1), (3,3), etc.
  assert.ok(
    Math.abs(core.getAffinityFieldIntensityAt(1, 1, FIRE) - expectedD2) < 1e-10,
    `d=2 diagonal: got ${core.getAffinityFieldIntensityAt(1, 1, FIRE)}, expected ${expectedD2}`,
  );

  // d=3 cells: beyond radius=2 → intensity 0.0
  assert.equal(core.getAffinityFieldIntensityAt(0, 0, FIRE), 0.0, "d=4 corner");

  // No water (kind=2) contribution anywhere
  assert.equal(core.getAffinityFieldIntensityAt(2, 2, 2), 0.0, "no water at source");
});

test("per-kind channels: fire and water traps produce independent fields", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasFieldAPI(core)) { t.skip("Field buffer API not yet exported."); return; }

  const FIRE = 1, WATER = 2, EMIT = 3;
  core.init(0);
  core.configureGrid(9, 5);
  setAllFloors(core, 9, 5);

  // Fire emit at (1,2), water emit at (7,2), both stacks=1 (radius=2)
  // Far enough apart that fields don't overlap (distance=6 > 2*radius=4)
  core.armStaticTrapAt(1, 2, FIRE, EMIT, 1, 5);
  core.armStaticTrapAt(7, 2, WATER, EMIT, 1, 5);
  core.computeStaticTrapAffinityField();

  // (1,2) is source for fire only
  assert.equal(core.getAffinityFieldIntensityAt(1, 2, FIRE), 1.0, "fire source");
  assert.equal(core.getAffinityFieldIntensityAt(1, 2, WATER), 0.0, "no water at fire source");

  // (7,2) is source for water only
  assert.equal(core.getAffinityFieldIntensityAt(7, 2, WATER), 1.0, "water source");
  assert.equal(core.getAffinityFieldIntensityAt(7, 2, FIRE), 0.0, "no fire at water source");

  // Contribution counts are independent
  assert.equal(core.getAffinityFieldContributionCountAt(1, 2, FIRE), 1, "fire contrib at source");
  assert.equal(core.getAffinityFieldContributionCountAt(7, 2, WATER), 1, "water contrib at source");

  // Verify fire spreads but water doesn't reach fire's area
  const fireD2 = core.getAffinityFieldIntensityAt(3, 2, FIRE); // d=2 from fire
  assert.ok(fireD2 > 0, `fire spreads to d=2: got ${fireD2}`);
  assert.equal(core.getAffinityFieldIntensityAt(3, 2, WATER), 0.0, "no water near fire");
});

test("same-kind overlap uses max intensity", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasFieldAPI(core)) { t.skip("Field buffer API not yet exported."); return; }

  const FIRE = 1, EMIT = 3;
  core.init(0);
  core.configureGrid(7, 5);
  setAllFloors(core, 7, 5);

  // Two fire emit traps: (1,2) stacks=1 and (5,2) stacks=2
  // emit stacks=1: radius=2; emit stacks=2: radius=3
  core.armStaticTrapAt(1, 2, FIRE, EMIT, 1, 5);
  core.armStaticTrapAt(5, 2, FIRE, EMIT, 2, 5);
  core.computeStaticTrapAffinityField();

  // (3,2) is d=2 from trap1 (within radius=2) and d=2 from trap2 (within radius=3)
  // trap1 intensity at d=2: 0.5 (same as computed above)
  // trap2 intensity at d=2 stacks=2: normalizedDist=(2-1)/3=0.333, falloff=0.667, 1.0*2^0.3*0.667 ≈ 0.8208
  // max wins
  const fieldIntensity = core.getAffinityFieldIntensityAt(3, 2, FIRE);
  assert.ok(fieldIntensity > 0.5, `overlap takes max: got ${fieldIntensity}`);

  // Contribution count should be 2 (both traps contribute)
  assert.equal(core.getAffinityFieldContributionCountAt(3, 2, FIRE), 2, "overlap contrib count");

  // Stacks should be from the higher-intensity trap (stacks=2)
  assert.equal(core.getAffinityFieldStacksAt(3, 2, FIRE), 2, "stacks from stronger trap");
});

test("field getters return 0 for out-of-bounds and invalid kind", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasFieldAPI(core)) { t.skip("Field buffer API not yet exported."); return; }

  core.init(0);
  core.configureGrid(3, 3);
  setAllFloors(core, 3, 3);

  // Out of bounds
  assert.equal(core.getAffinityFieldIntensityAt(-1, 0, 1), 0.0, "negative x");
  assert.equal(core.getAffinityFieldIntensityAt(0, 5, 1), 0.0, "y beyond height");
  assert.equal(core.getAffinityFieldIntensityAt(3, 0, 1), 0.0, "x beyond width");

  // Invalid kind (0 and 11)
  assert.equal(core.getAffinityFieldIntensityAt(0, 0, 0), 0.0, "kind 0");
  assert.equal(core.getAffinityFieldIntensityAt(0, 0, 11), 0.0, "kind 11");
  assert.equal(core.getAffinityFieldStacksAt(0, 0, 0), 0, "stacks kind 0");
  assert.equal(core.getAffinityFieldExpressionAt(0, 0, 0), 0, "expression kind 0");
  assert.equal(core.getAffinityFieldContributionCountAt(0, 0, 0), 0, "count kind 0");
});

test("configureGrid resizes and clears field buffers", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasFieldAPI(core)) { t.skip("Field buffer API not yet exported."); return; }

  const FIRE = 1, EMIT = 3;
  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);
  core.armStaticTrapAt(2, 2, FIRE, EMIT, 1, 5);
  core.computeStaticTrapAffinityField();
  assert.equal(core.getAffinityFieldIntensityAt(2, 2, FIRE), 1.0, "before resize");

  // Reconfigure to smaller grid — fields must be zeroed
  core.configureGrid(3, 3);
  setAllFloors(core, 3, 3);
  assert.equal(core.getAffinityFieldIntensityAt(1, 1, FIRE), 0.0, "after resize");
  assert.equal(core.getAffinityFieldContributionCountAt(1, 1, FIRE), 0, "count after resize");
});

test("computeStaticTrapAffinityField returns trap count", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasFieldAPI(core)) { t.skip("Field buffer API not yet exported."); return; }

  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);

  // No traps → returns 0
  assert.equal(core.computeStaticTrapAffinityField(), 0, "no traps");

  // Two traps → returns 2
  core.armStaticTrapAt(1, 1, 1, 3, 1, 5);
  core.armStaticTrapAt(3, 3, 2, 3, 1, 5);
  assert.equal(core.computeStaticTrapAffinityField(), 2, "two traps");
});

test("existing trap behavior unchanged after field addition", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasFieldAPI(core)) { t.skip("Field buffer API not yet exported."); return; }

  core.init(0);
  core.configureGrid(4, 4);
  setAllFloors(core, 4, 4);

  // Arm, read, disarm — same as original test
  assert.equal(core.armStaticTrapAt(2, 2, 1, 1, 2, 5), 1);
  assert.equal(core.getStaticTrapCount(), 1);
  assert.equal(core.getStaticTrapAffinityAt(2, 2), 1);
  assert.equal(core.getStaticTrapExpressionAt(2, 2), 1);
  assert.equal(core.getStaticTrapStacksAt(2, 2), 2);
  assert.equal(core.getStaticTrapManaReserveAt(2, 2), 5);
  assert.equal(core.disarmStaticTrapAt(2, 2), 1);
  assert.equal(core.getStaticTrapCount(), 0);
});

// ## TODO: Test Permutations
// - [ ] Field spread: all 4 expressions × stacks 1..5 verify correct radius and intensity pattern
// - [ ] Manhattan distance correctness: verify cells at exact boundary (d=radius) get intensity 0 or near-0
// - [ ] All 10 affinity kinds: arm one trap of each kind, compute, verify kind isolation
// - [ ] Overlapping same-kind: 3+ traps overlapping, verify max-intensity selection across all overlap cells
// - [ ] Mixed expression overlap: fire push + fire emit on adjacent cells, verify expression recorded correctly
// - [ ] Large grid stress: 20x20 grid with 10 traps, verify no abort and correct field shape
// - [ ] Non-floor tiles block traps: wall/barrier cells cannot arm traps (existing behavior preserved)
// - [ ] Disarm then recompute: arm trap, compute, disarm trap, recompute, verify field is cleared
// - [ ] Zero stacks or zero mana traps rejected: armStaticTrapAt returns 0 for invalid params
