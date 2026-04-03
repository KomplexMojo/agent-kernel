const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");
const { readFixture } = require("../helpers/fixtures");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const ACTION_KIND = Object.freeze({
  Move: 8,
});

const EFFECT_KIND = Object.freeze({
  ActionRejected: 3,
  LimitReached: 4,
  ActorMoved: 11,
  ActorBlocked: 14,
  AmbientResolved: 15,
});

const VALIDATION_ERROR = Object.freeze({
  InvalidSeed: 1,
  InvalidActionKind: 2,
  InvalidActionValue: 3,
  MissingPendingRequest: 4,
  WrongActor: 5,
  TickMismatch: 6,
  WrongPosition: 7,
  NotAdjacent: 8,
  OutOfBounds: 9,
  BlockedByWall: 10,
  InvalidDirection: 11,
  InsufficientStamina: 19,
});

const DIRECTION = Object.freeze({
  north: 0,
  east: 1,
  south: 2,
  west: 3,
});

async function loadCoreOrSkip(t) {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return null;
  }
  return loadCoreFromWasmPath(WASM_PATH);
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

function readActorMoved(core, index) {
  return {
    actorId: core.getEffectActorId(index),
    x: core.getEffectX(index),
    y: core.getEffectY(index),
  };
}

function readActorBlocked(core, index) {
  return {
    actorId: core.getEffectActorId(index),
    x: core.getEffectX(index),
    y: core.getEffectY(index),
    reason: core.getEffectReason(index),
  };
}

function readAmbientResolved(core, index) {
  const value = core.getEffectValue(index);
  return {
    actorId: core.getEffectActorId(index),
    x: core.getEffectX(index),
    y: core.getEffectY(index),
    outcomeCode: (value >> 24) & 0xff,
    power: (value >> 16) & 0xff,
    affinityKind: (value >> 8) & 0xff,
    expression: value & 0xff,
    targetVital: core.getEffectReason(index),
    delta: core.getEffectDelta(index),
  };
}

function readFrame(core) {
  const width = core.getMapWidth();
  const height = core.getMapHeight();
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) {
      row += String.fromCharCode(core.renderCellChar(x, y));
    }
    rows.push(row);
  }
  return rows;
}

function readBaseTiles(core) {
  const width = core.getMapWidth();
  const height = core.getMapHeight();
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

test("core-as applies move actions and renders MVP frames", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  const frameFixture = readFixture("frame-buffer-log-v1-mvp.json");
  const actionFixture = readFixture("action-sequence-v1-mvp-to-exit.json");

  core.init(1337);
  core.loadMvpScenario();

  assert.equal(core.getMapWidth(), 9);
  assert.equal(core.getMapHeight(), 9);
  assert.deepEqual(readBaseTiles(core), frameFixture.baseTiles);

  const frames = [readFrame(core)];

  for (const action of actionFixture.actions) {
    core.clearEffects();
    const packed = packMove({
      actorId: 1,
      from: action.params.from,
      to: action.params.to,
      direction: DIRECTION[action.params.direction],
      tick: action.tick,
    });
    applyMove(core, packed);
    assert.equal(core.getEffectKind(0), EFFECT_KIND.ActorMoved);
    const moved = readActorMoved(core, 0);
    assert.equal(moved.actorId, 1);
    assert.deepEqual({ x: moved.x, y: moved.y }, action.params.to);
    frames.push(readFrame(core));
  }

  assert.deepEqual(frames, frameFixture.frames.map((f) => f.buffer));
  assert.equal(core.getEffectKind(1), EFFECT_KIND.LimitReached);
});

test("core-as rejects blocked or mistimed moves without advancing state", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }

  core.init(0);
  core.loadMvpScenario();
  core.clearEffects();

  // Blocked by wall at (1,0).
  applyMove(core, packMove({
    actorId: 1,
    from: { x: 1, y: 1 },
    to: { x: 1, y: 0 },
    direction: DIRECTION.north,
    tick: 1,
  }));
  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActorBlocked);
  const blocked = readActorBlocked(core, 0);
  assert.equal(blocked.actorId, 1);
  assert.equal(blocked.reason, VALIDATION_ERROR.BlockedByWall);
  assert.deepEqual({ x: blocked.x, y: blocked.y }, { x: 1, y: 0 });
  assert.equal(core.getActorX(), 1);
  assert.equal(core.getActorY(), 1);
  assert.equal(core.getCurrentTick(), 0);

  core.clearEffects();
  // Tick mismatch (expected tick 1, supplied 0).
  applyMove(core, packMove({
    actorId: 1,
    from: { x: 1, y: 1 },
    to: { x: 2, y: 1 },
    direction: DIRECTION.east,
    tick: 0,
  }));
  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActionRejected);
  assert.equal(core.getEffectValue(0), VALIDATION_ERROR.TickMismatch);
  assert.equal(core.getActorX(), 1);
  assert.equal(core.getActorY(), 1);
});

test("core-as rejects moves when stamina is insufficient", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }

  core.init(0);
  core.loadMvpScenario();
  core.setActorVital(2, 0, 0, 0);
  core.clearEffects();

  applyMove(core, packMove({
    actorId: 1,
    from: { x: 1, y: 1 },
    to: { x: 2, y: 1 },
    direction: DIRECTION.east,
    tick: 1,
  }));

  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActionRejected);
  assert.equal(core.getEffectValue(0), VALIDATION_ERROR.InsufficientStamina);
  assert.equal(core.getActorX(), 1);
  assert.equal(core.getActorY(), 1);
  assert.equal(core.getCurrentTick(), 0);
});

test("core-as moves across large coordinates with new encoding", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }

  core.init(0);
  core.configureGrid(20, 20);
  core.setTileAt(17, 17, 1);
  core.setTileAt(18, 17, 1);
  core.spawnActorAt(17, 17);
  core.setActorVital(2, 1, 1, 0);
  core.clearEffects();

  applyMove(core, packMove({
    actorId: 1,
    from: { x: 17, y: 17 },
    to: { x: 18, y: 17 },
    direction: DIRECTION.east,
    tick: 1,
  }));

  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActorMoved);
  const moved = readActorMoved(core, 0);
  assert.equal(moved.actorId, 1);
  assert.deepEqual({ x: moved.x, y: moved.y }, { x: 18, y: 17 });
  assert.equal(core.getActorX(), 18);
  assert.equal(core.getActorY(), 17);
});

test("core-as applies emit trap damage when moving onto an affinity tile", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  if (typeof core.armStaticTrapAt !== "function") {
    t.skip("WASM binary does not expose static traps");
    return;
  }

  core.init(0);
  core.configureGrid(4, 4);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      core.setTileAt(x, y, 1);
    }
  }
  core.spawnActorAt(1, 1);
  core.setActorVital(0, 10, 10, 0); // health
  core.setActorVital(1, 0, 0, 0); // mana
  core.setActorVital(2, 8, 8, 0); // stamina
  core.setActorVital(3, 1, 1, 0); // durability
  core.armStaticTrapAt(2, 1, 1, 3, 1, 20); // fire + emit at 20% stack-one power
  core.clearEffects();

  applyMove(core, packMove({
    actorId: 1,
    from: { x: 1, y: 1 },
    to: { x: 2, y: 1 },
    direction: DIRECTION.east,
    tick: 1,
  }));

  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActorMoved);
  assert.equal(core.getActorX(), 2);
  assert.equal(core.getActorY(), 1);
  assert.equal(core.getActorVitalCurrent(0), 8);
  assert.equal(core.getEffectKind(1), EFFECT_KIND.AmbientResolved);
  const ambient = readAmbientResolved(core, 1);
  assert.equal(ambient.outcomeCode, 2);
  assert.equal(ambient.expression, 3);
  assert.equal(ambient.affinityKind, 1);
  assert.equal(ambient.targetVital, 0);
  assert.equal(ambient.delta, -2);
});

test("core-as resolves light-vs-dark ambient emit with deterministic overpower outcome", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  if (typeof core.armStaticTrapAt !== "function") {
    t.skip("WASM binary does not expose static traps");
    return;
  }

  core.init(0);
  core.configureGrid(5, 3);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      core.setTileAt(x, y, 1);
    }
  }
  core.spawnActorAt(0, 1);
  core.setActorVital(0, 10, 10, 0);
  core.setActorVital(1, 10, 10, 0);
  core.setActorVital(2, 12, 12, 0);
  core.setActorVital(3, 1, 1, 0);
  core.armStaticTrapAt(1, 1, 9, 3, 2, 25); // light emit
  core.armStaticTrapAt(2, 1, 10, 3, 4, 25); // dark emit (stronger)
  core.clearEffects();

  applyMove(core, packMove({
    actorId: 1,
    from: { x: 0, y: 1 },
    to: { x: 1, y: 1 },
    direction: DIRECTION.east,
    tick: 1,
  }));

  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActorMoved);
  assert.equal(core.getEffectKind(1), EFFECT_KIND.AmbientResolved);
  const ambient = readAmbientResolved(core, 1);
  assert.equal(ambient.outcomeCode, 2);
  assert.equal(ambient.expression, 3);
  assert.equal(ambient.affinityKind, 10);
  assert.equal(ambient.power, 5);
  assert.equal(ambient.targetVital, 1);
  assert.equal(ambient.delta, -5);
  assert.equal(core.getActorVitalCurrent(1), 5);
  assert.equal(core.getStaticTrapManaReserveAt(1, 1), 24);
  assert.equal(core.getStaticTrapManaReserveAt(2, 1), 24);
});

test("core-as ambient fire-vs-water interaction transitions as trap mana depletes", async (t) => {
  const core = await loadCoreOrSkip(t);
  if (!core) {
    return;
  }
  if (typeof core.armStaticTrapAt !== "function") {
    t.skip("WASM binary does not expose static traps");
    return;
  }

  core.init(0);
  core.configureGrid(4, 3);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      core.setTileAt(x, y, 1);
    }
  }
  core.spawnActorAt(0, 1);
  core.setActorVital(0, 10, 10, 0); // health
  core.setActorVital(1, 0, 5, 0); // mana
  core.setActorVital(2, 20, 20, 0); // stamina
  core.setActorVital(3, 1, 1, 0); // durability
  core.armStaticTrapAt(1, 1, 1, 3, 1, 10); // fire emit
  core.armStaticTrapAt(2, 1, 2, 4, 10, 2); // water draw

  core.clearEffects();
  applyMove(core, packMove({
    actorId: 1,
    from: { x: 0, y: 1 },
    to: { x: 1, y: 1 },
    direction: DIRECTION.east,
    tick: 1,
  }));
  assert.equal(core.getEffectKind(1), EFFECT_KIND.AmbientResolved);
  const firstAmbient = readAmbientResolved(core, 1);
  assert.equal(firstAmbient.outcomeCode, 3);
  assert.equal(firstAmbient.expression, 4);
  assert.equal(firstAmbient.affinityKind, 2);
  assert.equal(firstAmbient.delta, 2);
  assert.equal(core.getActorVitalCurrent(1), 2);

  core.clearEffects();
  applyMove(core, packMove({
    actorId: 1,
    from: { x: 1, y: 1 },
    to: { x: 2, y: 1 },
    direction: DIRECTION.east,
    tick: 2,
  }));
  assert.equal(core.getEffectKind(1), EFFECT_KIND.AmbientResolved);
  const secondAmbient = readAmbientResolved(core, 1);
  assert.equal(secondAmbient.outcomeCode, 1);
  assert.equal(secondAmbient.delta, 0);
  assert.equal(core.getStaticTrapManaReserveAt(2, 1), 0);

  core.clearEffects();
  applyMove(core, packMove({
    actorId: 1,
    from: { x: 2, y: 1 },
    to: { x: 1, y: 1 },
    direction: DIRECTION.west,
    tick: 3,
  }));
  assert.equal(core.getEffectKind(1), EFFECT_KIND.AmbientResolved);
  const thirdAmbient = readAmbientResolved(core, 1);
  assert.equal(thirdAmbient.outcomeCode, 2);
  assert.equal(thirdAmbient.expression, 3);
  assert.equal(thirdAmbient.affinityKind, 1);
  assert.equal(thirdAmbient.targetVital, 0);
  assert.equal(thirdAmbient.delta, -1);
  assert.equal(core.getActorVitalCurrent(0), 9);
});
