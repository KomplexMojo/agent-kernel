/**
 * Raised barriers (#413) through the play session: a push cast at an empty tile raises a
 * barrier of the caster's kind, drawn as a barrier; a pull cast at its tile takes it down;
 * the caster walks through its own barrier. Core decides; the session reports.
 */
const assert = require("node:assert/strict");

const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const ROOM = [
  "#######",
  "S.....#",
  "#.....#",
  "#.....E",
  "#######",
];
const KINDS = ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];

function level(kind) {
  const player = {
    category: "delver", id: "me", position: { x: 1, y: 2 }, vitals: viableVitals({ mana: 40 }),
    motivations: ["user_controlled"], affinitySlots: 2,
    affinities: [{ kind, expression: "push", stacks: 1 }, { kind, expression: "pull", stacks: 2 }],
    activeAffinityKey: `${kind}:push`, equippedAffinityKeys: [`${kind}:push`, `${kind}:pull`],
  };
  return buildUnifiedLevel({ id: `raise_${kind}`, tiles: ROOM, actors: [player] });
}

for (const kind of KINDS) {
  test(`a ${kind} push at an empty tile raises a barrier the player can walk through, and a pull takes it down`, async () => {
    const session = await createPlaySession(level(kind));
    const raised = await session.act({ kind: "cast_affinity", params: { target: { x: 2, y: 2 }, affinityKey: `${kind}:push` } });
    assert.equal(raised.accepted.length, 1, JSON.stringify(raised.rejected));
    assert.equal(session.view().rows[2][2], session.view().legend.barrier);
    assert.equal(session.view().actors.some((actor) => actor.position.x === 2 && actor.position.y === 2), false);

    const walked = await session.act({ kind: "move", params: { direction: "east" } });
    assert.equal(walked.accepted.length, 1, JSON.stringify(walked.rejected));
    assert.deepEqual(session.view().player.position, { x: 2, y: 2 });
    await session.act({ kind: "move", params: { direction: "east" } });

    const removed = await session.act({ kind: "cast_affinity", params: { target: { x: 2, y: 2 }, affinityKey: `${kind}:pull` } });
    assert.equal(removed.accepted.length, 1, JSON.stringify(removed.rejected));
    assert.notEqual(session.view().rows[2][2], session.view().legend.barrier);
  });
}

test("a push at a tile out of reach is core's refusal", async () => {
  const session = await createPlaySession(level("earth"));
  const result = await session.act({ kind: "cast_affinity", params: { target: { x: 4, y: 2 }, affinityKey: "earth:push" } });
  assert.equal(result.rejected[0].reason, "TargetOutOfRange");
});

// ## TODO: Test Permutations
// - a raised barrier erodes away on the board once its investment is spent
// - a companion's route to the exit waits at a raised barrier that seals the only way
