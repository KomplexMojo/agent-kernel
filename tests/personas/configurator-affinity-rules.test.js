const test = require("node:test");
const assert = require("node:assert/strict");
const { readFixture } = require("../helpers/fixtures");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/personas/configurator/affinity-rules.js");
const rulesFixture = readFixture("affinity-rules-artifact-v1-basic.json");
const defaultRulesFixture = readFixture("affinity-rules-artifact-v1-default.json");

test("affinity default rules fixture matches runtime defaults", () => {
  const script = `
import assert from "node:assert/strict";
import { DEFAULT_AFFINITY_RULES_ARTIFACT, normalizeAffinityRulesArtifact } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(defaultRulesFixture)};
assert.deepEqual(DEFAULT_AFFINITY_RULES_ARTIFACT, fixture);

const normalized = normalizeAffinityRulesArtifact(fixture);
assert.equal(normalized.ok, true);
`;
  runEsm(script);
});

test("affinity rules normalize and expose tiered mana scaling", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityRulesArtifact, resolveAffinityCastProfile } from ${JSON.stringify(modulePath)};

const rulesFixture = ${JSON.stringify(rulesFixture)};
const result = normalizeAffinityRulesArtifact(rulesFixture);
assert.equal(result.ok, true);

const fireTier2 = resolveAffinityCastProfile({
  rules: result.value,
  kind: "fire",
  expression: "push",
  stacks: 2,
});
assert.equal(fireTier2.expressionId, "flame_surge");
assert.equal(fireTier2.manaCost, 6);

const waterEmit = resolveAffinityCastProfile({
  rules: result.value,
  kind: "water",
  expression: "emit",
  stacks: 3,
  context: { persistentArea: true },
});
assert.equal(waterEmit.expressionId, "tidal_veil");
assert.equal(waterEmit.manaCost, 6);
`;
  runEsm(script);
});

test("affinity rules reject decreasing mana costs by tier", () => {
  const invalid = JSON.parse(JSON.stringify(rulesFixture));
  invalid.affinities[0].expressions[0].stackTiers[2].manaCost = 1;
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityRulesArtifact } from ${JSON.stringify(modulePath)};

const invalid = ${JSON.stringify(invalid)};
const result = normalizeAffinityRulesArtifact(invalid);
assert.equal(result.ok, false);
assert.ok(result.errors.find((entry) => entry.code === "decreasing_mana_cost"));
`;
  runEsm(script);
});

test("affinity rules resolve fire vs water and light vs dark interactions with mana", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityRulesArtifact, resolveAffinityInteraction } from ${JSON.stringify(modulePath)};

const rulesFixture = ${JSON.stringify(rulesFixture)};
const normalized = normalizeAffinityRulesArtifact(rulesFixture);
assert.equal(normalized.ok, true);

const fireVsWater = resolveAffinityInteraction({
  rules: normalized.value,
  source: { kind: "fire", expression: "push", stacks: 3 },
  target: { kind: "water", expression: "emit", stacks: 2 },
});
assert.equal(fireVsWater.winner, "source");
assert.equal(fireVsWater.outcome, "mutate_environment");
assert.equal(fireVsWater.source.manaSpent, 10);
assert.equal(fireVsWater.target.manaSpent, 2);

const lightVsDark = resolveAffinityInteraction({
  rules: normalized.value,
  source: { kind: "light", expression: "emit", stacks: 3 },
  target: { kind: "dark", expression: "emit", stacks: 4 },
});
assert.equal(lightVsDark.winner, "target");
assert.equal(lightVsDark.outcome, "suppress");
assert.equal(lightVsDark.source.manaSpent, 7);
assert.equal(lightVsDark.target.manaSpent, 10);
`;
  runEsm(script);
});

test("legacy affinity rules fixtures still validate when additive tier metadata is absent", () => {
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityRulesArtifact } from ${JSON.stringify(modulePath)};

const rulesFixture = ${JSON.stringify(rulesFixture)};
const normalized = normalizeAffinityRulesArtifact(rulesFixture);
assert.equal(normalized.ok, true);

const tier = normalized.value.affinities[0].expressions[0].stackTiers[0];
assert.equal(tier.defaultDesignCostTokens, undefined);
assert.equal(tier.complexityClass, undefined);
`;
  runEsm(script);
});

test("affinity rules normalize optional draw conversion globals", () => {
  const fixture = JSON.parse(JSON.stringify(rulesFixture));
  fixture.globals = {
    ...(fixture.globals || {}),
    drawConversion: {
      defaultRule: { targetVital: "mana", efficiency: 0.5 },
      byAffinity: {
        fire: { targetVital: "stamina", efficiency: 2 },
      },
    },
  };
  const script = `
import assert from "node:assert/strict";
import { normalizeAffinityRulesArtifact } from ${JSON.stringify(modulePath)};

const fixture = ${JSON.stringify(fixture)};
const normalized = normalizeAffinityRulesArtifact(fixture);
assert.equal(normalized.ok, true);
assert.equal(normalized.value.globals.drawConversion.defaultRule.targetVital, "mana");
assert.equal(normalized.value.globals.drawConversion.defaultRule.efficiency, 0.5);
assert.equal(normalized.value.globals.drawConversion.byAffinity.fire.targetVital, "stamina");
assert.equal(normalized.value.globals.drawConversion.byAffinity.fire.efficiency, 2);
`;
  runEsm(script);
});
