/** Live unified actor state crosses the solver boundary without aliases. */
"use strict";

const assert = require("node:assert/strict");

const BASE_TILES = [
  "#####",
  "#...#",
  "#####",
];

const AFFINITIES = Object.freeze([
  Object.freeze({ kind: "fire", expression: "push", stacks: 2 }),
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
        lifecycle: "alive", defeatVital: "health",
        motivations: ["attacking", "patrolling"], holdings: [],
        alignment: "external",
        position: { x: 1, y: 1 },
        motivation: { kind: "attacking" },
        affinities: AFFINITIES,
        activeAffinityKey: "fire:push",
        capabilities: { canMove: true, canCast: true, canEquip: true, canTake: true, canExit: true },
        vitals: { mana: { current: 6, max: 12, regen: 1 } },
        affinityGrants: AFFINITY_GRANTS,
      },
      { id: "warden_1", kind: 2, alignment: "dungeon", position: { x: 3, y: 1 },
        lifecycle: "alive", defeatVital: "health", vitals: { health: { current: 8, max: 10, regen: 0 } },
        affinities: [{ kind: "water", expression: "emit", stacks: 2 }], activeAffinityKey: "water:emit" },
    ],
    tiles: { baseTiles: BASE_TILES },
    exit: { x: 3, y: 1 },
  };
  const payload = {
    actorId: "delver_1",
    initialState: { actors: [{ id: "delver_1", alignment: "dungeon", runtimeDecisioning: true }] },
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
  return { envelope: solverEffect.request.problem.data, observation };
}

test("live common properties reach the envelope without legacy grant pools or aliases", async () => {
  const { envelope, observation } = await solverEnvelope();
  assert.deepEqual(envelope.actor.affinities, AFFINITIES);
  assert.equal(Object.hasOwn(envelope.actor, "affinityGrants"), false);
  assert.equal(Object.hasOwn(envelope.actor, "kind"), false);
  assert.equal(envelope.actor.activeAffinityKey, "fire:push");
  assert.equal(envelope.actor.alignment, "external", "live alignment overrides configured state");
  assert.equal(envelope.actor.lifecycle, "alive");
  assert.equal(envelope.actor.defeatVital, "health");
  assert.deepEqual(envelope.actor.motivations, ["attacking", "patrolling"]);
  assert.deepEqual(envelope.actor.holdings, []);
  const castRow = envelope.objectives.actorDecision.candidates.find(entry => entry.candidateActionId === "cast_affinity_warden_1");
  assert.equal(castRow.rank[6], 500);
  envelope.actor.vitals.mana.current = 0;
  envelope.actor.affinities[0].stacks = 99;
  envelope.actor.motivations.push("stationary");
  assert.equal(observation.actors[0].vitals.mana.current, 6);
  assert.equal(observation.actors[0].affinities[0].stacks, 2);
  assert.deepEqual(observation.actors[0].motivations, ["attacking", "patrolling"]);
  envelope.visibleActors[0].affinities[0].stacks = 50;
  envelope.visibleActors[0].vitals.health.current = 0;
  assert.equal(observation.actors[1].affinities[0].stacks, 2);
  assert.equal(observation.actors[1].vitals.health.current, 8);
});

// ## TODO: Test Permutations
// - Opponent equipment and holdings remain detached from live observations.
