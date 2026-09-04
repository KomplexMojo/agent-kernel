/**
 * Stage A — the same tile is not equally dangerous to every actor.
 *
 * WHY THIS TEST EXISTS SEPARATELY from the core-ts rule test. `resolveExposureVitalEffect`
 * being correct proves nothing about whether the Actor CALLS it. An earlier draft of this
 * wiring read only string affinity names, while core's field readers emit numeric codes,
 * so it resolved no field at all and did exactly nothing — and every pre-existing test
 * still passed, because none of them gave an actor a grant. This drives the real persona
 * seam with two actors who differ ONLY in the affinity they hold.
 */
"use strict";

const assert = require("node:assert/strict");

const BASE_TILES = ["#####", "#...#", "#...#", "#...#", "##E##"];
const FIRE = 1;
const EMIT = 3;
const HEALTH_VITAL = 0;

async function fieldSafetyFor(grants) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const self = {
    id: "delver_1",
    kind: 2,
    role: "delver",
    position: { x: 2, y: 2 },
    motivation: { kind: "random" },
    vitals: { health: { current: 5, max: 10, regen: 0 } },
    affinityGrants: grants,
  };
  const observation = {
    actors: [self],
    tiles: {
      baseTiles: BASE_TILES,
      kinds: BASE_TILES.map((line) => Array.from(line, (tile) => (tile === "#" ? 1 : 0))),
    },
    exit: { x: 2, y: 4 },
    // A harmful fire field on the tile immediately east.
    affinityFields: [{
      position: { x: 3, y: 2 },
      kind: FIRE,
      expression: EMIT,
      stacks: 2,
      intensity: 2,
      contributionCount: 1,
      vitalEffects: [{ vital: HEALTH_VITAL, effect: -4 }],
    }],
  };
  const payload = {
    actorId: self.id,
    observation,
    baseTiles: BASE_TILES,
    initialState: { actors: [{ id: self.id, role: self.role, kind: "motivated", runtimeDecisioning: true }] },
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
    proposals: [
      { kind: "move", params: { direction: "east", from: self.position, to: { x: 3, y: 2 } } },
      { kind: "move", params: { direction: "south", from: self.position, to: { x: 2, y: 3 } } },
    ],
  };
  const persona = createActorPersona({ clock: () => "fixed" });
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });
  const data = result.effects.find((effect) => effect?.kind === "solver_request").request.problem.data;
  const rows = data.objectives.actorDecision.candidates;
  const eastRow = rows.find((row) => row.features?.endPosition?.x === 3 && row.features?.endPosition?.y === 2);
  assert.ok(eastRow, "the eastward move into the field must be one of the ranked candidates");
  return eastRow.features.fieldSafety;
}

test("an actor with no affinity reads the fire field as harmful, exactly as before", async () => {
  assert.equal(await fieldSafetyFor([]), -4);
});

test("an unrelated affinity does not make the fire field any safer", async () => {
  const corrode = [{ kind: "corrode", expression: "emit", stacks: 3, mana: 5, manaMax: 5, manaRegen: 0 }];
  assert.equal(await fieldSafetyFor(corrode), -4, "corrode has no relationship to fire");
});

test("an actor holding FIRE is unharmed by a fire field — the Stage A behaviour change", async () => {
  const fire = [{ kind: "fire", expression: "emit", stacks: 2, mana: 5, manaMax: 5, manaRegen: 0 }];
  assert.equal(await fieldSafetyFor(fire), 0);
});

test("an actor holding WATER suffers amplified harm in a fire field", async () => {
  const water = [{ kind: "water", expression: "emit", stacks: 2, mana: 5, manaMax: 5, manaRegen: 0 }];
  assert.equal(await fieldSafetyFor(water), -8, "fire's opposite takes double exposure");
});

test("a zero-stack grant is not an affinity and confers no immunity", async () => {
  const spent = [{ kind: "fire", expression: "emit", stacks: 0, mana: 0, manaMax: 5, manaRegen: 0 }];
  assert.equal(await fieldSafetyFor(spent), -4);
});

// ## TODO: Test Permutations
// - an actor holding both fire and water reads fire as its own, not as its opposite
// - a field whose vital the actor cannot lose is unaffected by the relationship
// - two overlapping fields of different kinds resolve independently per field
