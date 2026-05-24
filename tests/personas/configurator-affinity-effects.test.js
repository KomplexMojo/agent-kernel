const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/affinity-resolution-v1-basic.json"), "utf8"));

test("affinity effects resolve vitals and abilities deterministically", async () => {const { resolveAffinityEffects } = await import("../../packages/runtime/src/personas/configurator/affinity-effects.js");
const { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } = await import("../../packages/runtime/src/personas/configurator/affinity-loadouts.js");

assert.equal(fixture.schema, "agent-kernel/AffinityResolutionFixture");
assert.equal(fixture.schemaVersion, 1);

const presetResult = normalizeAffinityPresetCatalog({ presets: fixture.input.presets });
assert.equal(presetResult.ok, true);
const loadoutResult = normalizeActorLoadoutCatalog({ loadouts: fixture.input.loadouts }, { presets: presetResult.value.presets });
assert.equal(loadoutResult.ok, true);

const result = resolveAffinityEffects({
  presets: presetResult.value.presets,
  loadouts: loadoutResult.value.loadouts,
  baseVitalsByActorId: fixture.input.baseVitalsByActorId,
  traps: fixture.input.traps,
});

assert.deepEqual(result, fixture.expected);
const second = resolveAffinityEffects({
  presets: presetResult.value.presets,
  loadouts: loadoutResult.value.loadouts,
  baseVitalsByActorId: fixture.input.baseVitalsByActorId,
  traps: fixture.input.traps,
});
assert.deepEqual(second, fixture.expected);
});
