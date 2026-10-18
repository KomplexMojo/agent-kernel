"use strict";

// #368: an attacking delver whose shortest walk is plugged by its own partner must not
// fall silent. When the next tile of the shortest terrain route is taken, the Actor takes
// another free first step that still closes in, as #359 does for a plugged corridor.

const assert = require("node:assert/strict");

async function propose({ self, others = [], unseen = [], baseTiles, exit }) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const persona = createActorPersona({ clock: () => "2026-10-18T00:00:00.000Z" });
  // Tile kinds as the runner observes them: 0 is free floor; walls and every actor's cell are 1.
  const kinds = baseTiles.map((row, y) => [...row].map((cell, x) =>
    cell !== "." || [self, ...others, ...unseen].some((other) => other.position.x === x && other.position.y === y) ? 1 : 0));
  const observation = { actors: [self, ...others], tiles: { baseTiles, kinds }, exit };
  const payload = { actorId: self.id, observation, baseTiles, initialState: { actors: [self, ...others] } };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 1 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 1 });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 1 }).actions;
}

const actor = (id, x, y, overrides = {}) => ({
  id, category: "delver", alignment: "external", lifecycle: "alive", position: { x, y },
  capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true },
  motivations: ["attacking"], affinities: [{ kind: "corrode", expression: "push", stacks: 3 }],
  activeAffinityKey: "corrode:push", vitals: { mana: { current: 30, max: 30, regen: 0 } }, ...overrides,
});

// The two-v-two shape: a wall on the left, the partner straight ahead, and the exit
// approach beyond it held by two wardens the delver cannot see in the dark (their cells
// are still taken). Nothing hostile is in sight, so the walk to the exit is all it has.
const baseTiles = ["#E###", "#...#", "#...#", "#...#", "#####"];

test("a delver whose straight route is plugged by its partner steps round it", async () => {
  const actions = await propose({ self: actor("d-1", 1, 3), others: [actor("d-2", 1, 2)],
    unseen: [actor("w-1", 1, 1, { alignment: "dungeon" }), actor("w-2", 2, 1, { alignment: "dungeon" })],
    baseTiles, exit: { x: 1, y: 1 } });
  // The diagonal past the partner is closed (core refuses a corner cut), so it sidesteps.
  assert.deepEqual(actions.map(({ kind, params }) => ({ kind, params })), [{ kind: "move", params: { target: { x: 2, y: 3 } } }]);
});

test("with no free step that closes in, the delver still proposes something", async () => {
  const actions = await propose({ self: actor("d-1", 1, 2), others: [actor("w-1", 1, 1)], baseTiles, exit: { x: 1, y: 1 } });
  assert.ok(actions.length > 0, "never an empty turn");
});

// ## TODO: Test Permutations
// - the alternative step is diagonal only when both orthogonal neighbours are open
// - every motivation that walks to the exit (exploring, stealthy, friendly) steps round a plugged route
// - a fully boxed-in delver proposes wait
