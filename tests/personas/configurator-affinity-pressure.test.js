const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/configurator/affinity-pressure.js");

test("ambient affinity pressure computes base and opposed net pressure", () => {
  const script = `
import assert from "node:assert/strict";
import { buildAmbientAffinityPressure } from ${JSON.stringify(modulePath)};

const pressure = buildAmbientAffinityPressure({
  rooms: [
    {
      id: "R1",
      affinities: [
        { kind: "fire", expression: "emit", stacks: 3 },
        { kind: "life", expression: "emit", stacks: 2 },
      ],
    },
    {
      id: "R2",
      affinities: [
        { kind: "water", expression: "emit", stacks: 1 },
        { kind: "decay", expression: "emit", stacks: 5 },
      ],
    },
  ],
  traps: [
    {
      x: 2,
      y: 2,
      affinity: { kind: "fire", expression: "push", stacks: 2 },
    },
  ],
});

assert.equal(pressure.baseByKind.fire, 5);
assert.equal(pressure.baseByKind.water, 1);
assert.equal(pressure.baseByKind.life, 2);
assert.equal(pressure.baseByKind.decay, 5);

assert.equal(pressure.netByKind.fire, 4);
assert.equal(pressure.netByKind.water, 0);
assert.equal(pressure.netByKind.life, 0);
assert.equal(pressure.netByKind.decay, 3);

const fireWater = pressure.cancellations.find((entry) => {
  return (entry.kind === "fire" && entry.opposite === "water")
    || (entry.kind === "water" && entry.opposite === "fire");
});
assert.ok(fireWater);
assert.equal(fireWater.canceled, 1);

const lifeDecay = pressure.cancellations.find((entry) => {
  return (entry.kind === "life" && entry.opposite === "decay")
    || (entry.kind === "decay" && entry.opposite === "life");
});
assert.ok(lifeDecay);
assert.equal(lifeDecay.canceled, 2);
`;
  runEsm(script);
});

