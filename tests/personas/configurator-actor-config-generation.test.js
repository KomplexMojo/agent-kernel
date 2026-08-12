const assert = require("node:assert/strict");

test("actor config generation cost calculation and validation", async () => {
  const { calculateActorCost, buildActorCatalogFromConfig } = await import(
    "../../packages/runtime/src/personas/configurator/actor-config-generation.js"
  );

  {
    const result = calculateActorCost({
      vitals: { health: 100, mana: 20, stamina: 10, durability: 5 },
      regen: { health: 1, mana: 2, stamina: 0 },
      affinityStacks: 2,
    });
    assert.equal(result.ok, true);
    assert.equal(result.cost, 350);
    assert.equal(result.detail.vitalPoints, 135);
    assert.equal(result.detail.regenPoints, 3);
    assert.equal(result.detail.affinityStacks, 2);
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
      affinities: [
        { kind: "fire", stacks: 2, expression: "push" },
        { kind: "wind", stacks: 1, expression: "push" },
      ],
    });
    assert.equal(catalog.ok, true);
    assert.equal(catalog.entries.length, 2);
    assert.equal(catalog.entries[0].cost, 182);
    assert.equal(catalog.entries[0].id, "actor_attacking_fire_182");
    assert.equal(catalog.entries[1].cost, 164);
    assert.equal(catalog.entries[1].id, "actor_attacking_wind_164");
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
    assert.ok(catalog.errors.some((err) => err.code === "affinity_missing_stack_and_expression"));
  }
});
