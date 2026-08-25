import assert from "node:assert/strict";
import { ACTOR_VIABILITY_FLOOR, DEFAULT_VITALS } from "../../../packages/runtime/src/contracts/domain-constants.js";
import {
  applyActorViabilityFloor,
  applyViabilityDerivedVitalRequirements,
} from "../../../packages/runtime/src/personas/configurator/candidate-authoring.js";

// The least an actor can be and still be worth simulating.
//
// DEFAULT_VITALS is a zero, not a floor: health 1 with regen 0 dies to a single point of damage and
// never comes back, and the budget-minimum path authored exactly that because it was the cheapest
// thing that passed — benchmark scenario 92 has a model writing max:1 on all four vitals on purpose.

const vitals = (over = {}) => ({
  health: { current: 1, max: 1, regen: 0 },
  mana: { current: 0, max: 0, regen: 0 },
  stamina: { current: 0, max: 0, regen: 0 },
  durability: { current: 1, max: 1, regen: 0 },
  ...over,
});

test("the floor raises max, current and regen together for every vital it covers", () => {
  const v = applyActorViabilityFloor(vitals());
  for (const [key, floor] of Object.entries(ACTOR_VIABILITY_FLOOR)) {
    assert.equal(v[key].max, floor.max, `${key}.max`);
    assert.equal(v[key].regen, floor.regen, `${key}.regen`);
    assert.equal(v[key].current, v[key].max, `${key}.current must fill to max`);
  }
});

// The trap this file's neighbour records: the movement floor "came to be enforced on `regen` and
// missed on `max`". One function covering every field is the whole defence, so a vital added to the
// constant must not be able to arrive half-applied.
test("every vital in the constant is actually applied", () => {
  const v = applyActorViabilityFloor(vitals());
  for (const key of Object.keys(ACTOR_VIABILITY_FLOOR)) {
    assert.notDeepEqual(v[key], DEFAULT_VITALS[key], `${key} was declared in the floor but not applied`);
  }
});

test("stamina is deliberately outside the floor — its minimum is derived from movement", () => {
  assert.ok(!("stamina" in ACTOR_VIABILITY_FLOOR),
    "a fixed stamina floor would undercut a fast actor and overcharge a stationary one");
  const v = applyActorViabilityFloor(vitals());
  assert.deepEqual(v.stamina, { current: 0, max: 0, regen: 0 }, "stamina must be left to applyMovementStaminaFloor");
});

test("the floor raises and never lowers — an author who asked for more keeps it", () => {
  const rich = vitals({
    health: { current: 40, max: 50, regen: 3 },
    mana: { current: 100, max: 100, regen: 7 },
  });
  const v = applyActorViabilityFloor(rich);
  assert.deepEqual(v.health, { current: 40, max: 50, regen: 3 }, "a healthier actor must be untouched");
  assert.deepEqual(v.mana, { current: 100, max: 100, regen: 7 });
  // ...while the vital that was below the floor still comes up.
  assert.equal(v.durability.max, ACTOR_VIABILITY_FLOOR.durability.max);
});

test("a partly-configured actor keeps its damage deficit when the floor raises max", () => {
  // current < max is a damaged actor, not a malformed one. Raising the ceiling must not silently
  // heal it, which is what a blanket current = max would do.
  const v = applyActorViabilityFloor(vitals({ health: { current: 5, max: 6, regen: 0 } }));
  assert.equal(v.health.max, 10, "max comes up to the floor");
  assert.equal(v.health.current, 10, "current fills to the new max when it was below the floor");
});

test("the glue-facing form reports whether it changed anything", () => {
  assert.equal(applyViabilityDerivedVitalRequirements({ vitals: vitals() }), true);
  const alreadyFloored = { vitals: applyActorViabilityFloor(vitals()) };
  assert.equal(applyViabilityDerivedVitalRequirements(alreadyFloored), false,
    "a second application must be a no-op, or the glue would report drift on every rebuild");
});

test("it tolerates an actor with no vitals rather than throwing", () => {
  assert.equal(applyViabilityDerivedVitalRequirements({}), false);
  assert.equal(applyActorViabilityFloor(null), null);
});
