/**
 * AM.10 — the Configurator refuses a self-contradictory motivation set
 * (closes F9, configuration half).
 *
 * core-ts has always been able to answer this. `motivationKindsConflict` reports
 * whether two kinds share an EXCLUSIVE GROUP — mobility, posture or cognition;
 * Control has none — and it had **zero production callers**. So an actor could
 * be authored `stationary` AND `patrolling`, and nothing objected: the
 * contradiction resolved to whichever kind a given code path read first, which
 * is a coin-flip dressed as a configuration.
 *
 * Charter §288 puts configuration validity with the Configurator. The rule stays
 * in core, where the groups are defined; the Configurator asks it.
 */
"use strict";

const assert = require("node:assert/strict");

async function loadValidator() {
  const mod = await import(
    "../../../packages/runtime/src/personas/configurator/config-validation.js"
  );
  return mod.validateConfiguratorConfig;
}

function actorWith(motivations) {
  return {
    id: "actor_1",
    kind: "ambulatory",
    position: { x: 1, y: 1 },
    motivations,
  };
}

const BASE = {
  levelGen: { width: 9, height: 9, shape: { roomCount: 1 } },
};

// ---------------------------------------------------------------------------
// Conflicts are refused, with a reason that names both kinds
// ---------------------------------------------------------------------------

test("stationary + patrolling is refused — both are mobility motivations", async () => {
  const validate = await loadValidator();
  const result = validate({ ...BASE, actors: [actorWith(["stationary", "patrolling"])] });

  assert.equal(result.ok, false, "a mobility contradiction must not validate");
  assert.match(
    result.errors.join(" | "),
    /stationary.*patrolling|patrolling.*stationary/,
    `the refusal must name BOTH kinds, or an author cannot tell what to change: ${result.errors.join(" | ")}`,
  );
});

test("attacking + defending is refused — both are posture motivations", async () => {
  const validate = await loadValidator();
  const result = validate({ ...BASE, actors: [actorWith(["attacking", "defending"])] });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" | "), /mutually exclusive/);
});

test("goal_oriented + strategy_focused is refused — both are cognition motivations", async () => {
  const validate = await loadValidator();
  const result = validate({ ...BASE, actors: [actorWith(["goal_oriented", "strategy_focused"])] });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// ...and legal combinations still pass. A rule that refuses everything is not a
// rule, and this is the half that catches an over-broad conflict check.
// ---------------------------------------------------------------------------

test("motivations from DIFFERENT families combine freely", async () => {
  const validate = await loadValidator();
  const result = validate({
    ...BASE,
    actors: [actorWith(["patrolling", "attacking", "goal_oriented"])],
  });
  assert.equal(
    result.ok,
    true,
    "one mobility + one posture + one cognition is the normal shape of a motivated actor: "
      + result.errors.join(" | "),
  );
});

test("user_controlled conflicts with nothing — Control has no exclusive group", async () => {
  const validate = await loadValidator();
  const result = validate({
    ...BASE,
    actors: [actorWith(["user_controlled", "patrolling", "attacking"])],
  });
  assert.equal(
    result.ok,
    true,
    `Control is deliberately outside the exclusive groups: ${result.errors.join(" | ")}`,
  );
});

test("a single motivation, and an unknown kind, are left alone", async () => {
  const validate = await loadValidator();
  assert.equal(validate({ ...BASE, actors: [actorWith(["patrolling"])] }).ok, true);
  // An unrecognized name is not this check's business — the motivation
  // vocabulary is validated elsewhere, and claiming a conflict here would
  // report the wrong defect.
  assert.equal(validate({ ...BASE, actors: [actorWith(["patrolling", "nonsense"])] }).ok, true);
  assert.equal(
    validate({ ...BASE, actors: [actorWith(["goal-oriented", "reflexive"])] }).ok,
    true,
    "this legacy validator recognizes canonical names only; alias coercion belongs to loadout normalization",
  );
});

test("the singular `motivation.kind` shape is checked too, not just `motivations`", async () => {
  const validate = await loadValidator();
  const result = validate({
    ...BASE,
    actors: [{
      id: "actor_1",
      kind: "ambulatory",
      position: { x: 1, y: 1 },
      motivation: { kind: "stationary" },
      motivations: ["exploring"],
    }],
  });
  assert.equal(
    result.ok,
    false,
    "actors carry motivation in two shapes in this codebase; a rule enforced on one and missed "
      + "on the other is how the stamina requirement came to be checked on regen and not on max",
  );
});

// ## TODO: Test Permutations
//
// - every pair within each exclusive group (mobility: random/stationary/
//   exploring/patrolling; posture: attacking/defending/stealthy/friendly;
//   cognition: reflexive/goal_oriented/strategy_focused) must be refused
// - every cross-family pair must be accepted
// - three conflicting kinds must produce THREE distinct pair errors, not one
// - the same kind twice is not a conflict with itself
// - casing and surrounding whitespace must not defeat the check
