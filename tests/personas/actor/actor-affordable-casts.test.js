"use strict";

// #367: the Actor proposes only a cast core would accept. A slot whose cast price
// (authored base × s(s+1)/2, the curve core charges) is above the actor's mana is
// skipped, so the turn falls through to its other candidates instead of being refused.

const assert = require("node:assert/strict");

async function propose({ self, others = [], castManaBase }) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const persona = createActorPersona({ clock: () => "2026-10-18T00:00:00.000Z" });
  const baseTiles = ["#######", "#.....#", "#######"];
  const observation = { actors: [self, ...others], tiles: { baseTiles }, exit: { x: 5, y: 1 } };
  const payload = { actorId: self.id, observation, baseTiles, initialState: { actors: [self, ...others] },
    simConfig: castManaBase ? { actionCosts: { castManaBase, movementStamina: {} } } : undefined };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 1 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 1 });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 1 }).actions;
}

function actor({ mana = 10, affinities = [{ kind: "fire", expression: "push", stacks: 3 }], ...overrides } = {}) {
  return {
    id: "self", category: "delver", alignment: "external", lifecycle: "alive", position: { x: 1, y: 1 },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true },
    motivations: ["attacking"], affinities, activeAffinityKey: `${affinities[0].kind}:${affinities[0].expression}`,
    vitals: { mana: { current: mana, max: 40, regen: 0 } }, ...overrides,
  };
}
const enemy = (x = 2) => actor({ id: "enemy", alignment: "dungeon", position: { x, y: 1 }, motivations: ["stationary"] });
const casts = (actions) => actions.filter((action) => action.kind === "cast_affinity").map((action) => action.params);

for (const kind of ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"]) {
  // A restoring kind harms by pulling: its push heals, so it is never aimed at a hostile.
  const expression = ["growth", "fortify", "light"].includes(kind) ? "pull" : "push";
  test(`a ${kind} ${expression} the actor cannot afford is not proposed; one it can afford is`, async () => {
    const affinities = [{ kind, expression, stacks: 3 }];
    const castManaBase = { [`${kind}:${expression}`]: 3 }; // 3 × 3·4/2 = 18 mana
    assert.deepEqual(casts(await propose({ self: actor({ mana: 17, affinities }), others: [enemy()], castManaBase })), []);
    assert.deepEqual(casts(await propose({ self: actor({ mana: 18, affinities }), others: [enemy()], castManaBase })),
      [{ targetId: "enemy" }]);
  });
}

test("an unaffordable first slot gives way to an affordable one, named", async () => {
  const affinities = [{ kind: "fire", expression: "push", stacks: 3 }, { kind: "water", expression: "pull", stacks: 1 }];
  const self = actor({ mana: 5, affinities, equippedAffinityKeys: ["fire:push", "water:pull"] });
  const actions = await propose({ self, others: [enemy()],
    castManaBase: { "fire:push": 3, "water:pull": 2 } });
  assert.deepEqual(casts(actions), [{ targetId: "enemy", affinityKey: "water:pull" }]);
});

test("a turn with no affordable cast still proposes something else to do", async () => {
  const actions = await propose({ self: actor({ mana: 0 }), others: [enemy(4)], castManaBase: { "fire:push": 3 } });
  assert.deepEqual(casts(actions), []);
  assert.ok(actions.length > 0, "the actor falls through to its other candidates");
});

test("without authored cast prices the Actor keeps proposing by reach alone", async () => {
  assert.deepEqual(casts(await propose({ self: actor({ mana: 0 }), others: [enemy()] })), [{ targetId: "enemy" }]);
});

// ## TODO: Test Permutations
// - an unaffordable cast through a strategy's castAt (orders) is not proposed
// - equip readiness ranks an unaffordable cast slot as not ready
// - pull and push at stacks 1..6 against mana just below and at the price
