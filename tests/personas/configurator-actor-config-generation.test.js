const test = require("node:test");
const assert = require("node:assert/strict");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/configurator/actor-config-generation.js");

const script = `
import assert from "node:assert/strict";
import { calculateActorCost, buildActorCatalogFromConfig } from ${JSON.stringify(modulePath)};

{
  const result = calculateActorCost({
    vitals: { health: 100, mana: 20, stamina: 10, durability: 5 },
    regen: { health: 1, mana: 2, stamina: 0 },
    affinityStacks: 2,
  });
  assert.equal(result.ok, true);
  assert.equal(result.cost, 157);
  assert.deepEqual(result.detail, { vitalPoints: 135, regenPoints: 3, affinityStacks: 2 });
}

{
  const catalog = buildActorCatalogFromConfig({
    roles: [
      {
        motivation: "attacking",
        subType: "dynamic",
        vitals: { health: 80, mana: 20, stamina: 20 },
        regen: { health: 1, mana: 1 },
        tags: ["monster"],
      },
    ],
    affinities: [{ kind: "fire", stacks: 2 }, { kind: "wind", stacks: 1 }],
  });
  assert.equal(catalog.ok, true);
  assert.equal(catalog.entries.length, 2);
  assert.equal(catalog.entries[0].cost, 140);
  assert.equal(catalog.entries[0].id, "actor_attacking_fire_140");
  assert.equal(catalog.entries[1].cost, 128);
  assert.equal(catalog.entries[1].id, "actor_attacking_wind_128");
}

{
  const catalog = buildActorCatalogFromConfig({
    roles: [
      {
        motivation: "defending",
        subType: "dynamic",
        vitals: { health: 50 },
        regen: { health: 1 },
      },
    ],
    affinities: ["earth"],
  });
  assert.equal(catalog.ok, false);
  assert.ok(catalog.errors.some((err) => err.code === "affinity_requires_mana"));
}
`;

test("actor config generation cost calculation and validation", () => {
  runEsm(script);
});
