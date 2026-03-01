const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/moderator/affinity-target-effects.js");

test("moderator affinity target resolver emits vital and environment effects", () => {
  const script = `
import assert from "node:assert/strict";
import { resolveAffinityTargetEffectsForList } from ${JSON.stringify(modulePath)};

const effects = resolveAffinityTargetEffectsForList(
  [
    { kind: "earth", expression: "pull", stacks: 3, targetType: "floor" },
    { kind: "water", expression: "emit", stacks: 3, targetType: "area" },
    { kind: "life", expression: "pull", stacks: 1, targetType: "self" },
  ],
  { sourceType: "actor", sourceId: "A-1", manaReserve: 4 },
);

const ids = effects.map((entry) => entry.id);
assert.ok(ids.includes("earth:pull:floor:vital"));
assert.ok(ids.includes("earth:pull:floor:raise_barrier"));
assert.ok(ids.includes("earth:pull:floor:arm_static_trap"));
assert.ok(ids.includes("water:emit:area:destroy_barrier"));
assert.ok(ids.includes("life:pull:self:vital"));

const vital = effects.find((entry) => entry.id === "earth:pull:floor:vital");
assert.equal(vital.targetVital, "stamina");
assert.equal(vital.potency, 3);
`;
  runEsm(script);
});

test("moderator planner derives deterministic barrier and trap actions", () => {
  const script = `
import assert from "node:assert/strict";
import { planModeratorAffinityActions } from ${JSON.stringify(modulePath)};

const observation = {
  actors: [{ id: "A-2RB89Z", position: { x: 1, y: 1 } }],
  tiles: {
    width: 3,
    height: 3,
    kinds: [
      [0, 1, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  },
};

const affinityEffects = {
  actors: [
    {
      actorId: "A-2RB89Z",
      resolvedEffects: [
        {
          id: "water:emit:area:destroy_barrier",
          category: "environment",
          operation: "destroy_barrier",
          sourceType: "actor",
          kind: "water",
          expression: "emit",
          stacks: 3,
          targetType: "barrier",
        },
        {
          id: "water:emit:floor:arm_static_trap",
          category: "environment",
          operation: "arm_static_trap",
          sourceType: "actor",
          kind: "water",
          expression: "emit",
          stacks: 3,
          targetType: "floor",
          manaReserve: 2,
        },
      ],
    },
  ],
};

const actions = planModeratorAffinityActions({ observation, affinityEffects, tick: 5, maxActions: 4 });
assert.equal(actions.length, 2);
assert.equal(actions[0].kind, "destroy_barrier");
assert.deepEqual(actions[0].params, { x: 1, y: 0 });
assert.equal(actions[1].kind, "arm_static_trap");
assert.equal(actions[1].params.x, 1);
assert.equal(actions[1].params.y, 1);
assert.equal(actions[1].params.kind, "water");
assert.equal(actions[1].params.expression, "emit");
assert.equal(actions[1].params.manaReserve, 2);
`;
  runEsm(script);
});
