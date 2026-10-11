const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

const ACTION_KIND_MOVE = 8;

const DIRECTION = Object.freeze({
  north: 0,
  northeast: 1,
  east: 2,
  southeast: 3,
  south: 4,
  southwest: 5,
  west: 6,
  northwest: 7,
});

async function createCore() {
  const coreModule = await import("../../packages/core-ts/src/index.ts");
  return coreModule.createCore();
}

function directionBetween(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const map = {
    "0,-1": "north",
    "1,-1": "northeast",
    "1,0": "east",
    "1,1": "southeast",
    "0,1": "south",
    "-1,1": "southwest",
    "-1,0": "west",
    "-1,-1": "northwest",
  };
  return map[`${dx},${dy}`] || null;
}

function applyMove(core, { actorId, from, to, direction, tick }) {
  core.setMoveAction(actorId, from.x, from.y, to.x, to.y, DIRECTION[direction], tick);
  core.applyAction(ACTION_KIND_MOVE, 0);
  // AM.3 — a move no longer advances the core tick (rules/move.ts commitMove);
  // whoever drives the simulation closes the tick. This replay applies one
  // action per tick, so it advances once per action. The golden fixture is
  // unchanged: the cadence it encodes is the same, only the caller moved.
  core.advanceTick();
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

test("replay produces golden frames for MVP action log", async () => {
  const core = await createCore();
  const actions = readFixture("action-sequence-v1-mvp-to-exit.json").actions;
  const frameFixture = readFixture("frame-buffer-log-v1-mvp.json");

  core.init(1337);
  core.loadMvpScenario();
  const frames = [renderFrame(core)];
  let from = { x: core.getActorX(), y: core.getActorY() };

  for (const action of actions) {
    const to = action.params.target;
    applyMove(core, {
      actorId: 1,
      from,
      to,
      direction: directionBetween(from, to),
      tick: action.tick,
    });
    from = to;
    core.clearEffects();
    frames.push(renderFrame(core));
  }

  assert.deepEqual(frames, frameFixture.frames.map((f) => f.buffer));
});

test("replay mismatch is detected when actions diverge", async () => {
  const core = await createCore();
  const actions = readFixture("action-sequence-v1-mvp-to-exit.json").actions.map((a) => JSON.parse(JSON.stringify(a)));

  actions[actions.length - 1].params.target = { x: 6, y: 6 };

  core.init(1337);
  core.loadMvpScenario();
  const frames = [renderFrame(core)];
  let from = { x: core.getActorX(), y: core.getActorY() };
  for (const action of actions) {
    const to = action.params.target;
    applyMove(core, {
      actorId: 1,
      from,
      to,
      direction: directionBetween(from, to),
      tick: action.tick,
    });
    from = to;
    core.clearEffects();
    frames.push(renderFrame(core));
  }

  const golden = readFixture("frame-buffer-log-v1-mvp.json").frames.map((f) => f.buffer);
  assert.notDeepEqual(frames, golden);
});
