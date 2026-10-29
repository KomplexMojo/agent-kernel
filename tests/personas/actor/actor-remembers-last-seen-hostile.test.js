"use strict";

// #516: levels are unlit, so an actor without light sees only what is adjacent. A push or
// pull of two or more tiles (#482) puts the target out of sight, and an attacker that saw no
// hostile fell back to its exit walk or proposed nothing. The Actor now remembers where it last
// saw a hostile: an attacker walks there and looks again, and forgets once that tile is back in
// sight with no one there, once it sees that actor defeated, or the moment it sees a hostile anew. A remembered hostile is never cast at, and
// a defender still holds. The memory is plain data in the Actor's view, so a restored Actor
// carries on the same way.

const assert = require("node:assert/strict");

const baseTiles = ["#########", "#.......#", "#########"];
const kinds = [[1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 0, 0, 0, 1], [1, 1, 1, 1, 1, 1, 1, 1, 1]];

// A restoring kind harms by pulling: its push heals, so it is never aimed at a hostile.
const RESTORING = new Set(["growth", "fortify", "light"]);
function actor({ kind = "fire", motivations = ["attacking"], ...overrides } = {}) {
  const expression = RESTORING.has(kind) ? "pull" : "push";
  return {
    id: "self", category: "warden", alignment: "dungeon", lifecycle: "alive", position: { x: 1, y: 1 },
    capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: false },
    motivations, affinities: [{ kind, expression, stacks: 3 }], activeAffinityKey: `${kind}:${expression}`,
    vitals: { mana: { current: 40, max: 40, regen: 0 } }, ...overrides,
  };
}
const delver = (x) => ({ id: "delver", category: "delver", alignment: "external", lifecycle: "alive",
  position: { x, y: 1 }, capabilities: { canMove: true }, motivations: ["user_controlled"], affinities: [],
  vitals: { health: { current: 10, max: 10, regen: 0 } } });

async function createTurns(from) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const persona = createActorPersona({ clock: () => "2026-10-26T00:00:00.000Z", ...(from ? { from } : {}) });
  const turn = (tick, self, seen = []) => {
    const observation = { tick, actors: [self, ...seen], tiles: { kinds } };
    const payload = { actorId: self.id, observation, baseTiles, initialState: { actors: [self, delver(7)] } };
    if (persona.view().state !== "idle" && persona.view().state !== "cooldown") {
      persona.advance({ phase: TickPhases.DECIDE, event: "cooldown", payload, tick });
    }
    persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick });
    persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick });
    const { actions } = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick });
    persona.advance({ phase: TickPhases.DECIDE, event: "cooldown", payload, tick });
    return actions.filter((action) => action.kind !== "emit_log" && action.kind !== "emit_telemetry");
  };
  return { turn, view: () => persona.view() };
}
const moveTargets = (actions) => actions.filter((action) => action.kind === "move").map((action) => action.params.target);

for (const kind of ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"]) {
  test(`an attacker with ${kind} walks to where it last saw a hostile that left its sight`, async () => {
    const { turn } = await createTurns();
    const seen = turn(1, actor({ kind }), [delver(4)]);
    assert.ok(seen.some((action) => action.kind === "cast_affinity"), "in reach and in sight: it casts");
    // Knocked back out of sight: the attacker sees no one, and closes on the last sighting.
    assert.deepEqual(moveTargets(turn(2, actor({ kind }))), [{ x: 2, y: 1 }]);
    assert.deepEqual(moveTargets(turn(3, actor({ kind, position: { x: 2, y: 1 } }))), [{ x: 3, y: 1 }]);
  });
}

test("a remembered hostile is not cast at, even within reach", async () => {
  const { turn } = await createTurns();
  turn(1, actor(), [delver(3)]);
  const actions = turn(2, actor());
  assert.deepEqual(actions.filter((action) => action.kind === "cast_affinity"), []);
  assert.deepEqual(moveTargets(actions), [{ x: 2, y: 1 }]);
});

test("back in sight of where it last saw the hostile and seeing no one, the attacker forgets it", async () => {
  const { turn, view } = await createTurns();
  turn(1, actor(), [delver(4)]);
  assert.deepEqual(view().context.contacts, { self: { targetId: "delver", position: { x: 4, y: 1 }, tick: 1 } });
  turn(2, actor({ position: { x: 3, y: 1 } }));
  assert.equal(view().context.contacts, undefined);
  assert.deepEqual(moveTargets(turn(3, actor({ position: { x: 3, y: 1 } }))), [], "nothing left to walk to");
});

test("a remembered hostile seen again defeated is not pursued", async () => {
  const { turn, view } = await createTurns();
  turn(1, actor(), [delver(4)]);
  const defeated = { ...delver(6), lifecycle: "defeated" };
  assert.deepEqual(moveTargets(turn(2, actor({ position: { x: 7, y: 1 } }), [defeated])), []);
  assert.equal(view().context.contacts, undefined);
});

test("a new sighting replaces the old one", async () => {
  const { turn, view } = await createTurns();
  turn(1, actor(), [delver(4)]);
  turn(2, actor({ position: { x: 2, y: 1 } }), [delver(3)]);
  assert.deepEqual(view().context.contacts.self, { targetId: "delver", position: { x: 3, y: 1 }, tick: 2 });
});

test("a defender that loses sight of a hostile holds its ground", async () => {
  const { turn, view } = await createTurns();
  turn(1, actor({ motivations: ["defending"] }), [delver(3)]);
  assert.deepEqual(moveTargets(turn(2, actor({ motivations: ["defending"] }))), []);
  assert.equal(view().context.contacts, undefined, "only an actor that pursues keeps a sighting");
});

test("the sighting is in the Actor's view: a restored Actor keeps pursuing", async () => {
  const first = await createTurns();
  first.turn(1, actor(), [delver(4)]);
  const restored = await createTurns(first.view());
  assert.deepEqual(moveTargets(restored.turn(2, actor())), [{ x: 2, y: 1 }]);
});

test("an attacker that also roams at random closes on its last sighting first", async () => {
  const roamer = (position) => actor({ motivations: ["attacking", "random"], position,
    affinities: [{ kind: "fire", expression: "push", stacks: 1 }] });
  for (let tick = 1; tick <= 12; tick += 1) {
    const { turn } = await createTurns();
    assert.deepEqual(moveTargets(turn(tick, roamer({ x: 5, y: 1 }), [delver(2)])), [{ x: 4, y: 1 }]);
    const actions = turn(tick + 1, roamer({ x: 4, y: 1 }));
    assert.deepEqual(moveTargets(actions), [{ x: 3, y: 1 }], `tick ${tick + 1}: ${JSON.stringify(actions)}`);
  }
});

// ## TODO: Test Permutations
// - a sighting behind a raised barrier: the route opens through it as findPath allows
// - two hostiles seen at once: the nearer is remembered, ties by actor order
// - an attacker with light (sight beyond one tile) sees the knocked-back target and casts again
// - a sighting the attacker cannot reach (no route) leaves its other motivations to play
// - pull knockback (towards the caster) and push knockback at 2..6 tiles for every kind
