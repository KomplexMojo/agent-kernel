const assert = require("node:assert/strict");


test("motivation evaluation delegation: core-ts produces correct behavior profiles", async () => {
const { createCore } = await import("../../packages/core-ts/src/index.ts");
const {
  evaluateMotivationProfileFromCore,
  flagsToBitmask,
  bitmaskToFlags,
  resolvePatternCode,
} = await import("../../packages/runtime/src/personas/configurator/motivation-evaluation-core.js");

const core = createCore();
core.init(0);

// ── Helper tests ──

// flagsToBitmask
assert.equal(flagsToBitmask({ canMove: true, prefersStealth: false, prefersCover: false, aggroRangeBoost: false }), 1);
assert.equal(flagsToBitmask({ canMove: true, prefersStealth: false, prefersCover: false, aggroRangeBoost: true }), 9);
assert.equal(flagsToBitmask({ canMove: true, prefersStealth: true, prefersCover: true, aggroRangeBoost: true }), 15);
assert.equal(flagsToBitmask(null), 0);

// bitmaskToFlags
{
  const flags = bitmaskToFlags(9);
  assert.equal(flags.canMove, true);
  assert.equal(flags.prefersStealth, false);
  assert.equal(flags.prefersCover, false);
  assert.equal(flags.aggroRangeBoost, true);
}

// resolvePatternCode
assert.equal(resolvePatternCode("attacking", "melee"), 1);
assert.equal(resolvePatternCode("attacking", "ranged"), 2);
assert.equal(resolvePatternCode("attacking", "mixed"), 3);
assert.equal(resolvePatternCode("patrolling", "loop"), 1);
assert.equal(resolvePatternCode("patrolling", "ping_pong"), 2);
assert.equal(resolvePatternCode("defending", "hold_point"), 1);
assert.equal(resolvePatternCode("defending", "bodyguard"), 2);
assert.equal(resolvePatternCode("attacking", "unknown"), 0);
assert.equal(resolvePatternCode("random", undefined), 0);

// ── Attacking + reflexive profile ──

{
  const profile = evaluateMotivationProfileFromCore(core, [
    { kind: "attacking", intensity: 3, pattern: "melee" },
    { kind: "reflexive", intensity: 1 },
  ]);
  assert.ok(profile !== null, "profile is not null");
  assert.equal(profile.mobility, "exploring", "attacking contributes exploring mobility");
  assert.equal(profile.combat, "attacking", "attacking contributes attacking combat");
  assert.equal(profile.cognition, "goal_oriented", "attacking contributes goal_oriented cognition");
  assert.equal(profile.reasoningClass, "tactical", "goal_oriented → tactical reasoning");
  assert.equal(profile.flagValues.canMove, true, "canMove from attacking defaults");
  assert.equal(profile.flagValues.aggroRangeBoost, true, "aggroRangeBoost from attacking defaults");
}

// ── Empty motivations → defaults ──

{
  const profile = evaluateMotivationProfileFromCore(core, []);
  assert.ok(profile !== null);
  assert.equal(profile.mobility, "stationary", "empty → stationary");
  assert.equal(profile.combat, "none", "empty → none");
  assert.equal(profile.cognition, "none", "empty → none cognition");
  assert.equal(profile.reasoningClass, "instinctual", "empty → instinctual");
  assert.equal(profile.flags, 0, "empty → no flags");
}

// ── Null core → null result ──

{
  const profile = evaluateMotivationProfileFromCore(null, [{ kind: "attacking" }]);
  assert.equal(profile, null, "null core → null");
}

// ── Strategy-focused → strategic reasoning ──

{
  const profile = evaluateMotivationProfileFromCore(core, [
    { kind: "strategy_focused", intensity: 1 },
  ]);
  assert.equal(profile.reasoningClass, "strategic", "strategy_focused → strategic");
  assert.equal(profile.cognition, "strategy_focused");
}

// ── Defending → defending combat + cover preference ──

{
  const profile = evaluateMotivationProfileFromCore(core, [
    { kind: "defending", intensity: 1, pattern: "hold_point" },
  ]);
  assert.equal(profile.combat, "defending", "defending combat");
  assert.equal(profile.flagValues.prefersCover, true, "defending has prefersCover");
}

// ── String shorthand ──

{
  const profile = evaluateMotivationProfileFromCore(core, ["exploring"]);
  assert.equal(profile.mobility, "exploring", "string shorthand works");
}

// ── Stealthy → prefersStealth flag ──

{
  const profile = evaluateMotivationProfileFromCore(core, [
    { kind: "stealthy", intensity: 1 },
  ]);
  assert.equal(profile.flagValues.prefersStealth, true, "stealthy has prefersStealth");
}

// ── Max profile: attacking + strategy_focused → highest axes ──

{
  const profile = evaluateMotivationProfileFromCore(core, [
    { kind: "attacking", intensity: 1 },
    { kind: "strategy_focused", intensity: 1 },
  ]);
  // Max of attacking(exploring/attacking/goal_oriented) and strategy_focused(stationary/none/strategy_focused)
  assert.equal(profile.mobility, "exploring", "max mobility = exploring");
  assert.equal(profile.combat, "attacking", "max combat = attacking");
  assert.equal(profile.cognition, "strategy_focused", "max cognition = strategy_focused");
  assert.equal(profile.reasoningClass, "strategic", "max reasoning = strategic");
}

// ── Numeric codes are present ──

{
  const profile = evaluateMotivationProfileFromCore(core, [{ kind: "attacking", intensity: 1 }]);
  assert.equal(profile.mobilityCode, 1, "exploring = 1");
  assert.equal(profile.combatCode, 1, "attacking = 1");
  assert.equal(profile.cognitionCode, 2, "goal_oriented = 2");
  assert.equal(profile.reasoningClassCode, 1, "tactical = 1");
}

console.log("configurator-motivation-evaluation: all assertions passed");
});

// ## TODO: Test Permutations
// - [ ] All 12 motivation kinds solo: verify profile axes match JS rules
// - [ ] All pattern codes for attacking/defending/patrolling: verify resolvePatternCode
// - [ ] flagsToBitmask round-trip for all 16 combinations
// - [ ] Multiple motivations from same exclusive group: verify max-axis behavior
// - [ ] user_controlled: verify stationary/none/none/instinctual
// - [ ] patrolling with all 3 patterns: verify profile unchanged by pattern
// - [ ] Intensity > 1 does not change axes: verify profile same as intensity=1
// - [ ] Custom flags override: verify flagMask > 0 contributes to output flags
// - [ ] Sequential evaluations: verify second call resets previous state
