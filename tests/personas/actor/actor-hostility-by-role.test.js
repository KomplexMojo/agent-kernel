/**
 * DS.1 / DS.2 — hostility is determined by ROLE, not by "anyone who isn't me".
 *
 * THE DEFECT THESE TESTS FORBID (live on `main` when they were written).
 * `resolveNearestHostile` (`personas/actor/controller.js`) documents itself as
 * finding "the nearest hostile actor (any actor other than self)" — and that is
 * literally what it does. There is no faction, team, or allegiance concept
 * anywhere in the data model, so in any run with two delvers, delver A treats
 * delver B as the nearest hostile and will close on and attack its own ally
 * whenever the ally happens to be nearer than a warden.
 *
 * Maintainer ruling (2026-08-20): delvers are friendly to delvers, wardens are
 * friendly to wardens, delvers and wardens are hostile to each other. There are
 * only ever two actor roles (`artifacts.ts` — `kind: "delver" | "warden"`), so
 * `role` already IS a sufficient faction system; no new field is needed.
 *
 * WHY THESE ARE FORBIDDING TESTS, NOT SHAPE TESTS. The first assertion in each
 * pair says the actor must NEVER target an ally — it forbids the capability
 * rather than matching one spelling of correct behavior. The second says the
 * actor must still engage the real enemy, because "never attacks an ally" is
 * trivially satisfied by an actor that does nothing at all, and a test that
 * cannot tell correct behavior from paralysis is not a test.
 *
 * Scope note: these run the persona directly with roles set on the observation,
 * which is how every actor persona test already supplies them. DS.1 (threading
 * role through the REAL runtime observation, where core supplies no role at all)
 * is covered separately once these pass.
 */
"use strict";

const assert = require("node:assert/strict");

// ---------------------------------------------------------------------------
// Helpers — mirrors tests/personas/actor/actor-motivation-combat.test.js
// ---------------------------------------------------------------------------

/** Build a floor-only baseTiles grid ('#' border, '.' interior). */
function makeFloorGrid(w, h) {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      x === 0 || x === w - 1 || y === 0 || y === h - 1 ? "#" : "."
    ).join("")
  );
}

async function loadPersonaDeps() {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  return { createActorPersona, TickPhases };
}

async function oneProposeCycle({ actorId, observation, baseTiles, payload = {} }) {
  const { createActorPersona, TickPhases } = await loadPersonaDeps();
  const persona = createActorPersona({ clock: () => "fixed" });
  const base = { actorId, observation, baseTiles, ...payload };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload: base, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload: base, tick: 0 });
  return persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload: base, tick: 0 });
}

/** Every action this cycle that attacks `targetId`, whatever its shape. */
function attacksAgainst(result, targetId) {
  const actions = Array.isArray(result?.actions) ? result.actions : [];
  return actions.filter((action) => {
    if (!action || action.kind !== "attack") return false;
    return action.params?.targetId === targetId;
  });
}

// ---------------------------------------------------------------------------
// Delver + delver: allies. The nearer ally must not become the target.
// ---------------------------------------------------------------------------

const ALLY_ADJACENT_BOARD = Object.freeze({
  baseTiles: makeFloorGrid(7, 3),
  //  delver_a(1,1) — delver_b(2,1) adjacent ally — warden_1(4,1) real enemy
  observation: Object.freeze({
    actors: [
      { id: "delver_a", kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: "delver_b", kind: 2, position: { x: 2, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: "warden_1", kind: 2, position: { x: 4, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles: makeFloorGrid(7, 3) },
    exit: { x: 5, y: 1 },
  }),
});

test("an attacking delver never attacks a fellow delver, even when the ally is the nearest actor", async () => {
  const result = await oneProposeCycle({
    actorId: "delver_a",
    observation: ALLY_ADJACENT_BOARD.observation,
    baseTiles: ALLY_ADJACENT_BOARD.baseTiles,
  });

  assert.deepEqual(
    attacksAgainst(result, "delver_b"),
    [],
    "delver_a attacked its own ally. Hostility must come from role (delver vs warden), not from "
      + "'any actor other than self' — an ally standing adjacent is the single most likely way "
      + "for the old rule to pick the wrong target.",
  );
});

test("with an ally adjacent and a warden beyond it, the delver still engages the warden", async () => {
  const result = await oneProposeCycle({
    actorId: "delver_a",
    observation: ALLY_ADJACENT_BOARD.observation,
    baseTiles: ALLY_ADJACENT_BOARD.baseTiles,
  });

  assert.ok(
    Array.isArray(result.actions) && result.actions.length > 0,
    "an attacking delver with a reachable warden must propose something — 'never attacks an ally' "
      + "is trivially satisfied by an actor that has stopped acting entirely, so this pairs with "
      + "the forbidding test above to distinguish correct targeting from paralysis",
  );
  const action = result.actions[0];
  assert.equal(action.kind, "move", "warden is 3 tiles away, so the engagement move comes first");
  assert.equal(
    action.params?.direction,
    "east",
    "the warden is east; moving any other way means the delver is still resolving toward the ally",
  );
});

// ---------------------------------------------------------------------------
// Warden + warden: the same rule, from the other side of the board.
// Wardens are the defending faction, so this is not a mirror-image duplicate —
// it proves the rule is about role equality, not about the string "delver".
// ---------------------------------------------------------------------------

test("an attacking warden never attacks a fellow warden", async () => {
  const baseTiles = makeFloorGrid(7, 3);
  const observation = {
    actors: [
      { id: "warden_a", kind: 2, position: { x: 1, y: 1 }, role: "warden", motivation: { kind: "attacking" } },
      { id: "warden_b", kind: 2, position: { x: 2, y: 1 }, role: "warden", motivation: { kind: "attacking" } },
      { id: "delver_1", kind: 2, position: { x: 4, y: 1 }, role: "delver" },
    ],
    tiles: { baseTiles },
    exit: { x: 5, y: 1 },
  };

  const result = await oneProposeCycle({ actorId: "warden_a", observation, baseTiles });

  assert.deepEqual(
    attacksAgainst(result, "warden_b"),
    [],
    "wardens work collectively (maintainer ruling 2026-08-20) — a warden that attacks another "
      + "warden means the rule was written against the literal role 'delver' rather than against "
      + "role equality",
  );
});

// ---------------------------------------------------------------------------
// The cross-role case must still fight. If this ever goes green while the tests
// above also pass by making nothing hostile, the rule has pacified the game.
// ---------------------------------------------------------------------------

test("a delver adjacent to a warden still attacks it — the rule narrows hostility, it does not remove it", async () => {
  const baseTiles = makeFloorGrid(7, 3);
  const observation = {
    actors: [
      { id: "delver_a", kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: "warden_1", kind: 2, position: { x: 2, y: 1 }, role: "warden" },
    ],
    tiles: { baseTiles },
    exit: { x: 5, y: 1 },
  };

  const result = await oneProposeCycle({ actorId: "delver_a", observation, baseTiles });

  assert.equal(
    attacksAgainst(result, "warden_1").length,
    1,
    "an adjacent cross-role enemy must still be attacked. Without this, a rule that made NOTHING "
      + "hostile would satisfy every other test in this file — which is the failure mode of "
      + "comparing two undefined roles and concluding 'same role, therefore friendly'.",
  );
});

// ---------------------------------------------------------------------------
// THE SILENT-CEASEFIRE TRAP. These two are the reason the rule is written as
// "allied only when BOTH roles are known and equal" rather than the obvious
// `selfRole === otherRole`.
//
// Under naive equality, two actors with NO role compare equal, so every actor
// becomes every other actor's ally, `resolveNearestHostile` returns null for
// everyone, and combat stops across the entire game. Every other test in this
// file would still pass — they all set roles explicitly — so nothing above
// catches it. That is the guard-spelling trap this repo keeps re-finding: an
// assertion that matches one shape of correct behaviour instead of forbidding
// the defect. These two forbid it.
// ---------------------------------------------------------------------------

test("two actors with NO roles remain hostile — missing data must never pacify the game", async () => {
  const baseTiles = makeFloorGrid(7, 3);
  const observation = {
    actors: [
      { id: "actor_a", kind: 2, position: { x: 1, y: 1 }, motivation: { kind: "attacking" } },
      { id: "actor_b", kind: 2, position: { x: 2, y: 1 } },
    ],
    tiles: { baseTiles },
    exit: { x: 5, y: 1 },
  };

  const result = await oneProposeCycle({ actorId: "actor_a", observation, baseTiles });

  assert.equal(
    attacksAgainst(result, "actor_b").length,
    1,
    "with no role data, behaviour must fall back to the pre-DS.2 status quo (hostile), not to "
      + "'same role, therefore friendly'. If this fails, `rolesAreAllied` has been simplified to "
      + "naive equality and combat has silently stopped everywhere role data is absent.",
  );
});

test("a known role against a missing role remains hostile", async () => {
  const baseTiles = makeFloorGrid(7, 3);
  const observation = {
    actors: [
      { id: "delver_a", kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
      { id: "unknown_1", kind: 2, position: { x: 2, y: 1 } },
    ],
    tiles: { baseTiles },
    exit: { x: 5, y: 1 },
  };

  const result = await oneProposeCycle({ actorId: "delver_a", observation, baseTiles });

  assert.equal(
    attacksAgainst(result, "unknown_1").length,
    1,
    "an actor of unknown allegiance is not an ally. Half-known role data is the likely real-world "
      + "case during DS.1's rollout, and it must not read as friendly.",
  );
});

// ## TODO: Test Permutations
// - three delvers and one warden: the warden is targeted regardless of how many
//   allies sit between the actor and it
// - an ally EXACTLY as near as an enemy (tie): the enemy is chosen, deterministically
// - defending motivation with an adjacent ally: holds position, does not attack it
// - stationary motivation with an adjacent enemy: attacks without moving
// - the same board run twice: identical target selection both times (replay safety)
