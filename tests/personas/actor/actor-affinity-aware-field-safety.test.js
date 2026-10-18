/** Unified fields are evaluated against only the active owned pair. */
"use strict";

const assert = require("node:assert/strict");

const BASE_TILES = ["#####", "#...#", "#...#", "#...#", "##E##"];
const FIRE = "fire";
const EMIT = "emit";

async function fieldRanksFor(grants, active = true) {
  const [{ createActorPersona }, { TickPhases }] = await Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  const self = {
    id: "delver_1",
    lifecycle: "alive",
    defeatVital: "health",
    alignment: "external",
    position: { x: 2, y: 2 },
    motivation: { kind: "random" },
    // A mana vital with headroom, because a converted benefit is capped at the matching
    // vital's MISSING capacity. An actor with no mana vital has nowhere to put the
    // conversion and correctly ranks no benefit from it -- which is a real behaviour, but
    // not the one these tests are about.
    vitals: { health: { current: 5, max: 10, regen: 0 }, mana: { current: 1, max: 9, regen: 0 } },
    affinities: grants.map(({ kind, expression, stacks }) => ({ kind, expression, stacks })),
    activeAffinityKey: active && grants.length ? `${grants[0].kind}:${grants[0].expression}` : null,
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
      sourceId: "fire_source",
      stacks: 4,
      intensity: 2,
      falloff: 0.5,
    }],
  };
  const payload = {
    actorId: self.id,
    observation,
    baseTiles: BASE_TILES,
    initialState: { actors: [{ id: self.id, role: self.role, kind: "motivated", runtimeDecisioning: true }] },
    runtimeDecisioning: { enabled: true, mode: "solver", preferred: "solver", targetAdapter: "z3" },
    proposals: [
      { kind: "move", params: { target: { x: 3, y: 2 } } },
      { kind: "move", params: { target: { x: 2, y: 3 } } },
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
  return {
    safety: eastRow.features.fieldSafety,
    benefit: eastRow.features.fieldBenefit,
    effects: eastRow.features.fieldEffectsByVital,
  };
}

const fieldSafetyFor = async (grants) => (await fieldRanksFor(grants)).safety;

test("an actor with no affinity reads the fire field as harmful, exactly as before", async () => {
  assert.equal(await fieldSafetyFor([]), -2);
});

test("an unrelated affinity does not make the fire field any safer", async () => {
  const corrode = [{ kind: "corrode", expression: "emit", stacks: 3, mana: 5, manaMax: 5, manaRegen: 0 }];
  assert.equal(await fieldSafetyFor(corrode), -2, "corrode has no relationship to fire");
});

test("an actor holding FIRE is unharmed by a fire field — the Stage A behaviour change", async () => {
  const fire = [{ kind: "fire", expression: "emit", stacks: 2, mana: 5, manaMax: 5, manaRegen: 0 }];
  assert.equal(await fieldSafetyFor(fire), 0);
});

test("an actor holding WATER suffers amplified harm in a fire field", async () => {
  const water = [{ kind: "water", expression: "emit", stacks: 2, mana: 5, manaMax: 5, manaRegen: 0 }];
  assert.equal(await fieldSafetyFor(water), -4, "fire's opposite takes double exposure");
});

test("inactive owned fire does not confer immunity", async () => {
  const owned = [{ kind: "fire", expression: "emit", stacks: 8 }];
  assert.equal((await fieldRanksFor(owned, false)).safety, -2);
});

test("A.2 — a DRAW actor converts the fire field into mana instead of taking harm", async () => {
  // The whole reason the core signature moved to vital deltas: this actor must not merely
  // resist the field, it must come out with mana it did not have.
  const drawFire = [{ kind: "fire", expression: "draw", stacks: 2, mana: 1, manaMax: 9, manaRegen: 0 }];
  const ranks = await fieldRanksFor(drawFire);

  assert.equal(ranks.safety, 0, "the health harm is gone, not merely halved");
  assert.ok(
    ranks.effects.some((entry) => entry.vital === 1 && entry.effect > 0),
    `expected a positive mana effect, got ${JSON.stringify(ranks.effects)}`,
  );
  assert.ok(ranks.benefit > 0, "the converted mana is a ranked benefit, not just a spared harm");
});

test("A.2 — an EMIT actor of the same kind is immune but gains nothing", async () => {
  // Immunity and conversion are different outcomes and must not be conflated: only the
  // draw expression is built to absorb. If this ever reports a benefit, the matrix's
  // per-expression distinction has been flattened.
  const emitFire = [{ kind: "fire", expression: "emit", stacks: 2, mana: 1, manaMax: 9, manaRegen: 0 }];
  const ranks = await fieldRanksFor(emitFire);
  assert.equal(ranks.safety, 0);
  assert.equal(ranks.benefit, 0);
});

// ## TODO: Test Permutations
// - an actor owning fire and water uses only the explicitly active pair
// - a missing vital cannot acquire capacity from a beneficial field
// - two overlapping fields of different kinds resolve independently per field
