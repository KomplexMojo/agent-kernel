import assert from "node:assert/strict";
import { test } from "vitest";
import { buildManualMoveAction } from "../../packages/runtime/src/commands/manual-movement.js";

test("manual move records only the destination target", () => {
  const result = buildManualMoveAction({
    action: "up-right",
    actorId: "actor_1",
    observation: {
      tick: 4,
      actors: [{ id: "actor_1", position: { x: 3, y: 4 } }],
    },
    controllableActorIds: ["actor_1"],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.action.params, { target: { x: 4, y: 3 } });
  assert.equal(result.action.kind, "move");
  assert.equal(result.action.tick, 5);
});

test("manual move still rejects an actor outside the controllable set", () => {
  const result = buildManualMoveAction({
    action: "right",
    actorId: "actor_2",
    observation: {
      tick: 1,
      actors: [{ id: "actor_2", position: { x: 0, y: 0 } }],
    },
    controllableActorIds: ["actor_1"],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "actor_not_controllable");
});

// ## TODO: Test Permutations
// - A missing observation actor returns actor_not_found and writes no action.
// - Non-finite coordinates return invalid_position.
// - cast still returns cast_unimplemented.
