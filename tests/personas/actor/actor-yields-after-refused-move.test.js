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

// ## TODO: Test Permutations
// - a follower within its follow distance yields too
// - two actors refused into the same cell both yield, then one gets through
