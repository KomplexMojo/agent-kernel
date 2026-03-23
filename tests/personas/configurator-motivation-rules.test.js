const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const motivationRulesModule = moduleUrl("packages/runtime/src/personas/configurator/motivation-rules.js");
const motivationLoadoutsModule = moduleUrl("packages/runtime/src/personas/configurator/motivation-loadouts.js");
const behaviorRulesModule = moduleUrl("packages/runtime/src/personas/configurator/behavior-rules.js");

const motivationRulesFixture = readFixture("motivation-rules-artifact-v1-basic.json");
const invalidFixtures = {
  invalidSchema: readFixture("invalid/motivation-rules-artifact-v1-invalid-schema.json"),
  invalidSchemaVersion: readFixture("invalid/motivation-rules-artifact-v2.json"),
  missingMotivation: readFixture("invalid/motivation-rules-artifact-v1-missing-motivation.json"),
  invalidReasoningClass: readFixture("invalid/motivation-rules-artifact-v1-invalid-reasoning-class.json"),
  invalidProfileCost: readFixture("invalid/motivation-rules-artifact-v1-invalid-profile-cost.json"),
  negativeDesignCost: readFixture("invalid/motivation-rules-artifact-v1-negative-design-cost.json"),
  invalidDefaultPattern: readFixture("invalid/motivation-rules-artifact-v1-invalid-default-pattern.json"),
  invalidIntensityBounds: readFixture("invalid/motivation-rules-artifact-v1-invalid-intensity-bounds.json"),
};

test("motivation rules fixture matches runtime defaults and preserves legacy behavior", () => {
  const script = `
import assert from "node:assert/strict";
import {
  DEFAULT_MOTIVATION_RULES_ARTIFACT,
  normalizeMotivationRulesArtifact,
} from ${JSON.stringify(motivationRulesModule)};
import {
  deriveMotivationProfile,
  deriveReasoningClass,
} from ${JSON.stringify(motivationLoadoutsModule)};
import { resolveMotivationBehaviorProfile } from ${JSON.stringify(behaviorRulesModule)};

const fixture = ${JSON.stringify(motivationRulesFixture)};
assert.deepEqual(DEFAULT_MOTIVATION_RULES_ARTIFACT, fixture);

const normalized = normalizeMotivationRulesArtifact(fixture);
assert.equal(normalized.ok, true);

const legacyProfile = deriveMotivationProfile(["attacking", "strategy_focused"], undefined, {
  rules: normalized.value,
});
assert.deepEqual(legacyProfile, {
  mobility: "exploring",
  combat: "none",
  cognition: "strategy_focused",
});
assert.equal(deriveReasoningClass(legacyProfile, { rules: normalized.value }), "strategic");

const behavior = resolveMotivationBehaviorProfile({
  rules: normalized.value,
  motivations: ["attacking", "strategy_focused"],
});
assert.deepEqual(behavior.motivationProfile, legacyProfile);
assert.equal(behavior.reasoningClass, "strategic");
assert.equal(behavior.complexityClass, "strategic");
`;
  runEsm(script);
});

test("motivation rules invalid fixtures report targeted validation errors", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeMotivationRulesArtifact } from ${JSON.stringify(motivationRulesModule)};

const fixtures = ${JSON.stringify(invalidFixtures)};
const expected = {
  invalidSchema: "invalid_schema",
  invalidSchemaVersion: "invalid_schema_version",
  missingMotivation: "missing_motivation_random",
  invalidReasoningClass: "invalid_complexity_class",
  invalidProfileCost: "invalid_non_negative_int",
  negativeDesignCost: "invalid_non_negative_int",
  invalidDefaultPattern: "unknown_default_pattern",
  invalidIntensityBounds: "less_than_default_intensity",
};

for (const [key, fixture] of Object.entries(fixtures)) {
  const result = normalizeMotivationRulesArtifact(fixture);
  assert.equal(result.ok, false, key);
  assert.ok(result.errors.find((entry) => entry.code === expected[key]), key);
}
`;
  runEsm(script);
});

test("custom motivation rules deterministically override reasoning and authored costs", () => {
  const customRules = JSON.parse(JSON.stringify(motivationRulesFixture));
  customRules.globals.reasoningClasses.goal_oriented = "strategic";
  customRules.globals.profileCosts.combat.attacking = 7;
  customRules.motivations = customRules.motivations.map((entry) => (
    entry.kind === "attacking"
      ? { ...entry, defaultDesignCostTokens: 9 }
      : entry
  ));

  const script = `
import assert from "node:assert/strict";
import { normalizeMotivations, buildMotivationCostItems } from ${JSON.stringify(motivationLoadoutsModule)};
import { resolveMotivationBehaviorProfile } from ${JSON.stringify(behaviorRulesModule)};

const customRules = ${JSON.stringify(customRules)};
const normalized = normalizeMotivations([{ kind: "attacking", intensity: 2 }], "motivations", {
  rules: customRules,
});
assert.equal(normalized.ok, true);
assert.equal(normalized.value[0].defaultDesignCostTokens, 9);

const behavior = resolveMotivationBehaviorProfile({
  rules: customRules,
  motivations: ["attacking"],
});
assert.equal(behavior.reasoningClass, "strategic");
assert.equal(behavior.complexityClass, "strategic");

const items = buildMotivationCostItems(behavior.motivationProfile, { rules: customRules });
const attackingCost = items.find((entry) => entry.id === "combat_attacking");
assert.equal(attackingCost.defaultCostTokens, 7);
`;
  runEsm(script);
});
