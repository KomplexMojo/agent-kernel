const assert = require("node:assert/strict");


test("moderator affinity target resolver emits vital and environment effects", async () => {const { resolveAffinityTargetEffectsForList } = await import("../../../packages/runtime/src/personas/moderator/affinity-target-effects.js");

const effects = resolveAffinityTargetEffectsForList(
  [
    { kind: "earth", expression: "pull", stacks: 3, targetType: "floor" },
    { kind: "water", expression: "emit", stacks: 3, targetType: "area" },
    { kind: "growth", expression: "pull", stacks: 1, targetType: "self" },
  ],
  { sourceType: "actor", sourceId: "A-1", manaReserve: 4 },
);

const ids = effects.map((entry) => entry.id);
assert.ok(ids.includes("earth:pull:floor:vital"));
assert.ok(ids.includes("earth:pull:floor:arm_static_hazard"));
// #227 — barrier effects were dropped with the old engine (#206).
assert.ok(!ids.some((id) => id.endsWith("_barrier")));
assert.ok(ids.includes("growth:pull:self:vital"));

const vital = effects.find((entry) => entry.id === "earth:pull:floor:vital");
assert.equal(vital.targetVital, "stamina");
assert.equal(vital.potency, 3);
});

test("moderator planner derives deterministic hazard actions and plans no barrier action", async () => {const { planModeratorAffinityActions } = await import("../../../packages/runtime/src/personas/moderator/affinity-target-effects.js");

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
          id: "water:emit:floor:arm_static_hazard",
          category: "environment",
          operation: "arm_static_hazard",
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
// A stale destroy_barrier effect plans nothing: only the hazard is armed.
assert.equal(actions.length, 1);
assert.equal(actions[0].kind, "arm_static_hazard");
assert.equal(actions[0].params.x, 1);
assert.equal(actions[0].params.y, 1);
assert.equal(actions[0].params.kind, "water");
assert.equal(actions[0].params.expression, "emit");
assert.equal(actions[0].params.manaReserve, 2);
});
