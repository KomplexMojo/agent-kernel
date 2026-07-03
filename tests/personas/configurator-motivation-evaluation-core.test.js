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

test("motivation evaluation delegation permutations", async () => {
const { createCore } = await import("../../packages/core-ts/src/index.ts");
const {
  evaluateMotivationProfileFromCore,
  flagsToBitmask,
  bitmaskToFlags,
  resolvePatternCode,
} = await import("../../packages/runtime/src/personas/configurator/motivation-evaluation-core.js");

const core = createCore();
core.init(0);
const soloProfiles = {
  random: ["exploring", "none", "reflexive", "instinctual"],
  stationary: ["stationary", "none", "none", "instinctual"],
  exploring: ["exploring", "none", "reflexive", "instinctual"],
  patrolling: ["patrolling", "none", "reflexive", "instinctual"],
  attacking: ["exploring", "attacking", "goal_oriented", "tactical"],
  defending: ["stationary", "defending", "goal_oriented", "tactical"],
  stealthy: ["exploring", "none", "goal_oriented", "tactical"],
  friendly: ["exploring", "none", "reflexive", "instinctual"],
  reflexive: ["stationary", "none", "reflexive", "instinctual"],
  goal_oriented: ["stationary", "none", "goal_oriented", "tactical"],
  strategy_focused: ["stationary", "none", "strategy_focused", "strategic"],
  user_controlled: ["stationary", "none", "none", "instinctual"],
};

for (const [kind, [mobility, combat, cognition, reasoningClass]] of Object.entries(soloProfiles)) {
  const profile = evaluateMotivationProfileFromCore(core, [{ kind, intensity: 1 }]);
  assert.equal(profile.mobility, mobility, `${kind} mobility`);
  assert.equal(profile.combat, combat, `${kind} combat`);
  assert.equal(profile.cognition, cognition, `${kind} cognition`);
  assert.equal(profile.reasoningClass, reasoningClass, `${kind} reasoning`);
}

assert.equal(resolvePatternCode("attacking", "melee"), 1);
assert.equal(resolvePatternCode("attacking", "ranged"), 2);
assert.equal(resolvePatternCode("attacking", "mixed"), 3);
assert.equal(resolvePatternCode("defending", "hold_point"), 1);
assert.equal(resolvePatternCode("defending", "bodyguard"), 2);
assert.equal(resolvePatternCode("patrolling", "loop"), 1);
assert.equal(resolvePatternCode("patrolling", "ping_pong"), 2);
assert.equal(resolvePatternCode("patrolling", "random_walk"), 3);

for (let mask = 0; mask < 16; mask += 1) {
  const roundTrip = flagsToBitmask(bitmaskToFlags(mask));
  assert.equal(roundTrip, mask, `flag mask ${mask} round-trips`);
}

{
  const profile = evaluateMotivationProfileFromCore(core, [
    { kind: "random", intensity: 1 },
    { kind: "patrolling", intensity: 1 },
    { kind: "attacking", intensity: 1 },
    { kind: "defending", intensity: 1 },
    { kind: "goal_oriented", intensity: 1 },
    { kind: "strategy_focused", intensity: 1 },
  ]);
  assert.equal(profile.mobility, "patrolling");
  assert.equal(profile.combat, "defending");
  assert.equal(profile.cognition, "strategy_focused");
  assert.equal(profile.reasoningClass, "strategic");
}

{
  const profile = evaluateMotivationProfileFromCore(core, [{ kind: "user_controlled", intensity: 1 }]);
  assert.equal(profile.mobility, "stationary");
  assert.equal(profile.combat, "none");
  assert.equal(profile.cognition, "none");
  assert.equal(profile.reasoningClass, "instinctual");
}

const patrollingBase = evaluateMotivationProfileFromCore(core, [{ kind: "patrolling", pattern: "loop" }]);
for (const pattern of ["ping_pong", "random_walk"]) {
  const profile = evaluateMotivationProfileFromCore(core, [{ kind: "patrolling", pattern }]);
  assert.equal(profile.mobility, patrollingBase.mobility);
  assert.equal(profile.combat, patrollingBase.combat);
  assert.equal(profile.cognition, patrollingBase.cognition);
  assert.equal(profile.reasoningClass, patrollingBase.reasoningClass);
}

{
  const one = evaluateMotivationProfileFromCore(core, [{ kind: "attacking", intensity: 1 }]);
  const high = evaluateMotivationProfileFromCore(core, [{ kind: "attacking", intensity: 10 }]);
  assert.equal(high.mobility, one.mobility);
  assert.equal(high.combat, one.combat);
  assert.equal(high.cognition, one.cognition);
  assert.equal(high.reasoningClass, one.reasoningClass);
}

{
  const profile = evaluateMotivationProfileFromCore(core, [
    { kind: "reflexive", flags: { prefersStealth: true, prefersCover: true, aggroRangeBoost: true } },
  ]);
  assert.equal(profile.flagValues.canMove, true);
  assert.equal(profile.flagValues.prefersStealth, true);
  assert.equal(profile.flagValues.prefersCover, true);
  assert.equal(profile.flagValues.aggroRangeBoost, true);
}

evaluateMotivationProfileFromCore(core, [{ kind: "strategy_focused" }]);
const resetProfile = evaluateMotivationProfileFromCore(core, [{ kind: "stationary" }]);
assert.equal(resetProfile.mobility, "stationary");
assert.equal(resetProfile.combat, "none");
assert.equal(resetProfile.cognition, "none");
assert.equal(resetProfile.reasoningClass, "instinctual");
});
