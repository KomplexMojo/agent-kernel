"use strict";

const assert = require("node:assert/strict");

async function propose({ self, others = [], baseTiles = ["#######", "#.....#", "#######"] }) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const persona = createActorPersona({ clock: () => "2026-09-13T00:00:00.000Z" });
  const observation = { actors: [self, ...others], tiles: { baseTiles }, exit: { x: 5, y: 1 } };
  const payload = { actorId: self.id, observation, baseTiles, initialState: { actors: [self, ...others] } };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 1 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 1 });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 1 }).actions;
}

function actor(overrides) {
  return {
    id: "self",
    category: "delver",
    alignment: "external",
    lifecycle: "alive",
    position: { x: 1, y: 1 },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true },
    motivations: ["attacking"],
    affinities: [{ kind: "fire", expression: "push", stacks: 3 }],
    activeAffinityKey: "fire:push",
    vitals: { mana: { current: 10, max: 10, regen: 0 } },
    ...overrides,
  };
}

test("alignment alone determines hostility across presentation categories", async () => {
  const actions = await propose({
    self: actor({ category: "delver" }),
    others: [
      actor({ id: "ally", category: "resource", position: { x: 2, y: 1 } }),
      actor({ id: "enemy", category: "delver", alignment: "dungeon", position: { x: 3, y: 1 } }),
    ],
  });

  assert.equal(actions.some((action) => action.params?.targetId === "ally"), false);
  assert.equal(actions.some((action) => action.params?.targetId === "enemy"), true);
});

test("missing alignment remains hostile", async () => {
  const actions = await propose({
    self: actor({ alignment: undefined }),
    others: [actor({ id: "unknown", alignment: undefined, position: { x: 2, y: 1 } })],
  });
  assert.equal(actions.some((action) => action.params?.targetId === "unknown"), true);
});

test("the Actor carries its alignment ruling into solver-visible actors", async () => {
  const self = actor({ providerPolicy: { mode: "solver", targetAdapter: "fixtures" } });
  const ally = actor({ id: "ally", category: "barrier", position: { x: 2, y: 1 } });
  const enemy = actor({ id: "enemy", category: "delver", alignment: "dungeon", position: { x: 3, y: 1 } });
  const actions = await propose({ self, others: [ally, enemy] });
  assert.ok(Array.isArray(actions));

  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const persona = createActorPersona({ clock: () => "2026-09-13T00:00:00.000Z" });
  const observation = { actors: [self, ally, enemy], tiles: { baseTiles: ["#######", "#.....#", "#######"] } };
  const payload = {
    actorId: self.id,
    observation,
    baseTiles: observation.tiles.baseTiles,
    initialState: { actors: [self, ally, enemy] },
    runtimeDecisioning: { enabled: true, providerPolicy: { mode: "solver", targetAdapter: "fixtures" } },
  };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 1 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 1 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 1 });
  const visible = result.effects[0].request.problem.data.visibleActors;
  assert.deepEqual(visible.map(({ id, hostile }) => ({ id, hostile })), [
    { id: "ally", hostile: false },
    { id: "enemy", hostile: true },
  ]);
});

test("combat proposes only the active affinity using the unified cast shape", async () => {
  const actions = await propose({
    self: actor({
      affinities: [
        { kind: "water", expression: "emit", stacks: 8 },
        { kind: "fire", expression: "push", stacks: 3 },
      ],
      activeAffinityKey: "fire:push",
    }),
    others: [actor({ id: "enemy", alignment: "dungeon", position: { x: 2, y: 1 } })],
  });

  assert.deepEqual(actions.filter((action) => action.kind === "cast_affinity").map((action) => action.params), [
    { targetId: "enemy" },
  ]);
  assert.equal(actions.some((action) => action.kind === "attack"), false);
});

test("attacking pursues a hostile beyond active affinity range", async () => {
  const actions = await propose({
    self: actor({ affinities: [{ kind: "fire", expression: "push", stacks: 1 }] }),
    others: [actor({ id: "enemy", alignment: "dungeon", position: { x: 4, y: 1 } })],
  });
  assert.deepEqual(actions.find((action) => action.kind === "move")?.params, {
    target: { x: 2, y: 1 },
  });
  assert.equal(actions.some((action) => action.kind === "cast_affinity"), false);
});

test("defending holds position but casts at an adjacent hostile", async () => {
  const actions = await propose({
    self: actor({ motivations: ["defending"] }),
    others: [actor({ id: "enemy", alignment: "dungeon", position: { x: 2, y: 1 } })],
  });
  assert.deepEqual(actions.map(({ kind, params }) => ({ kind, params })), [
    { kind: "cast_affinity", params: { targetId: "enemy" } },
  ]);
});

test("movement and waiting use the unified action parameter shapes", async () => {
  const moving = await propose({ self: actor({ motivations: ["exploring"] }) });
  assert.deepEqual(moving[0].params, { target: { x: 2, y: 1 } });

  const waiting = await propose({
    self: actor({ motivations: ["exploring"], capabilities: { canMove: false, canCast: true, canEquip: true, canTake: true, canExit: false } }),
  });
  assert.equal(waiting[0].kind, "wait");
  assert.equal(Object.hasOwn(waiting[0], "params"), false);
});

test("combat intent requires a focused active pair within its stack range", async () => {
  const { classifyActorIntent } = await import("../../../packages/runtime/src/personas/actor/controller.js");
  for (const expression of ["push", "pull", "emit", "draw"]) {
    for (const distance of [1, 2, 3]) {
      const self = actor({ affinities: [{ kind: "fire", expression, stacks: 2 }], activeAffinityKey: `fire:${expression}` });
      const result = classifyActorIntent({
        action: { kind: "cast_affinity", params: { targetId: "enemy" } },
        actorPosition: self.position, actorRecord: self,
        motivationProfile: { combatTier: 1, mobilityTier: 1 },
        visibleActors: [{ id: "enemy", hostile: true, position: { x: 1 + distance, y: 1 } }],
      });
      assert.equal(result.intentClass, ["push", "pull"].includes(expression) && distance <= 2 ? 500 : 0,
        `${expression} at distance ${distance}`);
    }
  }
});

test("area equipment never proposes a targeted cast", async () => {
  for (const expression of ["emit", "draw"]) {
    const actions = await propose({
      self: actor({ affinities: [{ kind: "fire", expression, stacks: 2 }], activeAffinityKey: `fire:${expression}` }),
      others: [actor({ id: "enemy", alignment: "dungeon", position: { x: 2, y: 1 } })],
    });
    assert.equal(actions.some(action => action.kind === "cast_affinity"), false, expression);
  }
});

// ## TODO: Test Permutations
// - Unknown alignment remains hostile rather than silently forming an alliance.
// - An active emit/draw pair only proposes a focused cast when the target is adjacent.
