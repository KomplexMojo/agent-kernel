const assert = require("node:assert/strict");

test("normalizeMotivations accepts allowed kinds and applies defaults", async () => {
  const { normalizeMotivations, MOTIVATION_DEFAULTS } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  // random (mobility) + attacking (posture) — cross-family, valid
  const result = normalizeMotivations([
    "random",
    { kind: "attacking", pattern: "melee", intensity: 2, flags: { canMove: false, prefersStealth: true } },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.value.length, 2);
  assert.equal(result.value[0].kind, "random");
  assert.equal(result.value[0].intensity, MOTIVATION_DEFAULTS.intensity);
  assert.equal(result.value[1].kind, "attacking");
  assert.equal(result.value[1].pattern, "melee");
  assert.equal(result.value[1].intensity, 2);
  assert.equal(result.value[1].flags.canMove, false);
  assert.equal(result.value[1].flags.prefersStealth, true);
  assert.equal(result.value[1].flags.prefersCover, MOTIVATION_DEFAULTS.flags.prefersCover);
});

test("normalizeMotivations surfaces invalid kinds/patterns and clamps intensity", async () => {
  const { normalizeMotivations, MOTIVATION_PATTERNS } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const result = normalizeMotivations([
    { kind: "invalid_kind" },
    { kind: "attacking", pattern: "invalid", intensity: 99 },
  ]);

  assert.equal(result.ok, false);
  assert.ok(result.errors.find((err) => err.code === "invalid_kind"));
  assert.ok(result.errors.find((err) => err.code === "unknown_pattern"));
  assert.equal(result.value.length, 1);
  assert.equal(result.value[0].kind, "attacking");
  assert.equal(result.value[0].pattern, MOTIVATION_PATTERNS.attacking[0]);
  assert.equal(result.value[0].intensity, 10); // clamped to max
});

test("normalizeMotivations rejects contradictory motivations from the same exclusive group", async () => {
  const {
    MOTIVATION_DISPLAY_GROUPS,
    getConflictingMotivationKinds,
    normalizeMotivations,
  } = await import("../../packages/runtime/src/personas/configurator/motivation-loadouts.js");

  const postureGroup = MOTIVATION_DISPLAY_GROUPS.find((group) => group.id === "posture_attacking_defending");
  assert.ok(postureGroup);
  assert.ok(postureGroup.kinds.includes("attacking"));
  assert.ok(postureGroup.kinds.includes("defending"));
  assert.deepEqual(getConflictingMotivationKinds("stationary"), ["random", "exploring", "patrolling"]);

  const result = normalizeMotivations([
    "attacking",
    "defending",
    "stationary",
    "patrolling",
  ]);

  assert.equal(result.ok, false);
  assert.ok(result.errors.find((err) => err.code === "conflicting_kind" && err.field === "motivations[1]"));
  assert.ok(result.errors.find((err) => err.code === "conflicting_kind" && err.field === "motivations[3]"));
  assert.deepEqual(
    result.value.map((entry) => entry.kind),
    ["attacking", "stationary"],
  );
});

test("MOTIVATION_FAMILIES defines canonical motivation families", async () => {
  const { MOTIVATION_FAMILIES, MOTIVATION_KINDS } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  assert.deepEqual(MOTIVATION_FAMILIES.mobility, ["random", "stationary", "exploring", "patrolling"]);
  assert.deepEqual(MOTIVATION_FAMILIES.posture, ["attacking", "defending", "stealthy", "friendly"]);
  assert.deepEqual(MOTIVATION_FAMILIES.cognition, ["reflexive", "goal_oriented", "strategy_focused"]);
  assert.deepEqual(MOTIVATION_FAMILIES.control, ["user_controlled"]);

  // All family members are in MOTIVATION_KINDS
  const allFamilyKinds = [
    ...MOTIVATION_FAMILIES.mobility,
    ...MOTIVATION_FAMILIES.posture,
    ...MOTIVATION_FAMILIES.cognition,
    ...MOTIVATION_FAMILIES.control,
  ];
  assert.deepEqual(MOTIVATION_KINDS, allFamilyKinds);
});

test("user_controlled composes outside posture and mobility exclusivity", async () => {
  const { normalizeMotivations } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const result = normalizeMotivations(["user_controlled", "attacking", "exploring"]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.map((entry) => entry.kind), ["user_controlled", "attacking", "exploring"]);
});

test("stealthy and friendly are valid motivation kinds", async () => {
  const { normalizeMotivationKind, MOTIVATION_KINDS } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  assert.ok(MOTIVATION_KINDS.includes("stealthy"));
  assert.ok(MOTIVATION_KINDS.includes("friendly"));
  assert.equal(normalizeMotivationKind("stealthy"), "stealthy");
  assert.equal(normalizeMotivationKind("friendly"), "friendly");
});

test("exclusive groups use family names: mobility, posture, cognition", async () => {
  const { MOTIVATION_EXCLUSIVE_GROUPS } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const groupIds = MOTIVATION_EXCLUSIVE_GROUPS.map((g) => g.id);
  assert.deepEqual(groupIds, ["mobility", "posture", "cognition"]);
});

test("posture family rejects stealthy + friendly conflict", async () => {
  const { normalizeMotivations } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const result = normalizeMotivations(["stealthy", "friendly"]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.find((err) => err.code === "conflicting_kind"));
  assert.deepEqual(result.value.map((e) => e.kind), ["stealthy"]);
});

test("posture family rejects attacking + stealthy conflict", async () => {
  const { normalizeMotivations } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const result = normalizeMotivations(["attacking", "stealthy"]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.find((err) => err.code === "conflicting_kind"));
  assert.deepEqual(result.value.map((e) => e.kind), ["attacking"]);
});

test("cognition family rejects reflexive + goal_oriented conflict", async () => {
  const { normalizeMotivations } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const result = normalizeMotivations(["reflexive", "goal_oriented"]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.find((err) => err.code === "conflicting_kind"));
  assert.deepEqual(result.value.map((e) => e.kind), ["reflexive"]);
});

test("cross-family motivations compose freely", async () => {
  const { normalizeMotivations } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  // random (mobility) + attacking (posture) + reflexive (cognition)
  const result1 = normalizeMotivations(["random", "attacking", "reflexive"]);
  assert.equal(result1.ok, true);
  assert.deepEqual(result1.value.map((e) => e.kind), ["random", "attacking", "reflexive"]);

  // patrolling (mobility) + stealthy (posture) + goal_oriented (cognition)
  const result2 = normalizeMotivations(["patrolling", "stealthy", "goal_oriented"]);
  assert.equal(result2.ok, true);
  assert.deepEqual(result2.value.map((e) => e.kind), ["patrolling", "stealthy", "goal_oriented"]);

  // exploring (mobility) + friendly (posture) + strategy_focused (cognition)
  const result3 = normalizeMotivations(["exploring", "friendly", "strategy_focused"]);
  assert.equal(result3.ok, true);
  assert.deepEqual(result3.value.map((e) => e.kind), ["exploring", "friendly", "strategy_focused"]);
});

test("shorthand string inputs continue to work for new kinds", async () => {
  const { normalizeMotivations, normalizeMotivationKind } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  // String normalization (case, whitespace, hyphens)
  assert.equal(normalizeMotivationKind("Stealthy"), "stealthy");
  assert.equal(normalizeMotivationKind("FRIENDLY"), "friendly");
  assert.equal(normalizeMotivationKind("goal-oriented"), "goal_oriented");
  assert.equal(normalizeMotivationKind("strategy focused"), "strategy_focused");

  // Single string input to normalizeMotivations
  const result = normalizeMotivations(["stealthy"]);
  assert.equal(result.ok, true);
  assert.equal(result.value[0].kind, "stealthy");
});

// ── Goal payload tests ──

test("MOTIVATION_GOAL_TYPES defines supported goal types per kind", async () => {
  const { MOTIVATION_GOAL_TYPES } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  assert.ok(MOTIVATION_GOAL_TYPES.defending.includes("defend_point"));
  assert.ok(MOTIVATION_GOAL_TYPES.defending.includes("defend_zone"));
  assert.ok(MOTIVATION_GOAL_TYPES.attacking.includes("attack_target"));
  assert.ok(MOTIVATION_GOAL_TYPES.goal_oriented.includes("reach_point"));
  assert.ok(MOTIVATION_GOAL_TYPES.goal_oriented.includes("defend_point"));
  assert.ok(MOTIVATION_GOAL_TYPES.strategy_focused.includes("patrol_route"));
  assert.equal(MOTIVATION_GOAL_TYPES.random, undefined);
  assert.equal(MOTIVATION_GOAL_TYPES.reflexive, undefined);
});

test("normalizeMotivation includes goal for defending with defend_point", async () => {
  const { normalizeMotivation } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const errors = [];
  const result = normalizeMotivation({
    kind: "defending",
    goal: {
      type: "defend_point",
      objective: "chokepoint_north",
      params: { x: 5, y: 3 },
    },
  }, "m[0]", errors);

  assert.equal(errors.length, 0);
  assert.equal(result.kind, "defending");
  assert.ok(result.goal);
  assert.equal(result.goal.type, "defend_point");
  assert.equal(result.goal.objective, "chokepoint_north");
  assert.equal(result.goal.params.x, 5);
  assert.equal(result.goal.params.y, 3);
});

test("normalizeMotivation includes goal for goal_oriented + reach_point", async () => {
  const { normalizeMotivation } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const errors = [];
  const result = normalizeMotivation({
    kind: "goal_oriented",
    goal: {
      type: "reach_point",
      objective: "exit_door",
      params: { x: 10, y: 0 },
    },
  }, "m[0]", errors);

  assert.equal(errors.length, 0);
  assert.equal(result.goal.type, "reach_point");
  assert.equal(result.goal.objective, "exit_door");
  assert.deepEqual(result.goal.params, { x: 10, y: 0 });
});

test("normalizeMotivation omits goal when not provided", async () => {
  const { normalizeMotivation } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const errors = [];
  const result = normalizeMotivation({ kind: "defending" }, "m[0]", errors);
  assert.equal(errors.length, 0);
  assert.equal(result.goal, undefined);
});

test("normalizeMotivation errors on goal for unsupported kind", async () => {
  const { normalizeMotivation } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const errors = [];
  const result = normalizeMotivation({
    kind: "reflexive",
    goal: { type: "reach_point" },
  }, "m[0]", errors);

  assert.ok(errors.find((e) => e.code === "goal_not_supported"));
  assert.equal(result.goal, undefined);
});

test("normalizeMotivation errors on unknown goal type for kind", async () => {
  const { normalizeMotivation } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const errors = [];
  const result = normalizeMotivation({
    kind: "defending",
    goal: { type: "attack_target" },
  }, "m[0]", errors);

  assert.ok(errors.find((e) => e.code === "unknown_goal_type"));
  assert.equal(result.goal, undefined);
});

test("normalizeMotivation errors on missing goal type", async () => {
  const { normalizeMotivation } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const errors = [];
  normalizeMotivation({
    kind: "defending",
    goal: { objective: "some_point" },
  }, "m[0]", errors);

  assert.ok(errors.find((e) => e.code === "missing_goal_type"));
});

test("normalizeMotivation errors on unknown goal param keys", async () => {
  const { normalizeMotivation } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const errors = [];
  const result = normalizeMotivation({
    kind: "defending",
    goal: {
      type: "defend_point",
      params: { x: 5, y: 3, badKey: "oops" },
    },
  }, "m[0]", errors);

  assert.ok(errors.find((e) => e.code === "unknown_goal_param"));
  assert.ok(result.goal);
  assert.equal(result.goal.params.x, 5);
  assert.equal(result.goal.params.y, 3);
  assert.equal(result.goal.params.badKey, undefined);
});

test("normalizeMotivations passes goals through for composed motivations", async () => {
  const { normalizeMotivations } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const result = normalizeMotivations([
    {
      kind: "goal_oriented",
      goal: { type: "defend_point", objective: "bridge", params: { x: 3, y: 7 } },
    },
    {
      kind: "defending",
      goal: { type: "defend_zone", objective: "throne_room", params: { zone: "zone_a" } },
    },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.value.length, 2);
  assert.equal(result.value[0].goal.type, "defend_point");
  assert.equal(result.value[0].goal.objective, "bridge");
  assert.equal(result.value[1].goal.type, "defend_zone");
  assert.equal(result.value[1].goal.params.zone, "zone_a");
});

test("string shorthand motivations do not produce goals", async () => {
  const { normalizeMotivation } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const errors = [];
  const result = normalizeMotivation("defending", "m[0]", errors);
  assert.equal(errors.length, 0);
  assert.equal(result.kind, "defending");
  assert.equal(result.goal, undefined);
});

test("goal payload is serializable (frozen params)", async () => {
  const { normalizeMotivation } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const errors = [];
  const result = normalizeMotivation({
    kind: "patrolling",
    goal: {
      type: "patrol_route",
      objective: "perimeter",
      params: { route: ["wp_1", "wp_2", "wp_3"] },
    },
  }, "m[0]", errors);

  assert.equal(errors.length, 0);
  assert.ok(result.goal);
  assert.equal(result.goal.type, "patrol_route");
  assert.deepEqual(result.goal.params.route, ["wp_1", "wp_2", "wp_3"]);
  // Verify serializable
  const json = JSON.stringify(result);
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed.goal, {
    type: "patrol_route",
    objective: "perimeter",
    params: { route: ["wp_1", "wp_2", "wp_3"] },
  });
});
