const assert = require("node:assert/strict");

// A big level (scripts/game/big-sim.sh) seats every warden around the exit, so the
// only route there is plugged by actors. Delvers used to find no path and wait for
// the whole run. Blocked by actors, not by terrain, an actor walks the terrain
// route as far as it is free, which brings it into reach of whoever holds the way.

async function propose({ position, kinds, baseTiles, others = [] }) {
  const { createActorPersona } = await import("../../../packages/runtime/src/personas/actor/persona.js");
  const { TickPhases } = await import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts");
  const persona = createActorPersona({ clock: () => "fixed" });
  const actorId = "actor_delver";
  const payload = {
    actorId,
    observation: {
      tick: 0,
      actors: [{ id: actorId, kind: 2, position, motivation: { mobility: "exploring" } }, ...others],
      tiles: { kinds },
    },
    baseTiles,
  };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 }).actions;
}

const baseTiles = ["#######", "#.....E", "#######"];
const blocker = { id: "warden", kind: 2, position: { x: 4, y: 1 } };

test("an actor whose route is plugged by another actor still walks toward it", async () => {
  // The warden at (4,1) fills the one-wide corridor: kinds marks it blocked.
  const kinds = [[1, 1, 1, 1, 1, 1, 1], [1, 1, 0, 0, 1, 0, 1], [1, 1, 1, 1, 1, 1, 1]];
  const actions = await propose({ position: { x: 1, y: 1 }, kinds, baseTiles, others: [blocker] });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].kind, "move");
  assert.deepEqual(actions[0].params, { target: { x: 2, y: 1 } });
});

test("an actor next to the actor plugging its route does not try to step into it", async () => {
  const kinds = [[1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 1, 1, 0, 1], [1, 1, 1, 1, 1, 1, 1]];
  const actions = await propose({ position: { x: 3, y: 1 }, kinds, baseTiles, others: [blocker] });
  assert.ok(actions.every((action) => action.kind !== "move" || action.params.target.x !== 4));
});

test("a route walled off by terrain still yields no move", async () => {
  const walled = ["#######", "#..#..E", "#######"];
  const kinds = [[1, 1, 1, 1, 1, 1, 1], [1, 1, 0, 1, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1]];
  const actions = await propose({ position: { x: 1, y: 1 }, kinds, baseTiles: walled });
  assert.ok(actions.every((action) => action.kind !== "move"));
});

// ## TODO: Test Permutations
// - route plugged by several actors in a row (walks up to the first)
// - diagonal corner squeeze past a blocking actor
// - plugged exit approach itself (approach occupied, portal beyond)
