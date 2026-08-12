const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("bindings expose MVP movement helpers and stable shapes", async () => {
  const {
    applyMoveAction,
    createCore,
    packMoveAction,
    unpackMoveAction,
    renderBaseTiles,
    renderFrameBuffer,
    readObservation,
  } = await import("../../packages/core-ts/src/index.ts");

  const frameFixture = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/artifacts/frame-buffer-log-v1-mvp.json"), "utf8"));
  const actionFixture = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json"), "utf8"));
  const barrierFrameFixture = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/artifacts/frame-buffer-log-v1-mvp-barrier.json"), "utf8"));
  const expectedLegend = { ...frameFixture.legend, barrier: "B" };
  const expectedBarrierBaseTiles = barrierFrameFixture.baseTiles.map((row) => Array.isArray(row) ? row.join("") : row);

  const core = createCore();
  core.init(1337);
  core.loadMvpScenario();

  const directionCases = [
    ["north", 0],
    ["northeast", 1],
    ["east", 2],
    ["southeast", 3],
    ["south", 4],
    ["southwest", 5],
    ["west", 6],
    ["northwest", 7],
  ];

  for (const [direction, code] of directionCases) {
    const packed = packMoveAction({
      actorId: 7,
      from: { x: 4, y: 4 },
      to: { x: 5, y: 4 },
      direction,
      tick: 8,
    });
    assert.equal(packed[5], code);
    const decoded = unpackMoveAction(packed);
    assert.equal(decoded.direction, direction);
  }

  const largePacked = packMoveAction({
    actorId: 12345,
    from: { x: 512, y: 513 },
    to: { x: 900, y: 1000 },
    direction: "east",
    tick: 9999,
  });
  const largeDecoded = unpackMoveAction(largePacked);
  assert.equal(largeDecoded.actorId, 12345);
  assert.equal(largeDecoded.direction, "east");
  assert.deepEqual(largeDecoded.from, { x: 512, y: 513 });
  assert.deepEqual(largeDecoded.to, { x: 900, y: 1000 });
  assert.equal(largeDecoded.tick, 9999);

  // Observation shape and base map metadata.
  const obs0 = readObservation(core);
  assert.equal(obs0.tick, 0);
  assert.equal(obs0.actors.length, 1);
  assert.deepEqual(obs0.actors[0].position, { x: 1, y: 1 });
  assert.deepEqual(obs0.actors[0].vitals.health, { current: 10, max: 10, regen: 0 });
  assert.deepEqual(obs0.actors[0].capabilities, { movementCost: 1, actionCostMana: 0, actionCostStamina: 0 });
  assert.equal(obs0.actors[0].kind, 2);
  assert.deepEqual(obs0.tiles.kinds, [
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0, 0, 0, 1, 0, 1, 0, 1],
    [1, 0, 1, 0, 0, 0, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1, 0, 1, 1, 1],
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1],
  ]);
  assert.deepEqual(renderBaseTiles(core), frameFixture.baseTiles);

  // Frame rendering and move packing mirror fixtures.
  const frame0 = renderFrameBuffer(core);
  assert.deepEqual(frame0.baseTiles, frameFixture.baseTiles);
  assert.deepEqual(frame0.legend, expectedLegend);
  const frames = [frame0.buffer];
  for (const action of actionFixture.actions) {
    const packed = packMoveAction({
      actorId: action.actorId === "actor_mvp" ? 1 : 0,
      from: action.params.from,
      to: action.params.to,
      direction: action.params.direction,
      tick: action.tick,
    });
    const decoded = unpackMoveAction(packed);
    assert.equal(decoded.direction, action.params.direction);
    assert.deepEqual(decoded.from, action.params.from);
    assert.deepEqual(decoded.to, action.params.to);
    assert.equal(decoded.tick, action.tick);
    applyMoveAction(core, packed);
    frames.push(renderFrameBuffer(core).buffer);
  }

  assert.deepEqual(frames, frameFixture.frames.map((f) => f.buffer));

  // Barrier map rendering includes barrier glyphs and overlayed actor.
  core.loadMvpBarrierScenario();
  const barrierFrame = renderFrameBuffer(core);
  assert.deepEqual(barrierFrame.baseTiles, expectedBarrierBaseTiles);
  assert.deepEqual(barrierFrame.legend, expectedLegend);
  assert.deepEqual(barrierFrame.actorPositions, barrierFrameFixture.frames[0].actorPositions);
  assert.equal(barrierFrame.tick, barrierFrameFixture.frames[0].tick);
  assert.deepEqual(barrierFrame.buffer, barrierFrameFixture.frames[0].buffer);
});
