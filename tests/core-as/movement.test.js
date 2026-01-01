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
  return (
    ((actorId & 0xf) << 28) |
    ((tick & 0xff) << 20) |
    ((to.y & 0xf) << 16) |
    ((to.x & 0xf) << 12) |
    ((from.y & 0xf) << 8) |
    ((from.x & 0xf) << 4) |
    (direction & 0xf)
  );
}

function decodePosition(value) {
  return {
    x: value & 0xffff,
    y: value >>> 16,
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

  assert.equal(core.getMapWidth(), 5);
  assert.equal(core.getMapHeight(), 5);
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
    core.applyAction(ACTION_KIND.Move, packed);
    assert.equal(core.getEffectKind(0), EFFECT_KIND.ActorMoved);
    const pos = decodePosition(core.getEffectValue(0));
    assert.deepEqual(pos, action.params.to);
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
  core.applyAction(
    ACTION_KIND.Move,
    packMove({
      actorId: 1,
      from: { x: 1, y: 1 },
      to: { x: 1, y: 0 },
      direction: DIRECTION.north,
      tick: 1,
    })
  );
  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActionRejected);
  assert.equal(core.getEffectValue(0), VALIDATION_ERROR.BlockedByWall);
  assert.equal(core.getActorX(), 1);
  assert.equal(core.getActorY(), 1);
  assert.equal(core.getCurrentTick(), 0);

  core.clearEffects();
  // Tick mismatch (expected tick 1, supplied 0).
  core.applyAction(
    ACTION_KIND.Move,
    packMove({
      actorId: 1,
      from: { x: 1, y: 1 },
      to: { x: 2, y: 1 },
      direction: DIRECTION.east,
      tick: 0,
    })
  );
  assert.equal(core.getEffectKind(0), EFFECT_KIND.ActionRejected);
  assert.equal(core.getEffectValue(0), VALIDATION_ERROR.TickMismatch);
  assert.equal(core.getActorX(), 1);
  assert.equal(core.getActorY(), 1);
});
