const test = require("node:test");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const bindingsModule = moduleUrl("packages/bindings-ts/src/index.js");
const wasmUrl = moduleUrl("build/core-as.wasm");

const script = `
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  loadCore,
  packMoveAction,
  unpackMoveAction,
  renderBaseTiles,
  renderFrameBuffer,
  readObservation,
} from ${JSON.stringify(bindingsModule)};

const wasmUrl = new URL(${JSON.stringify(wasmUrl)});
const frameFixture = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/artifacts/frame-buffer-log-v1-mvp.json"), "utf8"));
const actionFixture = JSON.parse(fs.readFileSync(path.resolve("tests/fixtures/artifacts/action-sequence-v1-mvp-to-exit.json"), "utf8"));

const core = await loadCore({ wasmUrl });
core.init(1337);
core.loadMvpScenario();

// Observation shape and base map metadata.
const obs0 = readObservation(core);
assert.deepEqual(obs0.actor, { id: "actor_mvp", x: 1, y: 1, hp: 10, maxHp: 10 });
assert.equal(obs0.tick, 0);
assert.deepEqual(renderBaseTiles(core), frameFixture.baseTiles);

// Frame rendering and move packing mirror fixtures.
const frames = [renderFrameBuffer(core).buffer];
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
  core.applyAction(8, packed);
  frames.push(renderFrameBuffer(core).buffer);
}

assert.deepEqual(frames, frameFixture.frames.map((f) => f.buffer));
`;

test("bindings expose MVP movement helpers and stable shapes", () => {
  runEsm(script);
});
