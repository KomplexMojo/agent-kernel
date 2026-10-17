const assert = require("node:assert/strict");

test("resolveAffinityEffects computes hazard vitals from expression and stacks when not provided", async () => {
  const { resolveAffinityEffects } = await import(
    "../../../packages/runtime/src/personas/configurator/affinity-effects.js"
  );

  // Test emit expression with stacks=2
  {
    const result = resolveAffinityEffects({
      presets: [],
      hazards: [
        {
          x: 2, y: 2, blocking: false,
          affinity: { kind: "fire", expression: "emit", stacks: 2 },
        },
      ],
    });

    assert.equal(result.hazards.length, 1);
    const hazard = result.hazards[0];
    // Upkeep 2 + range 2 + intensity 1 = 5 (#340): a pool of three ticks, regen sustains it.
    assert.equal(hazard.vitals.mana.current, 15);
    assert.equal(hazard.vitals.mana.max, 15);
    assert.equal(hazard.vitals.mana.regen, 5);
    assert.equal(hazard.vitals.durability.current, 10);
    assert.equal(hazard.vitals.durability.max, 10);
    assert.equal(hazard.vitals.durability.regen, 0);
  }

  // Test push expression with stacks=2
  {
    const result = resolveAffinityEffects({
      presets: [],
      hazards: [
        {
          x: 1, y: 1, blocking: false,
          affinity: { kind: "water", expression: "push", stacks: 2 },
        },
      ],
    });

    // Two casts of water push at 2 stacks (2 × 3 = 6 mana each), the price core charges (#232, #233).
    const hazard = result.hazards[0];
    assert.equal(hazard.vitals.mana.current, 12);
    assert.equal(hazard.vitals.mana.max, 12);
    assert.equal(hazard.vitals.mana.regen, 0);
    assert.equal(hazard.vitals.durability.current, 6);
    assert.equal(hazard.vitals.durability.max, 6);
    assert.equal(hazard.vitals.durability.regen, 0);
  }

  // Test draw expression with stacks=1
  {
    const result = resolveAffinityEffects({
      presets: [],
      hazards: [
        {
          x: 3, y: 3, blocking: false,
          affinity: { kind: "earth", expression: "draw", stacks: 1 },
        },
      ],
    });

    const hazard = result.hazards[0];
    assert.equal(hazard.vitals.mana.current, 12);
    assert.equal(hazard.vitals.mana.max, 12);
    assert.equal(hazard.vitals.mana.regen, 4);
    assert.equal(hazard.vitals.durability.current, 5);
    assert.equal(hazard.vitals.durability.max, 5);
    assert.equal(hazard.vitals.durability.regen, 0);
  }

  // Test that provided vitals override computed defaults
  {
    const result = resolveAffinityEffects({
      presets: [],
      hazards: [
        {
          x: 4, y: 4, blocking: false,
          affinity: { kind: "fire", expression: "emit", stacks: 2 },
          vitals: {
            mana: { current: 100, max: 100, regen: 10 },
            durability: { current: 50, max: 50, regen: 1 },
          },
        },
      ],
    });

    const hazard = result.hazards[0];
    assert.equal(hazard.vitals.mana.current, 100);
    assert.equal(hazard.vitals.mana.max, 100);
    assert.equal(hazard.vitals.mana.regen, 10);
    assert.equal(hazard.vitals.durability.current, 50);
    assert.equal(hazard.vitals.durability.max, 50);
    assert.equal(hazard.vitals.durability.regen, 1);
  }
});

test("hazard vitals computation scales with stack levels", async () => {
  const { resolveAffinityEffects } = await import(
    "../../../packages/runtime/src/personas/configurator/affinity-effects.js"
  );

  const stackLevels = [1, 2, 3, 5, 8];

  stackLevels.flatMap((stacks) => [[stacks, undefined], [stacks, 3]]).forEach(([stacks, intensity]) => {
    const result = resolveAffinityEffects({
      presets: [],
      hazards: [
        {
          x: 0, y: 0, blocking: false,
          affinity: { kind: "fire", expression: "emit", stacks, ...(intensity ? { intensity } : {}) },
        },
      ],
    });

    const hazard = result.hazards[0];
    // #340: upkeep is 2 + range + intensity; an omitted intensity reads 1.
    const expectedUpkeep = 2 + stacks + (intensity ?? 1);
    const expectedPool = expectedUpkeep * 3;
    const expectedRegen = expectedUpkeep;
    const expectedDurability = stacks * 5;

    assert.equal(hazard.vitals.mana.current, expectedPool, `stacks=${stacks}: mana.current`);
    assert.equal(hazard.vitals.mana.max, expectedPool, `stacks=${stacks}: mana.max`);
    assert.equal(hazard.vitals.mana.regen, expectedRegen, `stacks=${stacks}: mana.regen`);
    assert.equal(hazard.vitals.durability.current, expectedDurability, `stacks=${stacks}: durability.current`);
    assert.equal(hazard.vitals.durability.max, expectedDurability, `stacks=${stacks}: durability.max`);
  });
});

test("mapHazards projects authored regen vitals onto mechanical records", async () => {
  const { mapHazards } = await import(
    "../../../packages/runtime/src/personas/configurator/input-preparation.js"
  );
  const authored = {
    id: "hazard_fire",
    x: 2,
    y: 2,
    affinity: { kind: "fire", expression: "push", stacks: 2 },
    vitals: {
      mana: { kind: "regen", current: 3, max: 3, regen: 1 },
      durability: { kind: "regen", current: 4, max: 4, regen: 0 },
    },
  };
  const [actor] = mapHazards([authored]);
  assert.deepEqual(actor.vitals.mana, { current: 3, max: 3, regen: 1 });
  assert.deepEqual(actor.vitals.durability, { current: 4, max: 4, regen: 0 });
  assert.equal(Object.hasOwn(actor.vitals.mana, "kind"), false);
  assert.equal(Object.hasOwn(actor.vitals.durability, "kind"), false);
  assert.equal(authored.vitals.mana.kind, "regen");
});

test("mapHazards converts one-time amount vitals and keeps computed defaults for incomplete records", async () => {
  const { mapHazards } = await import(
    "../../../packages/runtime/src/personas/configurator/input-preparation.js"
  );
  const { computeHazardVitals } = await import(
    "../../../packages/runtime/src/personas/configurator/affinity-effects.js"
  );
  const authored = {
    id: "hazard_push",
    x: 2,
    y: 2,
    affinity: { kind: "fire", expression: "push", stacks: 2 },
    vitals: {
      mana: { kind: "one-time", amount: 0 },
      durability: { kind: "one-time", amount: 1 },
    },
  };
  const [actor] = mapHazards([authored]);
  assert.deepEqual(actor.vitals.mana, { current: 0, max: 0, regen: 0 });
  assert.deepEqual(actor.vitals.durability, { current: 1, max: 1, regen: 0 });
  const [kept] = mapHazards([{
    id: "hazard_emit",
    x: 1,
    y: 1,
    affinity: { kind: "fire", expression: "emit", stacks: 2 },
    vitals: { mana: { kind: "one-time" } },
  }]);
  assert.deepEqual(kept.vitals, computeHazardVitals("emit", 2));
});

test("mapHazards accepts CLI string affinity and affinityStacks", async () => {
  const { mapHazards } = await import(
    "../../../packages/runtime/src/personas/configurator/input-preparation.js"
  );
  const [fromString] = mapHazards([{
    id: "hazard_1",
    x: 2,
    y: 2,
    affinity: "fire",
    expression: "emit",
    stacks: 2,
    vitals: { mana: { kind: "regen", current: 4, max: 4, regen: 1 } },
  }]);
  assert.deepEqual(fromString.affinities, [{ kind: "fire", expression: "emit", stacks: 2 }]);
  assert.equal(fromString.activeAffinityKey, "fire:emit");
  assert.deepEqual(fromString.vitals.mana, { current: 4, max: 4, regen: 1 });
  const [fromStacks] = mapHazards([{
    id: "hazard_2",
    position: { x: 1, y: 1 },
    affinity: "water",
    affinityStacks: [{ kind: "water", expression: "push", stacks: 3, targetType: "floor" }],
  }]);
  assert.deepEqual(fromStacks.affinities, [{ kind: "water", expression: "push", stacks: 3 }]);
  assert.equal(fromStacks.activeAffinityKey, "water:push");
});

test("mapHazards assigns hazard_N when generated layout occupants omit id", async () => {
  const { mapHazards } = await import(
    "../../../packages/runtime/src/personas/configurator/input-preparation.js"
  );
  const [actor] = mapHazards([{
    x: 2,
    y: 2,
    blocking: true,
    affinity: { kind: "fire", expression: "emit", stacks: 1 },
  }]);
  assert.equal(actor.id, "hazard_1");
  assert.equal(actor.position.x, 2);
  assert.equal(actor.position.y, 2);
  assert.equal(actor.capabilities.blocksMovement, true);
  assert.throws(
    () => mapHazards([{ id: "no_affinity", x: 1, y: 1 }]),
    /invalid hazard actor request/,
  );
});

// #233 (maintainer, 2026-10-13): a push/pull trap's pool is exactly two casts at the price core
// charges, for every kind and stack tier, so sizing and casting can never drift apart again.
test("a push/pull trap holds exactly two casts at the price core charges", async () => {
  const { mapHazards } = await import("../../../packages/runtime/src/personas/configurator/input-preparation.js");
  const { resolveActorTurnCosts } = await import("../../../packages/runtime/src/personas/configurator/affinity-rules.js");
  const { actorCastManaPrice } = await import("../../../packages/core-ts/src/rules/actor-cast.ts");
  const { castManaBase } = resolveActorTurnCosts({ movementStamina: {} });
  for (const [key, base] of Object.entries(castManaBase)) {
    const [kind, expression] = key.split(":");
    if (!["push", "pull"].includes(expression)) continue;
    for (const stacks of [1, 3, 5, 7]) {
      const [hazard] = mapHazards([{ id: "trap", x: 1, y: 1, affinity: kind, expression, stacks }]);
      const price = actorCastManaPrice(base, stacks);
      assert.deepEqual(hazard.vitals.mana, { current: 2 * price, max: 2 * price, regen: 0 },
        `${key} at ${stacks} stacks`);
    }
  }
});

// #247: a build that authors its own affinity rules sizes its traps from those rules, the same
// ones core's castManaBase is built from, not from the defaults.
async function doubledCastRules() {
  const { DEFAULT_AFFINITY_RULES_ARTIFACT, resolveActorTurnCosts } = await import(
    "../../../packages/runtime/src/personas/configurator/affinity-rules.js"
  );
  const rules = JSON.parse(JSON.stringify(DEFAULT_AFFINITY_RULES_ARTIFACT));
  rules.affinities.forEach((affinity) => affinity.expressions.forEach((expression) => {
    expression.stackTiers.forEach((tier) => { tier.manaCost *= 2; });
  }));
  const { castManaBase } = resolveActorTurnCosts({ rules, movementStamina: {} });
  return { rules, castManaBase };
}

const AUTHORED_KINDS = ["fire", "dark", "growth"];

test("mapHazards sizes push/pull traps from authored affinity rules", async () => {
  const { mapHazards } = await import("../../../packages/runtime/src/personas/configurator/input-preparation.js");
  const { actorCastManaPrice } = await import("../../../packages/core-ts/src/rules/actor-cast.ts");
  const { rules, castManaBase } = await doubledCastRules();
  for (const kind of AUTHORED_KINDS) {
    for (const expression of ["push", "pull"]) {
      const [hazard] = mapHazards([{ id: "trap", x: 1, y: 1, affinity: kind, expression, stacks: 3 }],
        { affinityRules: rules });
      const price = actorCastManaPrice(castManaBase[`${kind}:${expression}`], 3);
      assert.equal(hazard.vitals.mana.max, 2 * price, `${kind}:${expression}`);
    }
  }
});

test("resolveAffinityEffects sizes push/pull traps from the authored rules it is given", async () => {
  const { resolveAffinityEffects } = await import(
    "../../../packages/runtime/src/personas/configurator/affinity-effects.js"
  );
  const { actorCastManaPrice } = await import("../../../packages/core-ts/src/rules/actor-cast.ts");
  const { rules, castManaBase } = await doubledCastRules();
  const result = resolveAffinityEffects({
    presets: [],
    hazards: [{ x: 1, y: 1, blocking: false, affinity: { kind: "dark", expression: "pull", stacks: 2 } }],
    affinityRules: rules,
  });
  assert.equal(result.hazards[0].vitals.mana.max, 2 * actorCastManaPrice(castManaBase["dark:pull"], 2));
});

test("object placement carries authored affinity rules into the trap actors it places", async () => {
  const { completeObjectPlacement } = await import(
    "../../../packages/runtime/src/personas/configurator/object-placement.js"
  );
  const { actorCastManaPrice } = await import("../../../packages/core-ts/src/rules/actor-cast.ts");
  const { rules, castManaBase } = await doubledCastRules();
  const layout = { width: 5, height: 1, terrain: ["spawn", "floor", "floor", "floor", "exit"] };
  const hazards = [{ id: "trap", affinity: "growth", expression: "push", stacks: 2 }];
  const expected = 2 * actorCastManaPrice(castManaBase["growth:push"], 2);
  const fallback = completeObjectPlacement({ layout, hazards, resources: [], actors: [], affinityRules: rules });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.actors[0].vitals.mana.max, expected);
});
