"use strict";

// #516: an attacker soaked by a water push (#420 adds stamina to every step) kept proposing a
// diagonal step it could not pay for, refused by core turn after turn. As with casts (#367),
// the Actor proposes only a move core would accept: its price is the authored cardinal cost
// (`simConfig.actionCosts.movementStamina`) on core's own rule, diagonal and soak included.
// A turn whose every move is too dear waits instead, and the wait lets stamina recover.

const assert = require("node:assert/strict");

const baseTiles = ["#####", "#...#", "#...#", "#####"];
const kinds = [[1, 1, 1, 1, 1], [1, 0, 0, 0, 1], [1, 0, 0, 0, 1], [1, 1, 1, 1, 1]];

async function propose({ self, others = [], movementStamina }) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const persona = createActorPersona({ clock: () => "2026-10-26T00:00:00.000Z" });
  const observation = { tick: 1, actors: [self, ...others], tiles: { kinds } };
  const payload = { actorId: self.id, observation, baseTiles, initialState: { actors: [self, ...others] },
    simConfig: movementStamina ? { actionCosts: { castManaBase: {}, movementStamina } } : undefined };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 1 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 1 });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 1 }).actions
    .filter((action) => action.kind !== "emit_log" && action.kind !== "emit_telemetry");
}

// An attacker with no cast, two tiles from a hostile on the diagonal: its only way in is a step.
function attacker({ stamina, soaked, position = { x: 1, y: 2 } } = {}) {
  return {
    id: "self", category: "delver", alignment: "external", lifecycle: "alive", position,
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: false },
    motivations: ["attacking"], affinities: [], ...(soaked ? { soaked } : {}),
    vitals: { stamina: { current: stamina, max: 10, regen: 1 } },
  };
}
const warden = { id: "warden", category: "warden", alignment: "dungeon", lifecycle: "alive", position: { x: 3, y: 1 },
  capabilities: { canMove: true }, motivations: ["stationary"], affinities: [] };
const step = (actions) => actions.map((action) => action.kind === "move" ? action.params.target : action.kind);

test("with stamina for the diagonal step, the attacker takes it", async () => {
  assert.deepEqual(step(await propose({ self: attacker({ stamina: 2 }), others: [warden], movementStamina: { self: 1 } })),
    [{ x: 2, y: 1 }]);
});

test("short of the diagonal price, it waits a turn rather than be refused", async () => {
  assert.deepEqual(step(await propose({ self: attacker({ stamina: 1 }), others: [warden], movementStamina: { self: 1 } })),
    ["wait"]);
});

test("soaked, every step costs one more: the step it could afford dry, it waits for", async () => {
  assert.deepEqual(step(await propose({ self: attacker({ stamina: 2, soaked: 2 }), others: [warden],
    movementStamina: { self: 1 } })), ["wait"]);
  assert.deepEqual(step(await propose({ self: attacker({ stamina: 3, soaked: 2 }), others: [warden],
    movementStamina: { self: 1 } })), [{ x: 2, y: 1 }]);
});

test("without an authored movement cost the Actor keeps proposing by route alone", async () => {
  assert.deepEqual(step(await propose({ self: attacker({ stamina: 0 }), others: [warden] })), [{ x: 2, y: 1 }]);
});

// ## TODO: Test Permutations
// - a sprint (`via`) proposed by a strategy is priced as core prices it, soak per step
// - cardinal costs 0..3 against stamina just below and at the price, diagonal and cardinal
// - an exploring and a patrolling actor short of stamina wait too
// - a strategy's goal step that is too dear waits, and the strategy's progress is kept
