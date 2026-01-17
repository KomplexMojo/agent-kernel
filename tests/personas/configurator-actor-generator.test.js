const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/configurator/actor-generator.js");

test("actor generator emits stable, diverse, bounded actors", () => {
  const script = `
import assert from "node:assert/strict";
import { generateActorSet } from ${JSON.stringify(modulePath)};

const result = generateActorSet({
  count: 24,
  width: 40,
  height: 30,
  seed: 42,
});

assert.equal(result.ok, true);
assert.deepEqual(result.errors, []);
assert.equal(result.actors.length, 24);

const resultAgain = generateActorSet({
  count: 24,
  width: 40,
  height: 30,
  seed: 42,
});
assert.deepEqual(resultAgain.actors, result.actors);

const ids = result.actors.map((actor) => actor.id);
assert.equal(new Set(ids).size, ids.length);
assert.equal(ids[0], "actor_1");
assert.equal(ids[ids.length - 1], "actor_24");

const positions = new Set();
result.actors.forEach((actor) => {
  assert.ok(actor.position.x >= 0 && actor.position.x < 40);
  assert.ok(actor.position.y >= 0 && actor.position.y < 30);
  positions.add(\`\${actor.position.x},\${actor.position.y}\`);
});
assert.equal(positions.size, result.actors.length);

const affinityKinds = new Set(result.actors.map((actor) => actor.affinities[0].kind));
const expressions = new Set(result.actors.map((actor) => actor.affinities[0].expression));
const motivations = new Set(result.actors.map((actor) => actor.motivations[0].kind));
assert.ok(affinityKinds.size >= 3);
assert.ok(expressions.size >= 3);
assert.ok(motivations.size >= 3);
`;
  runEsm(script);
});
