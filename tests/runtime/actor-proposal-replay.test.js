// #158 triage: stays here (not tests/personas/actor/) — it asserts on how the RUNTIME maps actor
// proposals to core-ts actions and replays them deterministically, not on the Actor persona's own
// proposal-generation logic in isolation. Runtime-to-core orchestration, not persona-alone behavior.
//
// Leftover ActionV1 shape: Actor proposes params.target (not from/to/direction). Filter oracle uses
// unified eligibility (defeated/unknown), not leftover tile_wall/tile_barrier kinds.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

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

test("runtime maps actor proposals to core actions and replays deterministically", async () => {
  const [bindings, actorMod, tickMod] = await Promise.all([
    import("../../packages/core-ts/src/index.ts"),
    import("../../packages/runtime/src/personas/actor/persona.js"),
    import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);

  const { applyMoveAction, createCore, packMoveAction, renderFrameBuffer, renderBaseTiles, readObservation } = bindings;
  const { createActorPersona } = actorMod;
  const { TickPhases } = tickMod;

  const core = createCore();
  core.init(1337);
  core.loadMvpScenario();
  core.clearEffects?.();

  const actionFixture = JSON.parse(readFileSync(resolve("tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json"), "utf8"));
  const frameFixture = JSON.parse(readFileSync(resolve("tests/fixtures/artifacts/frame-buffer-log-v1-mvp.json"), "utf8"));

  const actorIdLabel = "actor_mvp";
  const actorIdValue = 1;
  const persona = createActorPersona({ clock: () => "fixed" });
  const actions = [];
  const frames = [renderFrameBuffer(core, { actorIdLabel })];
  const baseTiles = renderBaseTiles(core);

  for (let i = 0; i < actionFixture.actions.length; i += 1) {
    const obs = readObservation(core, { actorIdLabel });
    const tick = obs.tick + 1;
    const payload = { actorId: actorIdLabel, observation: obs, baseTiles };
    persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick });
    persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick });
    const result = persona.advance({
      phase: TickPhases.DECIDE,
      event: "propose",
      payload,
      tick,
    });
    assert.equal(result.actions.length, 1);
    const action = result.actions[0];
    assert.equal(action.kind, "move");
    assert.ok(action.params?.target, "unified move carries params.target");
    actions.push(action);

    const from = obs.actors.find((entry) => entry.id === actorIdLabel)?.position;
    assert.ok(from, "observation must include actor_mvp position");
    const to = action.params.target;
    const direction = directionBetween(from, to);
    assert.ok(direction, `expected adjacent step from ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
    const packed = packMoveAction({
      actorId: actorIdValue,
      from,
      to,
      direction,
      tick: action.tick,
    });
    applyMoveAction(core, packed);
    core.advanceTick();
    core.clearEffects?.();
    frames.push(renderFrameBuffer(core, { actorIdLabel }));
    persona.advance({ phase: TickPhases.DECIDE, event: "cooldown", payload, tick });
  }

  const expected = actionFixture.actions.map((action) => ({
    schema: action.schema,
    schemaVersion: action.schemaVersion,
    actorId: action.actorId,
    tick: action.tick,
    kind: action.kind,
    params: { target: action.params.to },
  }));
  const normalized = actions.map(({ personaRef, ...rest }) => rest);
  assert.deepEqual(normalized, expected);
  assert.deepEqual(frames.map((frame) => frame.buffer), frameFixture.frames.map((frame) => frame.buffer));
});

test("runtime filters non-eligible proposals before packing actions", async () => {
  const [bindings, actorMod, tickMod] = await Promise.all([
    import("../../packages/core-ts/src/index.ts"),
    import("../../packages/runtime/src/personas/actor/persona.js"),
    import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);

  const { applyMoveAction, createCore, packMoveAction, renderFrameBuffer, renderBaseTiles, readObservation } = bindings;
  const { createActorPersona } = actorMod;
  const { TickPhases } = tickMod;

  const core = createCore();
  core.init(1337);
  core.loadMvpScenario();
  core.clearEffects?.();

  const actorIdLabel = "actor_mvp";
  const actorIdValue = 1;
  const baseTiles = renderBaseTiles(core);
  const obs = readObservation(core, { actorIdLabel });
  // Unified eligibility: defeated actors and unknown ids are dropped. Leftover
  // tile_wall/tile_barrier kinds are not the filter surface anymore.
  const observation = {
    ...obs,
    actors: [
      { ...obs.actors[0] },
      { id: "defeated_1", lifecycle: "defeated", position: { x: 0, y: 0 } },
    ],
  };

  const persona = createActorPersona({ clock: () => "fixed" });
  const tick = obs.tick + 1;
  const base = { actorId: actorIdLabel, observation, baseTiles };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: base, tick });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: base, tick });
  const result = persona.advance({
    phase: TickPhases.DECIDE,
    event: "propose",
    payload: {
      ...base,
      proposals: [
        { actorId: "defeated_1", kind: "custom_action", params: { label: "dead" } },
        { actorId: actorIdLabel, kind: "move", params: { target: { x: 2, y: 1 } } },
      ],
    },
    tick,
  });

  assert.deepEqual(result.actions.map((action) => action.kind), ["move"]);
  result.actions.forEach((action) => assert.equal(action.actorId, actorIdLabel));

  const action = result.actions[0];
  const from = obs.actors.find((entry) => entry.id === actorIdLabel)?.position;
  const to = action.params.target;
  const packed = packMoveAction({
    actorId: actorIdValue,
    from,
    to,
    direction: directionBetween(from, to),
    tick: action.tick,
  });
  applyMoveAction(core, packed);
  core.clearEffects?.();

  const frame = renderFrameBuffer(core, { actorIdLabel });
  assert.equal(frame.actorPositions[actorIdLabel].x, 2);
  assert.equal(frame.actorPositions[actorIdLabel].y, 1);
});
