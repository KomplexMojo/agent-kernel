"use strict";

// Seed-11 playtest (Darren, 2026-10-29): a warden that looted a growth push kept casting it
// at the delver, healing it. Core lets a restoring push reach anyone (Darren's rule); the
// Actor never chooses to aim one at a hostile. Its pull, which drains, is still a weapon.

const assert = require("node:assert/strict");

async function propose({ self, others = [] }) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const persona = createActorPersona({ clock: () => "2026-10-29T00:00:00.000Z" });
  const baseTiles = ["#######", "#.....#", "#######"];
  const observation = { actors: [self, ...others], tiles: { baseTiles }, exit: { x: 5, y: 1 } };
  const payload = { actorId: self.id, observation, baseTiles, initialState: { actors: [self, ...others] } };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 1 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 1 });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 1 }).actions;
}

function actor({ affinities, ...overrides }) {
  return {
    id: "self", category: "warden", alignment: "dungeon", lifecycle: "alive", position: { x: 1, y: 1 },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: false },
    motivations: ["attacking"], affinities, activeAffinityKey: `${affinities[0].kind}:${affinities[0].expression}`,
    equippedAffinityKeys: affinities.map((entry) => `${entry.kind}:${entry.expression}`), affinitySlots: affinities.length,
    vitals: { mana: { current: 40, max: 40, regen: 0 } }, ...overrides,
  };
}
const delver = () => actor({ id: "delver", category: "delver", alignment: "external", position: { x: 2, y: 1 },
  motivations: ["stationary"], affinities: [{ kind: "fire", expression: "push", stacks: 1 }] });
const casts = (actions) => actions.filter((action) => action.kind === "cast_affinity").map((action) => action.params);

for (const kind of ["growth", "fortify", "light"]) {
  test(`a ${kind} push is never aimed at a hostile; a ${kind} pull is`, async () => {
    assert.deepEqual(casts(await propose({ self: actor({ affinities: [{ kind, expression: "push", stacks: 2 }] }), others: [delver()] })), []);
    assert.deepEqual(casts(await propose({ self: actor({ affinities: [{ kind, expression: "pull", stacks: 2 }] }), others: [delver()] })),
      [{ targetId: "delver" }]);
  });
}

for (const kind of ["fire", "water", "earth", "wind", "decay", "corrode", "dark"]) {
  test(`a ${kind} push is still cast at a hostile`, async () => {
    assert.deepEqual(casts(await propose({ self: actor({ affinities: [{ kind, expression: "push", stacks: 2 }] }), others: [delver()] })),
      [{ targetId: "delver" }]);
  });
}

test("with a restoring push first and a harmful one second, the harmful one is named", async () => {
  const self = actor({ affinities: [{ kind: "growth", expression: "push", stacks: 2 }, { kind: "fire", expression: "push", stacks: 2 }] });
  assert.deepEqual(casts(await propose({ self, others: [delver()] })), [{ targetId: "delver", affinityKey: "fire:push" }]);
});

// ## TODO: Test Permutations
// - a restoring push the actor holds is still cast by a player's command
// - a support minion still pushes its restoring kind at its own leader
