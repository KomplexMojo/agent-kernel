/**
 * The Actor's hostility ruling must REACH the decision envelope, not stop at
 * the deterministic path.
 *
 * THE DEFECT THIS FORBIDS, and why it is worth its own file. DS.2 taught this
 * program the difference between a rule that is correct and a rule that is
 * reachable: `rolesAreAllied` was right the day it was written and completely
 * inert in production, because the data it read was never populated. The
 * persona suite was green throughout. ⇒ *A rule the solver path cannot see is a
 * rule that is not enforced, and nothing about the deterministic path's tests
 * would ever say so.*
 *
 * So this file asserts the SPECIFIC VALUES on the envelope — `hostile: false`
 * for the ally and `hostile: true` for the warden — rather than that the field
 * exists. A shape test here would pass against a stub that stamped `hostile`
 * on everything, which is exactly the ally-targeting bug wearing a new field.
 *
 * Companion: `actor-decision-objective.test.js` proves that the Actor consumes
 * this ruling when it authors compatibility tuples. The adapter deliberately
 * treats both hostility and action meaning as opaque data.
 */
"use strict";

const assert = require("node:assert/strict");

function makeFloorGrid(w, h) {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) =>
      x === 0 || x === w - 1 || y === 0 || y === h - 1 ? "#" : "."
    ).join("")
  );
}

const BASE_TILES = makeFloorGrid(7, 3);

// delver_a(1,1) — delver_b(2,1) ally — warden_1(4,1) enemy
const OBSERVATION = Object.freeze({
  actors: [
    { id: "delver_a", kind: 2, position: { x: 1, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
    { id: "delver_b", kind: 2, position: { x: 2, y: 1 }, role: "delver", motivation: { kind: "attacking" } },
    { id: "warden_1", kind: 2, position: { x: 4, y: 1 }, role: "warden" },
  ],
  tiles: { baseTiles: BASE_TILES },
  exit: { x: 5, y: 1 },
});

const RUNTIME_DECISIONING = Object.freeze({
  enabled: true,
  mode: "solver",
  preferred: "solver",
  targetAdapter: "z3",
});

async function solverEnvelopeFor(actorId, observation = OBSERVATION) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const persona = createActorPersona({ clock: () => "fixed" });
  const payload = {
    actorId,
    observation,
    baseTiles: BASE_TILES,
    runtimeDecisioning: RUNTIME_DECISIONING,
  };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });

  const solverEffect = (result.effects || []).find((effect) => effect?.kind === "solver_request");
  assert.ok(solverEffect, "the actor emitted no solver request, so there is no envelope to inspect");
  return solverEffect.request?.problem?.data;
}

function visible(envelope, id) {
  return (envelope?.visibleActors || []).find((entry) => entry?.id === id);
}

test("a fellow delver reaches the envelope marked NOT hostile", async () => {
  const envelope = await solverEnvelopeFor("delver_a");

  assert.equal(
    visible(envelope, "delver_b")?.hostile,
    false,
    "the ally arrived at the solver with no hostility ruling, or the wrong one. The Actor owns "
      + "what 'allied' means (`rolesAreAllied`); if that answer does not cross into the envelope, "
      + "the solver has to guess — and its guess has been 'everyone is an enemy'.",
  );
});

test("a warden reaches the same envelope marked hostile", async () => {
  const envelope = await solverEnvelopeFor("delver_a");

  assert.equal(
    visible(envelope, "warden_1")?.hostile,
    true,
    "marking the ally is only half the ruling. If the enemy is not marked hostile the delver has "
      + "nothing to pursue, and 'never chases an ally' would be satisfied by an actor that chases "
      + "nobody at all.",
  );
});

test("the warden's own envelope inverts both — hostility is relative to the observer", async () => {
  const envelope = await solverEnvelopeFor("warden_1");

  assert.equal(visible(envelope, "delver_a")?.hostile, true);
  assert.equal(visible(envelope, "delver_b")?.hostile, true);
});

test("two wardens are allies to each other, not merely 'not delvers'", async () => {
  const observation = {
    ...OBSERVATION,
    actors: [
      { id: "warden_a", kind: 2, position: { x: 1, y: 1 }, role: "warden", motivation: { kind: "attacking" } },
      { id: "warden_b", kind: 2, position: { x: 2, y: 1 }, role: "warden" },
      { id: "delver_1", kind: 2, position: { x: 4, y: 1 }, role: "delver" },
    ],
  };
  const envelope = await solverEnvelopeFor("warden_a", observation);

  assert.equal(visible(envelope, "warden_b")?.hostile, false);
  assert.equal(visible(envelope, "delver_1")?.hostile, true);
});

test("an actor with NO role marks everyone hostile — unknown must never mean allied", async () => {
  const observation = {
    ...OBSERVATION,
    actors: [
      { id: "nameless_a", kind: 2, position: { x: 1, y: 1 }, motivation: { kind: "attacking" } },
      { id: "nameless_b", kind: 2, position: { x: 2, y: 1 } },
    ],
  };
  const envelope = await solverEnvelopeFor("nameless_a", observation);

  assert.equal(
    visible(envelope, "nameless_b")?.hostile,
    true,
    "two actors with missing roles compared equal and were called allies. That is the exact "
      + "failure DS.2's fail-safe exists to prevent: it pacifies every run without role data "
      + "while every 'does not attack an ally' assertion stays green.",
  );
});

// ## TODO: Test Permutations
// - an actor whose role is present but empty/whitespace: still hostile to everyone
// - roles differing only in case ("Delver" vs "delver"): allied, matching rolesAreAllied's folding
// - a third role beyond delver/warden ("boss"): allied only with its own kind
// - an observation where only SOME actors carry roles: the unlabelled ones stay hostile
// - the envelope's visibleActors order matches the observation order (replay stability)
