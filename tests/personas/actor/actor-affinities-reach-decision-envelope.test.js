/**
 * D5 — affinity state must reach the solver envelope from the Actor's real
 * observation record. Configured stacks describe what the actor can express;
 * live grant pools describe how scarce a resource-backed cast is. A scorer
 * needs both, and neither may alias the persona input across the boundary.
 */
"use strict";

const assert = require("node:assert/strict");

const BASE_TILES = [
  "#####",
  "#...#",
  "#####",
];

const AFFINITIES = Object.freeze([
  Object.freeze({ kind: "fire", expression: "push", targetType: "enemy", stacks: 2 }),
]);

const AFFINITY_GRANTS = Object.freeze([
  Object.freeze({
    kind: "water",
    expression: "emit",
    stacks: 3,
    mana: 7,
    manaMax: 12,
    manaRegen: 1,
  }),
]);

async function solverEnvelope() {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const observation = {
    actors: [
      {
        id: "delver_1",
        kind: 2,
        role: "delver",
        position: { x: 1, y: 1 },
        motivation: { kind: "attacking" },
        affinities: AFFINITIES,
        affinityGrants: AFFINITY_GRANTS,
      },
      { id: "warden_1", kind: 2, role: "warden", position: { x: 3, y: 1 } },
    ],
    tiles: { baseTiles: BASE_TILES },
    exit: { x: 3, y: 1 },
  };
  const payload = {
    actorId: "delver_1",
    observation,
    baseTiles: BASE_TILES,
    runtimeDecisioning: {
      enabled: true,
      mode: "solver",
      preferred: "solver",
      targetAdapter: "z3",
    },
  };
  const persona = createActorPersona({ clock: () => "fixed" });
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });
  const solverEffect = (result.effects || []).find((effect) => effect?.kind === "solver_request");
  assert.ok(solverEffect, "the Actor emitted no solver request to inspect");
  return solverEffect.request.problem.data;
}

test("the Actor's configured affinities and live grant pools reach its decision envelope", async () => {
  const envelope = await solverEnvelope();

  assert.deepEqual(envelope.actor.affinities, AFFINITIES);
  assert.deepEqual(envelope.actor.affinityGrants, AFFINITY_GRANTS);
  assert.notStrictEqual(envelope.actor.affinities, AFFINITIES);
  assert.notStrictEqual(envelope.actor.affinityGrants, AFFINITY_GRANTS);
  const castRow = envelope.objectives.actorDecision.candidates.find(
    (entry) => entry.candidateActionId === "cast_affinity_warden_1",
  );
  assert.equal(castRow.features.castReserveSource, "actor_mana");
  assert.equal(castRow.rank[4], 0, "a non-matching grant must not price a fire cast");
});

// ## TODO: Test Permutations
// - an actor with configured affinities but no resource grants carries an empty affinityGrants list
// - an actor with two grants of the same affinity preserves both independent mana pools and order
// - a temporary grant with manaRegen=0 remains distinguishable from a regenerating grant
// - an actor with no configured affinities but a collected resource grant still carries that grant
