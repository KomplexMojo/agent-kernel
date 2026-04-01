const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const bindingsModule = moduleUrl("packages/bindings-ts/src/mvp-movement.js");

test("readObservation includes static traps exposed directly by core", () => {
  const script = `
import assert from "node:assert/strict";
import { readObservation } from ${JSON.stringify(bindingsModule)};

const core = {
  getMapWidth() { return 3; },
  getMapHeight() { return 3; },
  getActorX() { return 1; },
  getActorY() { return 1; },
  getActorKind() { return 2; },
  getActorVitalCurrent() { return 1; },
  getActorVitalMax() { return 1; },
  getActorVitalRegen() { return 0; },
  getTileActorKind(x, y) { return x === 0 && y === 0 ? 1 : 0; },
  getCurrentTick() { return 0; },
  getTileActorCount() { return 0; },
  getStaticTrapAffinityAt(x, y) { return x === 1 && y === 1 ? 1 : 0; },
  getStaticTrapExpressionAt() { return 4; },
  getStaticTrapStacksAt() { return 2; },
  getStaticTrapManaReserveAt() { return 5; },
  getAmbientOutcomeCode() { return 3; },
  getAmbientOutcomeAffinityKind() { return 2; },
  getAmbientOutcomeExpression() { return 4; },
  getAmbientOutcomePower() { return 2; },
  getAmbientOutcomeTargetVital() { return 1; },
  getAmbientOutcomeDelta() { return 2; },
};

const obs = readObservation(core, { actorIdLabel: "actor_mvp" });
assert.ok(Array.isArray(obs.traps));
assert.equal(obs.traps.length, 1);
assert.deepEqual(obs.traps[0].position, { x: 1, y: 1 });
assert.equal(obs.traps[0].manaReserve, 5);
assert.deepEqual(obs.traps[0].affinities, [
  { kind: "fire", expression: "draw", stacks: 2, targetType: "floor" },
]);
assert.deepEqual(obs.ambientField, {
  outcome: "draw",
  affinityKind: "water",
  expression: "draw",
  targetVital: "mana",
  power: 2,
  delta: 2,
});
`;
  runEsm(script);
});
