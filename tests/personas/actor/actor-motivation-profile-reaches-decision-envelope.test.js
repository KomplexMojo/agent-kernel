/**
 * D6 — the Actor's AM.9 motivation profile must reach the solver envelope.
 * Numeric authority remains in core; readable names are boundary conveniences.
 */
"use strict";

const assert = require("node:assert/strict");

const BASE_TILES = [
  "#####",
  "#...#",
  "#####",
];

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

test("the Actor's core-derived motivation profile reaches its decision envelope", async () => {
  const envelope = await solverEnvelope();

  assert.deepEqual(envelope.actor.motivationProfile, {
    kind: "attacking",
    mobilityTier: 1,
    combatTier: 1,
    cognitionTier: 2,
    reasoningClass: 1,
    reasoningClassName: "Tactical",
    flagMask: 9,
    flags: ["CanMove", "AggroRangeBoost"],
  });
  assert.equal(envelope.objectives.actorDecision.contract, "actor-decision-objective-v6");
  assert.ok(envelope.objectives.actorDecision.candidates.every(
    (entry) => entry.features.mobilityTier === 1 && entry.features.combatTier === 1,
  ));
});

// ## TODO: Test Permutations
// - defending exposes its exact cognition tier, reasoning class, and cover preference
// - stealth exposes PrefersStealth without inventing a second flag vocabulary
// - strategy_focused exposes Strategic reasoning and its exact core-defined tiers
// - an unknown motivation kind omits the profile rather than guessing numeric policy
