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

function hasActorAffinityAPI(core) {
  return typeof core.setMotivatedActorAffinity === "function"
    && typeof core.getMotivatedActorAffinityKindByIndex === "function"
    && typeof core.getMotivatedActorAffinityExpressionByIndex === "function"
    && typeof core.getMotivatedActorAffinityStacksByIndex === "function"
    && typeof core.computeActorAffinityField === "function"
    && typeof core.computeAffinityField === "function";
}

// ── Per-actor affinity storage ──

test("setMotivatedActorAffinity stores and reads back affinity data", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasActorAffinityAPI(core)) { t.skip("Actor affinity API not yet exported."); return; }

  const FIRE = 1, EMIT = 3;
  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);

  // Place two actors
  core.clearActorPlacements();
  core.addActorPlacement(10, 2, 2);
  core.addActorPlacement(20, 4, 4);
  core.applyActorPlacements();

  // Default affinity should be zero
  assert.equal(core.getMotivatedActorAffinityKindByIndex(0), 0, "default kind is 0");
  assert.equal(core.getMotivatedActorAffinityExpressionByIndex(0), 0, "default expression is 0");
  assert.equal(core.getMotivatedActorAffinityStacksByIndex(0), 0, "default stacks is 0");

  // Set actor 0 affinity: fire emit stacks=2
  assert.equal(core.setMotivatedActorAffinity(0, FIRE, EMIT, 2), 1, "set succeeds");
  assert.equal(core.getMotivatedActorAffinityKindByIndex(0), FIRE, "kind is fire");
  assert.equal(core.getMotivatedActorAffinityExpressionByIndex(0), EMIT, "expression is emit");
  assert.equal(core.getMotivatedActorAffinityStacksByIndex(0), 2, "stacks is 2");

  // Actor 1 still default
  assert.equal(core.getMotivatedActorAffinityKindByIndex(1), 0, "actor 1 still default");
});

test("setMotivatedActorAffinity rejects invalid inputs", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasActorAffinityAPI(core)) { t.skip("Actor affinity API not yet exported."); return; }

  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);

  core.clearActorPlacements();
  core.addActorPlacement(10, 2, 2);
  core.applyActorPlacements();

  // Invalid actor index
  assert.equal(core.setMotivatedActorAffinity(-1, 1, 3, 1), 0, "negative index");
  assert.equal(core.setMotivatedActorAffinity(1, 1, 3, 1), 0, "out-of-bounds index");

  // Invalid affinity kind
  assert.equal(core.setMotivatedActorAffinity(0, 0, 3, 1), 0, "kind 0");
  assert.equal(core.setMotivatedActorAffinity(0, 11, 3, 1), 0, "kind 11");

  // Invalid expression
  assert.equal(core.setMotivatedActorAffinity(0, 1, 0, 1), 0, "expression 0");
  assert.equal(core.setMotivatedActorAffinity(0, 1, 5, 1), 0, "expression 5");

  // Invalid stacks
  assert.equal(core.setMotivatedActorAffinity(0, 1, 3, 0), 0, "stacks 0");
  assert.equal(core.setMotivatedActorAffinity(0, 1, 3, -1), 0, "stacks -1");
});

test("actor affinity getters return 0 for invalid indices", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasActorAffinityAPI(core)) { t.skip("Actor affinity API not yet exported."); return; }

  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);

  // No actors placed
  assert.equal(core.getMotivatedActorAffinityKindByIndex(0), 0, "no actors kind");
  assert.equal(core.getMotivatedActorAffinityExpressionByIndex(-1), 0, "negative index");
  assert.equal(core.getMotivatedActorAffinityStacksByIndex(100), 0, "huge index");
});

// ── Actor affinity field projection ──

test("computeActorAffinityField projects actor fire emit onto surrounding tiles", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasActorAffinityAPI(core)) { t.skip("Actor affinity API not yet exported."); return; }

  const FIRE = 1, EMIT = 3;
  core.init(0);
  core.configureGrid(7, 7);
  setAllFloors(core, 7, 7);

  // Place actor at (3,3) with fire emit stacks=1
  core.clearActorPlacements();
  core.addActorPlacement(10, 3, 3);
  core.applyActorPlacements();
  core.setMotivatedActorAffinity(0, FIRE, EMIT, 1);

  // Compute actor field
  const count = core.computeActorAffinityField();
  assert.equal(count, 1, "one actor with affinity");

  // Source tile: intensity 1.0
  assert.equal(core.getAffinityFieldIntensityAt(3, 3, FIRE), 1.0, "source intensity");
  assert.equal(core.getAffinityFieldStacksAt(3, 3, FIRE), 1, "source stacks");
  assert.equal(core.getAffinityFieldExpressionAt(3, 3, FIRE), EMIT, "source expression");

  // emit stacks=1: radius = floor(1.0 + 1.0 * 1) = 2
  // d=1: emit buffer zone → intensity 0.0
  assert.equal(core.getAffinityFieldIntensityAt(2, 3, FIRE), 0.0, "d=1 west");

  // d=2: intensity = 1.0 * 1^0.3 * (1 - 0.5) = 0.5
  const expectedD2 = 0.5;
  assert.ok(
    Math.abs(core.getAffinityFieldIntensityAt(1, 3, FIRE) - expectedD2) < 1e-10,
    `d=2 intensity: got ${core.getAffinityFieldIntensityAt(1, 3, FIRE)}, expected ${expectedD2}`,
  );

  // d=3: beyond radius=2 → intensity 0.0
  assert.equal(core.getAffinityFieldIntensityAt(0, 3, FIRE), 0.0, "d=3 beyond radius");
});

test("computeActorAffinityField: stacks=2 extends range", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasActorAffinityAPI(core)) { t.skip("Actor affinity API not yet exported."); return; }

  const FIRE = 1, EMIT = 3;
  core.init(0);
  core.configureGrid(9, 9);
  setAllFloors(core, 9, 9);

  // Place actor at (4,4) with fire emit stacks=2
  core.clearActorPlacements();
  core.addActorPlacement(10, 4, 4);
  core.applyActorPlacements();
  core.setMotivatedActorAffinity(0, FIRE, EMIT, 2);

  core.computeActorAffinityField();

  // emit stacks=2: radius = floor(1.0 + 1.0 * 2) = 3
  // Source intensity 1.0
  assert.equal(core.getAffinityFieldIntensityAt(4, 4, FIRE), 1.0, "source");

  // d=3 should have some intensity (within radius=3)
  const d3Intensity = core.getAffinityFieldIntensityAt(1, 4, FIRE);
  assert.ok(d3Intensity > 0, `d=3 has intensity: got ${d3Intensity}`);

  // d=4 should be 0 (beyond radius=3)
  assert.equal(core.getAffinityFieldIntensityAt(0, 4, FIRE), 0.0, "d=4 beyond radius");
});

test("computeActorAffinityField skips actors without affinity", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasActorAffinityAPI(core)) { t.skip("Actor affinity API not yet exported."); return; }

  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);

  // Place actor without affinity
  core.clearActorPlacements();
  core.addActorPlacement(10, 2, 2);
  core.applyActorPlacements();

  const count = core.computeActorAffinityField();
  assert.equal(count, 0, "no actors with affinity");
  assert.equal(core.getAffinityFieldIntensityAt(2, 2, 1), 0.0, "no field");
});

test("two actors with different affinities produce independent channels", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasActorAffinityAPI(core)) { t.skip("Actor affinity API not yet exported."); return; }

  const FIRE = 1, WATER = 2, EMIT = 3;
  core.init(0);
  core.configureGrid(11, 5);
  setAllFloors(core, 11, 5);

  // Actor 0 at (1,2) with fire emit stacks=1 (radius=2)
  // Actor 1 at (9,2) with water emit stacks=1 (radius=2)
  // Distance = 8, well beyond 2*radius=4
  core.clearActorPlacements();
  core.addActorPlacement(10, 1, 2);
  core.addActorPlacement(20, 9, 2);
  core.applyActorPlacements();
  core.setMotivatedActorAffinity(0, FIRE, EMIT, 1);
  core.setMotivatedActorAffinity(1, WATER, EMIT, 1);

  const count = core.computeActorAffinityField();
  assert.equal(count, 2, "two actors with affinity");

  // Fire at actor 0 source
  assert.equal(core.getAffinityFieldIntensityAt(1, 2, FIRE), 1.0, "fire source");
  assert.equal(core.getAffinityFieldIntensityAt(1, 2, WATER), 0.0, "no water at fire source");

  // Water at actor 1 source
  assert.equal(core.getAffinityFieldIntensityAt(9, 2, WATER), 1.0, "water source");
  assert.equal(core.getAffinityFieldIntensityAt(9, 2, FIRE), 0.0, "no fire at water source");
});

// ── Combined field: computeAffinityField ──

test("computeAffinityField combines traps and actors", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasActorAffinityAPI(core)) { t.skip("Actor affinity API not yet exported."); return; }

  const FIRE = 1, WATER = 2, EMIT = 3;
  core.init(0);
  core.configureGrid(11, 5);
  setAllFloors(core, 11, 5);

  // Fire trap at (1,2) stacks=1
  core.armStaticTrapAt(1, 2, FIRE, EMIT, 1, 5);

  // Water actor at (9,2) stacks=1
  core.clearActorPlacements();
  core.addActorPlacement(10, 9, 2);
  core.applyActorPlacements();
  core.setMotivatedActorAffinity(0, WATER, EMIT, 1);

  const total = core.computeAffinityField();
  assert.equal(total, 2, "one trap + one actor = 2 sources");

  // Fire from trap
  assert.equal(core.getAffinityFieldIntensityAt(1, 2, FIRE), 1.0, "fire trap source");
  // Water from actor
  assert.equal(core.getAffinityFieldIntensityAt(9, 2, WATER), 1.0, "water actor source");
});

test("computeAffinityField: same-kind overlap between trap and actor uses max", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasActorAffinityAPI(core)) { t.skip("Actor affinity API not yet exported."); return; }

  const FIRE = 1, EMIT = 3;
  core.init(0);
  core.configureGrid(7, 5);
  setAllFloors(core, 7, 5);

  // Fire trap at (1,2) stacks=1 (radius=2)
  core.armStaticTrapAt(1, 2, FIRE, EMIT, 1, 5);

  // Fire actor at (5,2) stacks=2 (radius=3)
  core.clearActorPlacements();
  core.addActorPlacement(10, 5, 2);
  core.applyActorPlacements();
  core.setMotivatedActorAffinity(0, FIRE, EMIT, 2);

  core.computeAffinityField();

  // (3,2): d=2 from trap (within radius=2), d=2 from actor (within radius=3)
  // Trap intensity at d=2 stacks=1: 0.5
  // Actor intensity at d=2 stacks=2: higher (same formula as trap)
  const overlap = core.getAffinityFieldIntensityAt(3, 2, FIRE);
  assert.ok(overlap > 0.5, `overlap takes max: got ${overlap}`);

  // Contribution count = 2 (both trap and actor)
  assert.equal(core.getAffinityFieldContributionCountAt(3, 2, FIRE), 2, "two contributions");
});

// ── Affinity survives placement resets ──

test("actor affinity survives applyActorPlacements", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasActorAffinityAPI(core)) { t.skip("Actor affinity API not yet exported."); return; }

  const FIRE = 1, EMIT = 3;
  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);

  // Place actor and set affinity
  core.clearActorPlacements();
  core.addActorPlacement(10, 2, 2);
  core.applyActorPlacements();
  core.setMotivatedActorAffinity(0, FIRE, EMIT, 2);

  // Re-apply placements (same actor, same position)
  core.clearActorPlacements();
  core.addActorPlacement(10, 2, 2);
  core.applyActorPlacements();

  // Affinity should still be set
  assert.equal(core.getMotivatedActorAffinityKindByIndex(0), FIRE, "kind survives");
  assert.equal(core.getMotivatedActorAffinityExpressionByIndex(0), EMIT, "expression survives");
  assert.equal(core.getMotivatedActorAffinityStacksByIndex(0), 2, "stacks survives");
});

test("configureGrid clears actor affinities", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  if (!hasActorAffinityAPI(core)) { t.skip("Actor affinity API not yet exported."); return; }

  const FIRE = 1, EMIT = 3;
  core.init(0);
  core.configureGrid(5, 5);
  setAllFloors(core, 5, 5);

  core.clearActorPlacements();
  core.addActorPlacement(10, 2, 2);
  core.applyActorPlacements();
  core.setMotivatedActorAffinity(0, FIRE, EMIT, 2);

  // Reconfigure grid — everything should reset
  core.configureGrid(3, 3);
  setAllFloors(core, 3, 3);

  core.clearActorPlacements();
  core.addActorPlacement(10, 1, 1);
  core.applyActorPlacements();

  assert.equal(core.getMotivatedActorAffinityKindByIndex(0), 0, "cleared by configureGrid");
});

// ## TODO: Test Permutations
// - [ ] All 10 affinity kinds: set actor affinity for each kind, compute field, verify kind isolation
// - [ ] All 4 expressions: set actor affinity for each expression, verify radius and intensity pattern
// - [ ] Stacks 1..5: verify radius scales correctly for each stack count
// - [ ] Multiple actors same kind: two actors same affinity kind, verify max-intensity overlap
// - [ ] Actor at grid edge: actor at (0,0) with stacks=2, verify no out-of-bounds
// - [ ] Large grid stress: 20x20 grid with 10 actors each with affinity, verify no abort
// - [ ] Mixed trap+actor same cell: trap and actor on same tile, verify combined contribution count
// - [ ] Actor moves then recompute: move actor, recompute field, verify field follows actor position
// - [ ] Clear actor affinity: set affinity then overwrite with different kind, verify old kind cleared
// - [ ] computeAffinityField returns correct total when some actors lack affinity
