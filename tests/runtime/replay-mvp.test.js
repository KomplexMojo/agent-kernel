const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { readFixture } = require("../helpers/fixtures");
const { loadCoreFromWasmPath } = require("../helpers/core-loader");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const ACTION_KIND_MOVE = 8;

const DIRECTION = Object.freeze({
  east: 1,
  south: 2,
  west: 3,
  north: 0,
});

function applyMove(core, { actorId, from, to, direction, tick }) {
  core.setMoveAction(actorId, from.x, from.y, to.x, to.y, DIRECTION[direction], tick);
  core.applyAction(ACTION_KIND_MOVE, 0);
}

function renderFrame(core) {
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

test("replay produces golden frames for MVP action log", async (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const core = await loadCoreFromWasmPath(WASM_PATH);
  const actions = readFixture("action-sequence-v1-mvp-to-exit.json").actions;
  const frameFixture = readFixture("frame-buffer-log-v1-mvp.json");

  core.init(1337);
  core.loadMvpScenario();
  const frames = [renderFrame(core)];

  for (const action of actions) {
    applyMove(core, {
      actorId: 1,
      from: action.params.from,
      to: action.params.to,
      direction: action.params.direction,
      tick: action.tick,
    });
    core.clearEffects();
    frames.push(renderFrame(core));
  }

  assert.deepEqual(frames, frameFixture.frames.map((f) => f.buffer));
});

test("replay mismatch is detected when actions diverge", async (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }
  const core = await loadCoreFromWasmPath(WASM_PATH);
  const actions = readFixture("action-sequence-v1-mvp-to-exit.json").actions.map((a) => JSON.parse(JSON.stringify(a)));

  // Introduce divergence on the last step.
  actions[actions.length - 1].params.to = { x: 2, y: 2 };
  actions[actions.length - 1].params.direction = "west";

  core.init(1337);
  core.loadMvpScenario();
  const frames = [renderFrame(core)];
  for (const action of actions) {
    applyMove(core, {
      actorId: 1,
      from: action.params.from,
      to: action.params.to,
      direction: action.params.direction,
      tick: action.tick,
    });
    core.clearEffects();
    frames.push(renderFrame(core));
  }

  const golden = readFixture("frame-buffer-log-v1-mvp.json").frames.map((f) => f.buffer);
  assert.notDeepEqual(frames, golden);
});
