const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");

let REQUIRED_VITALS = [];

test.before(async () => {
  const shared = await import("../../packages/runtime/src/contracts/domain-constants.js");
  REQUIRED_VITALS = Array.from(shared.VITAL_KEYS);
});

function assertVitals(actor, label) {
  assert.ok(actor.vitals, `${label} should include vitals`);
  for (const vital of REQUIRED_VITALS) {
    const values = actor.vitals[vital];
    assert.ok(values, `${label} should include ${vital}`);
    assert.equal(typeof values.current, "number", `${label} ${vital}.current should be numeric`);
    assert.equal(typeof values.max, "number", `${label} ${vital}.max should be numeric`);
    assert.equal(typeof values.regen, "number", `${label} ${vital}.regen should be numeric`);
  }
}

test("actor-state fixtures include full vitals defaults", () => {
  const motivated = readFixture("actor-state-v1-mvp.json");
  assert.equal(motivated.schema, "agent-kernel/ActorState");
  assert.equal(motivated.schemaVersion, 1);
  assert.equal(motivated.actor.kind, "motivated");
  assertVitals(motivated.actor, "motivated actor");

  const barrier = readFixture("actor-state-v1-barrier.json");
  assert.equal(barrier.schema, "agent-kernel/ActorState");
  assert.equal(barrier.schemaVersion, 1);
  assert.equal(barrier.actor.kind, "barrier");
  assertVitals(barrier.actor, "barrier actor");
  assert.ok(barrier.actor.vitals.durability.current > 0, "barrier durability should be initialized");
});

test("actor-state invalid fixtures omit required vital fields", () => {
  const missingVital = readFixture("invalid/actor-state-v1-missing-vital.json");
  assert.equal(missingVital.schema, "agent-kernel/ActorState");
  assert.equal(missingVital.schemaVersion, 1);
  assert.equal(missingVital.actor.vitals.mana, undefined, "missing vital fixture should omit mana");

  const missingRegen = readFixture("invalid/actor-state-v1-missing-regen.json");
  assert.equal(missingRegen.schema, "agent-kernel/ActorState");
  assert.equal(missingRegen.schemaVersion, 1);
  assert.equal(missingRegen.actor.vitals.health.regen, undefined, "missing regen fixture should omit health.regen");
});
