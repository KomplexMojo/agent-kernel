const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

const simConfig = readFixture("sim-config-artifact-v1-mvp-grid.json");
const initialState = readFixture("initial-state-artifact-v1-mvp-actor.json");
const actionSequence = readFixture("action-sequence-v1-mvp-to-exit.json");
const frameBufferLog = readFixture("frame-buffer-log-v1-mvp.json");

function coordsEqual(a, b) {
  assert.deepEqual(a, b);
}

test("mvp sim config defines a deterministic 9x9 grid with spawn/exit and palette", () => {
  const data = simConfig.layout.data;
  assert.equal(simConfig.schema, "agent-kernel/SimConfigArtifact");
  assert.equal(data.width, 9);
  assert.equal(data.height, 9);
  coordsEqual(data.spawn, { x: 1, y: 1 });
  coordsEqual(data.exit, { x: 7, y: 7 });
  assert.deepEqual(Object.keys(data.legend).sort(), ["#", ".", "E", "S"].sort());
  assert.equal(data.render.actor, "@");
  assert.equal(data.tiles[data.exit.y][data.exit.x], "E");
});

test("initial actor defaults live on the spawn tile with vitals stub", () => {
  const actor = initialState.actors[0];
  assert.equal(actor.id, "actor_mvp");
  assert.equal(actor.kind, "ambulatory");
  coordsEqual(actor.position, simConfig.layout.data.spawn);
  assert.equal(actor.traits.hp, 10);
  assert.equal(actor.traits.maxHp, 10);
  assert.equal(actor.traits.speed, 1);
});

test("action sequence walks the MVP maze to the exit in deterministic ticks", () => {
  const actions = actionSequence.actions;
  assert.equal(actionSequence.schema, "agent-kernel/ActionSequence");
  assert.equal(actions.length, 12);
  actions.forEach((action, index) => {
    assert.equal(action.actorId, "actor_mvp");
    assert.equal(action.tick, index + 1);
  });
  assert.deepEqual(
    actions.map((a) => a.params.direction),
    ["east", "east", "south", "south", "east", "east", "south", "south", "south", "south", "east", "east"]
  );
  coordsEqual(actions[0].params.from, simConfig.layout.data.spawn);
  coordsEqual(actions.at(-1).params.to, simConfig.layout.data.exit);
});

test("frame buffers mirror the action path and keep map metadata in sync", () => {
  assert.equal(frameBufferLog.schema, "agent-kernel/FrameBufferLog");
  assert.deepEqual(frameBufferLog.baseTiles, simConfig.layout.data.tiles);
  assert.deepEqual(frameBufferLog.legend, simConfig.layout.data.render);

  const expectedPositions = [
    simConfig.layout.data.spawn,
    ...actionSequence.actions.map((a) => a.params.to),
  ];

  frameBufferLog.frames.forEach((frame, index) => {
    const expected = expectedPositions[index];
    coordsEqual(frame.actorPositions.actor_mvp, expected);
    assert.equal(frame.buffer[expected.y][expected.x], frameBufferLog.legend.actor);
    frame.buffer.forEach((row) => assert.equal(row.length, simConfig.layout.data.width));
  });

  coordsEqual(frameBufferLog.frames.at(-1).actorPositions.actor_mvp, simConfig.layout.data.exit);
});
