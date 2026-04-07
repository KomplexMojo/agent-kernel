const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const affinityEffectsModule = moduleUrl("packages/runtime/src/personas/configurator/affinity-effects.js");

test("resolveAffinityEffects computes trap vitals from expression and stacks when not provided", () => {
  const script = `
import assert from "node:assert/strict";
import { resolveAffinityEffects } from ${JSON.stringify(affinityEffectsModule)};

// Test emit expression with stacks=2
{
  const result = resolveAffinityEffects({
    presets: [],
    traps: [
      {
        x: 2,
        y: 2,
        blocking: false,
        affinity: {
          kind: "fire",
          expression: "emit",
          stacks: 2,
        },
        // No vitals provided - should be computed
      },
    ],
  });

  assert.equal(result.traps.length, 1);
  const trap = result.traps[0];

  // emit with stacks=2: upkeep = 2 + 2 = 4
  // manaPool = 4 * 3 = 12
  // manaRegen = 4
  // durability = 2 * 5 = 10
  assert.equal(trap.vitals.mana.current, 12);
  assert.equal(trap.vitals.mana.max, 12);
  assert.equal(trap.vitals.mana.regen, 4);
  assert.equal(trap.vitals.durability.current, 10);
  assert.equal(trap.vitals.durability.max, 10);
  assert.equal(trap.vitals.durability.regen, 0);
}

// Test push expression with stacks=2
{
  const result = resolveAffinityEffects({
    presets: [],
    traps: [
      {
        x: 1,
        y: 1,
        blocking: false,
        affinity: {
          kind: "water",
          expression: "push",
          stacks: 2,
        },
      },
    ],
  });

  const trap = result.traps[0];

  // push with stacks=2: manaUse = 5 + 4·(2-1)² = 5 + 4 = 9
  // manaPool = 9 * 2 = 18
  // manaRegen = 0 (instantaneous)
  // durability = 2 * 3 = 6
  assert.equal(trap.vitals.mana.current, 18);
  assert.equal(trap.vitals.mana.max, 18);
  assert.equal(trap.vitals.mana.regen, 0);
  assert.equal(trap.vitals.durability.current, 6);
  assert.equal(trap.vitals.durability.max, 6);
  assert.equal(trap.vitals.durability.regen, 0);
}

// Test draw expression with stacks=1
{
  const result = resolveAffinityEffects({
    presets: [],
    traps: [
      {
        x: 3,
        y: 3,
        blocking: false,
        affinity: {
          kind: "earth",
          expression: "draw",
          stacks: 1,
        },
      },
    ],
  });

  const trap = result.traps[0];

  // draw with stacks=1: upkeep = 2 + 1 = 3
  // manaPool = 3 * 3 = 9
  // manaRegen = 3
  // durability = 1 * 5 = 5
  assert.equal(trap.vitals.mana.current, 9);
  assert.equal(trap.vitals.mana.max, 9);
  assert.equal(trap.vitals.mana.regen, 3);
  assert.equal(trap.vitals.durability.current, 5);
  assert.equal(trap.vitals.durability.max, 5);
  assert.equal(trap.vitals.durability.regen, 0);
}

// Test that provided vitals override computed defaults
{
  const result = resolveAffinityEffects({
    presets: [],
    traps: [
      {
        x: 4,
        y: 4,
        blocking: false,
        affinity: {
          kind: "fire",
          expression: "emit",
          stacks: 2,
        },
        vitals: {
          mana: {
            current: 100,
            max: 100,
            regen: 10,
          },
          durability: {
            current: 50,
            max: 50,
            regen: 1,
          },
        },
      },
    ],
  });

  const trap = result.traps[0];

  // Should use provided vitals, not computed
  assert.equal(trap.vitals.mana.current, 100);
  assert.equal(trap.vitals.mana.max, 100);
  assert.equal(trap.vitals.mana.regen, 10);
  assert.equal(trap.vitals.durability.current, 50);
  assert.equal(trap.vitals.durability.max, 50);
  assert.equal(trap.vitals.durability.regen, 1);
}
`;
  runEsm(script);
});

test("trap vitals computation scales with stack levels", () => {
  const script = `
import assert from "node:assert/strict";
import { resolveAffinityEffects } from ${JSON.stringify(affinityEffectsModule)};

// Test emit expression with different stack levels
const stackLevels = [1, 2, 3, 5, 8];

stackLevels.forEach((stacks) => {
  const result = resolveAffinityEffects({
    presets: [],
    traps: [
      {
        x: 0,
        y: 0,
        blocking: false,
        affinity: {
          kind: "fire",
          expression: "emit",
          stacks,
        },
      },
    ],
  });

  const trap = result.traps[0];

  // emit upkeep = 2 + s
  const expectedUpkeep = 2 + stacks;
  const expectedPool = expectedUpkeep * 3;
  const expectedRegen = expectedUpkeep;
  const expectedDurability = stacks * 5;

  assert.equal(trap.vitals.mana.current, expectedPool, \`stacks=\${stacks}: mana.current\`);
  assert.equal(trap.vitals.mana.max, expectedPool, \`stacks=\${stacks}: mana.max\`);
  assert.equal(trap.vitals.mana.regen, expectedRegen, \`stacks=\${stacks}: mana.regen\`);
  assert.equal(trap.vitals.durability.current, expectedDurability, \`stacks=\${stacks}: durability.current\`);
  assert.equal(trap.vitals.durability.max, expectedDurability, \`stacks=\${stacks}: durability.max\`);
});
`;
  runEsm(script);
});
