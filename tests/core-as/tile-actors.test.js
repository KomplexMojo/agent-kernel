const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const GRID_FIXTURE_PATH = resolve(ROOT, "tests/fixtures/tile-actor-grid-v1-mvp.json");
const BARRIER_FIXTURE_PATH = resolve(ROOT, "tests/fixtures/tile-actor-grid-v1-mvp-barrier.json");

const ACTOR_KIND_LABEL = Object.freeze({
  0: "stationary",
  1: "barrier",
  2: "motivated",
});

const ACTION_KIND = Object.freeze({
  Move: 8,
});

const EFFECT_KIND = Object.freeze({
  DurabilityChanged: 13,
  ActorBlocked: 14,
});

const VALIDATION_ERROR = Object.freeze({
  BlockedByWall: 10,
});

const DIRECTION = Object.freeze({
  east: 1,
});

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
}

function readGridFixture(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readTileActorKinds(core, { width, height }) {
  const kinds = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      row.push(ACTOR_KIND_LABEL[core.getTileActorKind(x, y)]);
    }
    kinds.push(row);
  }
  return kinds;
}

function readBaseTiles(core, { width, height }) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      row += String.fromCharCode(core.renderBaseCellChar(x, y));
    }
    rows.push(row);
  }
  return rows;
}

function packMove({ actorId, from, to, direction, tick }) {
  return { actorId, from, to, direction, tick };
}

function applyMove(core, action) {
  core.setMoveAction(
    action.actorId,
    action.from.x,
    action.from.y,
    action.to.x,
    action.to.y,
    action.direction,
    action.tick
  );
  core.applyAction(ACTION_KIND.Move, 0);
}

function readActorBlocked(core, index) {
  return {
    actorId: core.getEffectActorId(index),
    x: core.getEffectX(index),
    y: core.getEffectY(index),
    reason: core.getEffectReason(index),
  };
}

function readDurabilityChange(core, index) {
  return {
    actorId: core.getEffectActorId(index),
    delta: core.getEffectDelta(index),
  };
}

test("core-as exposes tile actor occupancy for the MVP grid", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  const fixture = readGridFixture(GRID_FIXTURE_PATH);
  core.init(0);
  core.loadMvpScenario();

  assert.equal(core.getMapWidth(), fixture.width);
  assert.equal(core.getMapHeight(), fixture.height);
  assert.deepEqual(readTileActorKinds(core, fixture), fixture.kinds);

  const originId = core.getTileActorId(0, 0);
  assert.ok(originId > 0);
  assert.notEqual(originId, core.getTileActorId(1, 0));
  assert.equal(originId, core.getTileActorId(0, 0));

  const originIndex = core.getTileActorIndex(0, 0);
  assert.ok(originIndex >= 0);
  assert.equal(core.getTileActorCount(), fixture.width * fixture.height);
  assert.equal(core.getTileActorXByIndex(originIndex), 0);
  assert.equal(core.getTileActorYByIndex(originIndex), 0);
  assert.equal(core.getTileActorKindByIndex(originIndex), 1);
  assert.equal(core.getTileActorIdByIndex(originIndex), originId);
});

test("core-as blocks movement into barrier tile actors and renders barriers", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  const fixture = readGridFixture(BARRIER_FIXTURE_PATH);
  core.init(0);
  core.loadMvpBarrierScenario();

  assert.equal(core.getMapWidth(), fixture.width);
  assert.equal(core.getMapHeight(), fixture.height);
  assert.deepEqual(readBaseTiles(core, fixture), fixture.baseTiles);
  assert.deepEqual(readTileActorKinds(core, fixture), fixture.kinds);

  core.clearEffects();
  const packed = packMove({
    actorId: 1,
    from: fixture.spawn,
    to: fixture.barrier,
    direction: DIRECTION.east,
    tick: 1,
  });
  const barrierId = core.getTileActorId(fixture.barrier.x, fixture.barrier.y);
  const durabilityBefore = core.getTileActorDurability(fixture.barrier.x, fixture.barrier.y);
  applyMove(core, packed);
  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActorBlocked);
  const blocked = readActorBlocked(core, 0);
  assert.equal(blocked.actorId, 1);
  assert.equal(blocked.reason, VALIDATION_ERROR.BlockedByWall);
  assert.deepEqual({ x: blocked.x, y: blocked.y }, fixture.barrier);
  assert.equal(core.getEffectKind(1), EFFECT_KIND.DurabilityChanged);
  const durabilityChange = readDurabilityChange(core, 1);
  assert.equal(durabilityChange.actorId, barrierId);
  const durabilityAfter = core.getTileActorDurability(fixture.barrier.x, fixture.barrier.y);
  const expectedAfter = durabilityBefore > 0 ? durabilityBefore - 1 : 0;
  const expectedDelta = durabilityBefore > 0 ? -1 : 0;
  assert.equal(durabilityChange.delta, expectedDelta);
  assert.equal(durabilityAfter, expectedAfter);
});
