/**
 * Playable vs companion (Darren, 2026-10-13): only an actor authored with the
 * `user_controlled` motivation is playable; every other delver is a companion acting on
 * its own motivations. The Configurator authors a delver's motivations exactly as asked,
 * one per family (mobility, posture, cognition) with `user_controlled` beside any of them,
 * and a playable actor needs movement stamina because the player moves it every turn.
 */
const assert = require("node:assert/strict");

async function persona() {
  const { createConfiguratorPersona } = await import(
    "../../../packages/runtime/src/personas/configurator/controller.js"
  );
  return createConfiguratorPersona({ clock: () => "2026-10-14T00:00:00.000Z" });
}

function delver(c, rawMotivation) {
  return c.authorDelverCandidate({ index: 1, rawAffinity: "earth", rawMotivation, count: 1 });
}

test("a delver is playable only when authored user_controlled", async () => {
  const c = await persona();
  assert.deepEqual(delver(c, undefined).motivations, ["attacking"], "the default delver is a companion");
  assert.deepEqual(delver(c, "exploring").motivations, ["exploring"]);
  assert.deepEqual(delver(c, "user_controlled").motivations, ["user_controlled"]);
});

test("one motivation per family, joined with + or ,", async () => {
  const c = await persona();
  assert.deepEqual(delver(c, "exploring+attacking").motivations, ["exploring", "attacking"]);
  assert.deepEqual(delver(c, "exploring,attacking").motivations, ["exploring", "attacking"]);
  assert.deepEqual(delver(c, "patrolling+stealthy+strategy_focused").motivations,
    ["patrolling", "stealthy", "strategy_focused"]);
  assert.deepEqual(delver(c, "user_controlled+exploring").motivations, ["user_controlled", "exploring"]);
  assert.deepEqual(delver(c, "exploring+exploring").motivations, ["exploring"], "a repeat is the same motivation");
});

test("two motivations from one family are refused, naming both", async () => {
  const c = await persona();
  assert.throws(() => delver(c, "exploring+patrolling"), /delver\[1\].*exploring.*patrolling.*mobility/);
  assert.throws(() => delver(c, "exploring+nonsense"), /delver\[1\] motivation must be one of:/);
});

test("warden motivations follow the same rules and default to defending", async () => {
  const c = await persona();
  assert.deepEqual(c.authorMotivations({ role: "warden", index: 2 }), ["defending"]);
  assert.deepEqual(c.authorMotivations({ role: "warden", index: 2, raw: "patrolling+attacking" }), ["patrolling", "attacking"]);
  assert.throws(() => c.authorMotivations({ role: "warden", index: 2, raw: "attacking+defending" }), /warden\[2\].*posture/);
});

test("a playable actor needs movement stamina; a stationary companion does not", async () => {
  const { requiresMovementStamina } = await import(
    "../../../packages/runtime/src/personas/configurator/logical-validation.js"
  );
  assert.equal(requiresMovementStamina({ motivations: ["user_controlled"] }), true);
  assert.equal(requiresMovementStamina({ motivations: ["stationary"] }), false);
  assert.equal(requiresMovementStamina({ motivations: ["exploring"] }), true);
});

// ## TODO: Test Permutations
// - every pair of kinds within one family is refused; every cross-family pair is accepted.
// - whitespace and case around + separators ("Exploring + ATTACKING") normalize.
// - user_controlled listed twice collapses to one.
// - an empty segment ("exploring++attacking") is refused or ignored consistently.
