"use strict";

// #645: an exploring delver sees only what is adjacent, so a warden that patrols a one-wide
// gateway is in sight from one cell and out of sight from the next. The delver walked to the
// gateway, saw it held, stepped back along the longer detour, lost sight, and re-planned the
// shortest route through the gateway: a stable two-cycle that never arrived. Stepping back is
// not the answer to a way that is held for a moment. When the shortest route is held by another
// actor and the only other route starts with a step that does not close on the exit, the delver
// now holds ground or takes that detour on a seeded per-tick coin: stateless (the context stays
// serializable), deterministic for a seed and tick, and it breaks the lockstep with a patrol.
// A detour that closes on the exit, or a route nobody holds, is walked as before.

const assert = require("node:assert/strict");

async function propose({ position, kinds, baseTiles, others = [], tick = 0, seed }) {
  const { createActorPersona } = await import("../../../packages/runtime/src/personas/actor/persona.js");
  const { TickPhases } = await import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts");
  const persona = createActorPersona({ clock: () => "fixed" });
  const actorId = "actor_delver";
  const motivation = { mobility: "exploring", ...(seed === undefined ? {} : { seed }) };
  const payload = {
    actorId,
    tick,
    observation: {
      tick,
      actors: [{ id: actorId, kind: 2, position, motivations: ["exploring"], motivation }, ...others],
      tiles: { kinds },
    },
    baseTiles,
  };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick }).actions
    .filter((action) => action.kind !== "emit_log" && action.kind !== "emit_telemetry")
    .map(({ kind, params }) => (params === undefined ? { kind } : { kind, params }));
}

// A loop: the top corridor reaches the exit (E) in one run; the bottom corridor is the long way round.
//   y1  #........E     x1..8, exit portal at (9,1)
//   y2  #.######.#
//   y3  #........#
const loopTiles = [
  "##########",
  "#........E",
  "#.######.#",
  "#........#",
  "##########",
];
const loopKinds = (blocked) => loopTiles.map((row, y) => [...row].map((cell, x) => {
  if (cell === "#" || cell === "E") return 1;
  return blocked.some((b) => b.x === x && b.y === y) ? 1 : 0;
}));
const warden = (x, y) => ({ id: "warden", kind: 2, alignment: "dungeon", position: { x, y } });

// An open room: going round the blocker costs nothing over going through it.
const roomTiles = ["##########", "#........E", "#........#", "#........#", "##########"];
const roomKinds = (blocked) => roomTiles.map((row, y) => [...row].map((cell, x) => {
  if (cell === "#" || cell === "E") return 1;
  return blocked.some((b) => b.x === x && b.y === y) ? 1 : 0;
}));

const TICKS = Array.from({ length: 24 }, (_, tick) => tick);

test("a route nobody holds is walked every tick", async () => {
  for (const tick of TICKS) {
    const actions = await propose({ position: { x: 2, y: 1 }, kinds: loopKinds([]), baseTiles: loopTiles, tick });
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0], { kind: "move", params: { target: { x: 3, y: 1 } } });
  }
});

test("a way held by an actor, with a detour that starts by stepping back, is held or detoured, never walked into", async () => {
  const seen = new Set();
  for (const tick of TICKS) {
    const actions = await propose({
      position: { x: 2, y: 1 }, kinds: loopKinds([{ x: 3, y: 1 }]), baseTiles: loopTiles, others: [warden(3, 1)], tick,
    });
    assert.equal(actions.length, 1);
    assert.ok(actions[0].kind === "wait" || actions[0].kind === "move");
    if (actions[0].kind === "move") assert.deepEqual(actions[0].params.target, { x: 1, y: 1 });
    seen.add(actions[0].kind);
  }
  assert.deepEqual([...seen].sort(), ["move", "wait"], "a mix of holding and detouring breaks the cycle");
});

test("the hold-or-detour choice is the same for the same seed and tick, and differs between seeds", async () => {
  const run = async (seed) => {
    const out = [];
    for (const tick of TICKS) {
      const actions = await propose({
        position: { x: 2, y: 1 }, kinds: loopKinds([{ x: 3, y: 1 }]), baseTiles: loopTiles, others: [warden(3, 1)], tick, seed,
      });
      out.push(actions[0].kind);
    }
    return out.join(",");
  };
  assert.equal(await run(7), await run(7));
  assert.notEqual(await run(7), await run(8));
});

test("a way round the holder that loses nothing is walked every tick", async () => {
  for (const tick of TICKS) {
    const actions = await propose({
      position: { x: 2, y: 2 }, kinds: roomKinds([{ x: 3, y: 2 }]), baseTiles: roomTiles, others: [warden(3, 2)], tick,
    });
    assert.equal(actions.length, 1);
    assert.equal(actions[0].kind, "move");
    assert.notDeepEqual(actions[0].params.target, { x: 3, y: 2 });
  }
});

// ## TODO: Test Permutations
// - a longer detour whose first step closes on the exit is walked every tick
// - the blocker is a barrier (terrain, not an actor): the detour is walked every tick
// - the blocker is an ally rather than a hostile
// - the delver is already at the exit approach (portal step is not held)
// - a three-cell-wide hold of the gateway (two actors in a row)
