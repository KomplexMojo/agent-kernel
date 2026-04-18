const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const VITAL_KIND = Object.freeze({ health: 0, mana: 1, stamina: 2, durability: 3 });
const RESOURCE_MODE = Object.freeze({ consumable: 0, level: 1, permanent: 2 });
const DIRECTION = Object.freeze({ north: 0, east: 2, south: 4, west: 6 });
const ACTION_KIND = Object.freeze({ Move: 8 });
const TILE = Object.freeze({ Wall: 0, Floor: 1, Spawn: 2 });

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
}

function setupGrid(core) {
  // 3x3: S=spawn, .=floor
  // ###
  // S..
  // ###
  core.configureGrid(3, 3);
  core.setTileAt(0, 0, TILE.Wall);
  core.setTileAt(1, 0, TILE.Wall);
  core.setTileAt(2, 0, TILE.Wall);
  core.setTileAt(0, 1, TILE.Spawn);
  core.setTileAt(1, 1, TILE.Floor);
  core.setTileAt(2, 1, TILE.Floor);
  core.setTileAt(0, 2, TILE.Wall);
  core.setTileAt(1, 2, TILE.Wall);
  core.setTileAt(2, 2, TILE.Wall);
  core.setSpawnPosition(0, 1);
  core.spawnActorAt(0, 1);
  core.setActorVital(VITAL_KIND.health, 5, 10, 0);
  core.setActorVital(VITAL_KIND.mana, 0, 10, 0);
  core.setActorVital(VITAL_KIND.stamina, 12, 12, 2);
  core.setActorVital(VITAL_KIND.durability, 0, 0, 0);
}

function applyMove(core, { actorId, fromX, fromY, toX, toY, direction, tick }) {
  core.setMoveAction(actorId, fromX, fromY, toX, toY, direction, tick);
  core.applyAction(ACTION_KIND.Move, 0);
}

// --- consumable mode ---

test("resource capture: consumable health adds delta to current only", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  setupGrid(core);
  // Place health+4 consumable at (1,1)
  const placed = core.placeResourceAt(1, 1, VITAL_KIND.health, 4, RESOURCE_MODE.consumable);
  assert.equal(placed, 1, "placeResourceAt should return 1 on success");
  assert.equal(core.getResourceCount(), 1, "resource count should be 1");
  // Move east to (1,1)
  applyMove(core, { actorId: core.getActorId(), fromX: 0, fromY: 1, toX: 1, toY: 1, direction: DIRECTION.east, tick: 1 });
  // current: 5+4=9, max unchanged: 10
  assert.equal(core.getActorVitalCurrent(VITAL_KIND.health), 9, "health current should increase by delta");
  assert.equal(core.getActorVitalMax(VITAL_KIND.health), 10, "health max must not change for consumable");
  // Resource consumed
  assert.equal(core.getResourceCount(), 0, "resource should be consumed after capture");
  assert.equal(core.hasResourceAt(1, 1), 0, "tile should have no resource after capture");
});

test("resource capture: consumable health clamps at max", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  setupGrid(core);
  // health already 5/10; delta=20 would exceed max
  core.placeResourceAt(1, 1, VITAL_KIND.health, 20, RESOURCE_MODE.consumable);
  applyMove(core, { actorId: core.getActorId(), fromX: 0, fromY: 1, toX: 1, toY: 1, direction: DIRECTION.east, tick: 1 });
  assert.equal(core.getActorVitalCurrent(VITAL_KIND.health), 10, "health current must clamp at max");
  assert.equal(core.getActorVitalMax(VITAL_KIND.health), 10, "health max unchanged for consumable");
});

test("resource capture: consumable mana adds to mana current only", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  setupGrid(core);
  core.placeResourceAt(1, 1, VITAL_KIND.mana, 3, RESOURCE_MODE.consumable);
  applyMove(core, { actorId: core.getActorId(), fromX: 0, fromY: 1, toX: 1, toY: 1, direction: DIRECTION.east, tick: 1 });
  assert.equal(core.getActorVitalCurrent(VITAL_KIND.mana), 3);
  assert.equal(core.getActorVitalMax(VITAL_KIND.mana), 10, "mana max unchanged for consumable");
});

// --- level mode ---

test("resource capture: level health raises current and max", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  setupGrid(core);
  core.placeResourceAt(1, 1, VITAL_KIND.health, 5, RESOURCE_MODE.level);
  applyMove(core, { actorId: core.getActorId(), fromX: 0, fromY: 1, toX: 1, toY: 1, direction: DIRECTION.east, tick: 1 });
  assert.equal(core.getActorVitalCurrent(VITAL_KIND.health), 10, "health current = 5+5");
  assert.equal(core.getActorVitalMax(VITAL_KIND.health), 15, "health max = 10+5 for level mode");
  assert.equal(core.getResourceCount(), 0, "resource consumed after capture");
});

test("resource capture: level mana raises max and current", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  setupGrid(core);
  core.placeResourceAt(1, 1, VITAL_KIND.mana, 4, RESOURCE_MODE.level);
  applyMove(core, { actorId: core.getActorId(), fromX: 0, fromY: 1, toX: 1, toY: 1, direction: DIRECTION.east, tick: 1 });
  assert.equal(core.getActorVitalCurrent(VITAL_KIND.mana), 4, "mana current = 0+4");
  assert.equal(core.getActorVitalMax(VITAL_KIND.mana), 14, "mana max = 10+4");
});

// --- permanent mode ---

test("resource capture: permanent mode raises current and max (same as level at WASM layer)", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  setupGrid(core);
  core.placeResourceAt(1, 1, VITAL_KIND.stamina, 3, RESOURCE_MODE.permanent);
  applyMove(core, { actorId: core.getActorId(), fromX: 0, fromY: 1, toX: 1, toY: 1, direction: DIRECTION.east, tick: 1 });
  // stamina starts at 12/12; after regen (2) on move = 14, clamped to 12, then +3 max = 15, current = min(14, 15) = 14
  assert.equal(core.getActorVitalMax(VITAL_KIND.stamina), 15, "stamina max raised by delta");
  assert.ok(core.getActorVitalCurrent(VITAL_KIND.stamina) <= 15, "stamina current does not exceed new max");
  assert.equal(core.getResourceCount(), 0, "resource consumed");
});

// --- placement guards ---

test("placeResourceAt rejects wall tile", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  setupGrid(core);
  const placed = core.placeResourceAt(0, 0, VITAL_KIND.health, 5, RESOURCE_MODE.consumable);
  assert.equal(placed, 0, "should not allow resource on wall tile");
  assert.equal(core.getResourceCount(), 0);
});

test("placeResourceAt rejects out-of-bounds coordinates", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  setupGrid(core);
  const placed = core.placeResourceAt(99, 99, VITAL_KIND.health, 5, RESOURCE_MODE.consumable);
  assert.equal(placed, 0, "should not allow resource out of bounds");
});

test("hasResourceAt returns 0 on empty tile", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  setupGrid(core);
  assert.equal(core.hasResourceAt(1, 1), 0);
});

test("getResourceVitalKindAt and getResourceDeltaAt and getResourceModeAt return placed values", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  setupGrid(core);
  core.placeResourceAt(1, 1, VITAL_KIND.mana, 7, RESOURCE_MODE.level);
  assert.equal(core.hasResourceAt(1, 1), 1);
  assert.equal(core.getResourceVitalKindAt(1, 1), VITAL_KIND.mana);
  assert.equal(core.getResourceDeltaAt(1, 1), 7);
  assert.equal(core.getResourceModeAt(1, 1), RESOURCE_MODE.level);
});

test("resource is not captured if actor does not step on it", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) return;
  setupGrid(core);
  core.placeResourceAt(2, 1, VITAL_KIND.health, 5, RESOURCE_MODE.consumable);
  // Move to (1,1) only — resource at (2,1) untouched
  applyMove(core, { actorId: core.getActorId(), fromX: 0, fromY: 1, toX: 1, toY: 1, direction: DIRECTION.east, tick: 1 });
  assert.equal(core.getResourceCount(), 1, "resource not at destination should remain");
  assert.equal(core.getActorVitalCurrent(VITAL_KIND.health), 5, "health unchanged");
});

/*
## TODO: Test Permutations
- negative delta on consumable resource reduces current vital (e.g. poison tile)
- negative delta on level resource reduces current and max (permanent penalty)
- placing two resources on same tile: second placement overwrites the first
- removeResourceAt on floor with resource removes it and decrements count
- removeResourceAt on floor without resource is a no-op
- resource on spawn tile: actor starts there, should not auto-capture on spawn
- actor with health already at max: consumable health resource has no effect
- resource with delta=0 is placed and captured but produces no vital change
*/
