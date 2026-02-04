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
