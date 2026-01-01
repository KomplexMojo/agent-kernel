const test = require("node:test");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const BINDINGS_MODULE = moduleUrl("packages/bindings-ts/src/index.js");
const ACTOR_MODULE = moduleUrl("packages/runtime/src/personas/actor/persona.js");
const TICK_MODULE = moduleUrl("packages/runtime/src/personas/_shared/tick-state-machine.js");
const WASM_URL = moduleUrl("build/core-as.wasm");

test("runtime maps actor proposals to core actions and replays deterministically", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }

  const script = `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadCore, packMoveAction, renderFrameBuffer, renderBaseTiles, readObservation } from ${JSON.stringify(BINDINGS_MODULE)};
import { createActorPersona } from ${JSON.stringify(ACTOR_MODULE)};
import { TickPhases } from ${JSON.stringify(TICK_MODULE)};

const wasmUrl = new URL(${JSON.stringify(WASM_URL)});
const core = await loadCore({ wasmUrl });
core.init(1337);
core.loadMvpScenario();
core.clearEffects?.();

const actionFixture = JSON.parse(await readFile(path.resolve("tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json"), "utf8"));
const frameFixture = JSON.parse(await readFile(path.resolve("tests/fixtures/artifacts/frame-buffer-log-v1-mvp.json"), "utf8"));

const actorIdLabel = "actor_mvp";
const actorIdValue = 1;
const persona = createActorPersona({ clock: () => "fixed" });
const actions = [];
const frames = [renderFrameBuffer(core, { actorIdLabel })];
const baseTiles = renderBaseTiles(core);

for (let i = 0; i < actionFixture.actions.length; i += 1) {
  const obs = readObservation(core, { actorIdLabel });
  const tick = obs.tick + 1;
  persona.advance({
    phase: TickPhases.OBSERVE,
    event: "observe",
    payload: { actorId: actorIdLabel, observation: obs, baseTiles },
    tick,
  });
  persona.advance({
    phase: TickPhases.DECIDE,
    event: "decide",
    payload: { actorId: actorIdLabel },
    tick,
  });
  const result = persona.advance({
    phase: TickPhases.DECIDE,
    event: "propose",
    payload: { actorId: actorIdLabel },
    tick,
  });
  assert.equal(result.actions.length, 1);
  const action = result.actions[0];
  actions.push(action);
  const packed = packMoveAction({
    actorId: actorIdValue,
    from: action.params.from,
    to: action.params.to,
    direction: action.params.direction,
    tick: action.tick,
  });
  core.applyAction(8, packed);
  core.clearEffects?.();
  frames.push(renderFrameBuffer(core, { actorIdLabel }));
  persona.advance({
    phase: TickPhases.DECIDE,
    event: "cooldown",
    payload: { actorId: actorIdLabel },
    tick,
  });
}

const normalized = actions.map(({ personaRef, ...rest }) => rest);
assert.deepEqual(normalized, actionFixture.actions);
assert.deepEqual(frames.map((frame) => frame.buffer), frameFixture.frames.map((frame) => frame.buffer));
`;

  runEsm(script);
});

test("runtime filters non-motivated proposals before packing actions", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }

  const script = `
import assert from "node:assert/strict";
import { loadCore, packMoveAction, renderFrameBuffer, renderBaseTiles, readObservation } from ${JSON.stringify(BINDINGS_MODULE)};
import { createActorPersona } from ${JSON.stringify(ACTOR_MODULE)};
import { TickPhases } from ${JSON.stringify(TICK_MODULE)};

const wasmUrl = new URL(${JSON.stringify(WASM_URL)});
const core = await loadCore({ wasmUrl });
core.init(1337);
core.loadMvpScenario();
core.clearEffects?.();

const actorIdLabel = "actor_mvp";
const actorIdValue = 1;
const baseTiles = renderBaseTiles(core);
const obs = readObservation(core, { actorIdLabel });
const observation = {
  ...obs,
  actors: [
    { ...obs.actors[0], kind: 2 },
    { id: "tile_wall", kind: 0, position: { x: 0, y: 0 } },
    { id: "tile_barrier", kind: 1, position: { x: 2, y: 0 } },
  ],
};

const persona = createActorPersona({ clock: () => "fixed" });
const tick = obs.tick + 1;
persona.advance({
  phase: TickPhases.OBSERVE,
  event: "observe",
  payload: { actorId: actorIdLabel, observation, baseTiles },
  tick,
});
persona.advance({
  phase: TickPhases.DECIDE,
  event: "decide",
  payload: { actorId: actorIdLabel },
  tick,
});
const result = persona.advance({
  phase: TickPhases.DECIDE,
  event: "propose",
  payload: {
    actorId: actorIdLabel,
    proposals: [
      { actorId: "tile_wall", kind: "custom_action", params: { label: "wall" } },
      { actorId: actorIdLabel, kind: "move", params: { direction: "east", from: { x: 1, y: 1 }, to: { x: 2, y: 1 } } },
      { actorId: "tile_barrier", kind: "custom_action", params: { label: "barrier" } },
    ],
  },
  tick,
});

assert.deepEqual(result.actions.map((action) => action.kind), ["move"]);
result.actions.forEach((action) => assert.equal(action.actorId, actorIdLabel));

const action = result.actions[0];
const packed = packMoveAction({
  actorId: actorIdValue,
  from: action.params.from,
  to: action.params.to,
  direction: action.params.direction,
  tick: action.tick,
});
core.applyAction(8, packed);
core.clearEffects?.();

const frame = renderFrameBuffer(core, { actorIdLabel });
assert.equal(frame.actorPositions[actorIdLabel].x, 2);
assert.equal(frame.actorPositions[actorIdLabel].y, 1);
`;

  runEsm(script);
});
