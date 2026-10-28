const assert = require("node:assert/strict");

// #457: in a crowd (the 20k sweep level, five followers round one hero) an actor kept
// proposing moves into cells others took first, refused turn after turn. A move refused
// last turn (the actor still stands where it proposed it from) may yield: this turn it waits
// on a seeded coin, so two actors yielding to each other don't fall in step.

const baseTiles = ["#######", "#.....E", "#######"];
const kinds = [[1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1]];
const actorId = "actor_delver";

async function persona() {
  const { createActorPersona } = await import("../../../packages/runtime/src/personas/actor/persona.js");
  const { TickPhases } = await import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts");
  const actor = createActorPersona({ clock: () => "fixed" });
  return async (tick, position) => {
    const payload = { actorId, baseTiles, observation: { tick, tiles: { kinds },
      actors: [{ id: actorId, kind: 2, position, motivation: { mobility: "exploring" } }] } };
    actor.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick });
    actor.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick });
    const { actions } = actor.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick });
    actor.advance({ phase: TickPhases.DECIDE, event: "cooldown", payload, tick });
    return actions.filter((action) => action.kind !== "emit_log" && action.kind !== "emit_telemetry");
  };
}

test("a move refused last turn yields on some turns and not others; a move that happened never does", async () => {
  let yields = 0;
  for (let tick = 1; tick <= 20; tick += 1) {
    const refused = await persona();
    assert.equal((await refused(tick - 1, { x: 1, y: 1 }))[0].kind, "move");
    const next = (await refused(tick, { x: 1, y: 1 }))[0].kind;
    assert.ok(["move", "wait"].includes(next), next);
    if (next === "wait") {
      yields += 1;
      assert.equal((await refused(tick + 1, { x: 1, y: 1 }))[0].kind, "move", "a wait is not a refused move");
    }
    const moved = await persona();
    const first = await moved(tick - 1, { x: 1, y: 1 });
    assert.equal((await moved(tick, first[0].params.target))[0].kind, "move");
  }
  assert.ok(yields > 0 && yields < 20, `${yields} of 20 refused moves yielded`);
});

test("the yield is only for the very next turn", async () => {
  for (let tick = 5; tick < 15; tick += 1) {
    const later = await persona();
    await later(0, { x: 1, y: 1 });
    assert.equal((await later(tick, { x: 1, y: 1 }))[0].kind, "move");
  }
});

// #524: the yield reads last turn's chosen action, not its first candidate. An actor whose
// motivations list a move first but whose turn went to a cast proposed no move, so standing
// still next turn is not a refusal.
test("a turn that went to a cast is not a refused move next turn", async () => {
  const { createActorPersona } = await import("../../../packages/runtime/src/personas/actor/persona.js");
  const { TickPhases } = await import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts");
  const self = { id: actorId, category: "delver", alignment: "external", lifecycle: "alive", position: { x: 1, y: 1 },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true },
    motivations: ["exploring", "attacking"], affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
    activeAffinityKey: "fire:push", vitals: { mana: { current: 10, max: 10, regen: 0 } } };
  const enemy = { ...self, id: "enemy", alignment: "dungeon", position: { x: 2, y: 1 }, motivations: ["stationary"] };
  const turn = (actor, tick, others) => {
    const actors = [self, ...others];
    const payload = { actorId, baseTiles, observation: { tick, actors, tiles: { kinds } }, initialState: { actors } };
    actor.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick });
    actor.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick });
    const { actions } = actor.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick });
    actor.advance({ phase: TickPhases.DECIDE, event: "cooldown", payload, tick });
    return actions.filter((action) => action.kind !== "emit_log" && action.kind !== "emit_telemetry");
  };
  for (let tick = 2; tick <= 21; tick += 1) {
    const actor = createActorPersona({ clock: () => "fixed" });
    assert.equal(turn(actor, tick - 1, [enemy])[0].kind, "cast_affinity");
    assert.equal(turn(actor, tick, [])[0].kind, "move", `tick ${tick}: no move was proposed last turn`);
  }
});

// ## TODO: Test Permutations
// - a follower within its follow distance yields too
// - two actors refused into the same cell both yield, then one gets through
// - a turn that went to take or equip is not a refused move either
