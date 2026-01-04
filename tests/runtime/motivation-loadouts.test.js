const test = require("node:test");
const assert = require("node:assert/strict");

test("normalizeMotivations accepts allowed kinds and applies defaults", async () => {
  const { normalizeMotivations, MOTIVATION_DEFAULTS } = await import(
    "../../packages/runtime/src/personas/configurator/motivation-loadouts.js"
  );

  const result = normalizeMotivations([
    "random",
    { kind: "patrolling", pattern: "ping_pong", intensity: 2, flags: { canMove: false, prefersStealth: true } },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.value.length, 2);
  assert.equal(result.value[0].kind, "random");
  assert.equal(result.value[0].intensity, MOTIVATION_DEFAULTS.intensity);
  assert.equal(result.value[1].kind, "patrolling");
  assert.equal(result.value[1].pattern, "ping_pong");
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
