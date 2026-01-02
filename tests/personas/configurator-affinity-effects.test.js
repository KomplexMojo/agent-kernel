const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/personas/affinity-resolution-v1-basic.json"), "utf8"));
const effectsModule = moduleUrl("packages/runtime/src/personas/configurator/affinity-effects.js");
const loadoutsModule = moduleUrl("packages/runtime/src/personas/configurator/affinity-loadouts.js");

test("affinity effects resolve vitals and abilities deterministically", () => {
  const script = `
import assert from "node:assert/strict";
import { resolveAffinityEffects } from ${JSON.stringify(effectsModule)};
import { normalizeAffinityPresetCatalog, normalizeActorLoadoutCatalog } from ${JSON.stringify(loadoutsModule)};

const fixture = ${JSON.stringify(fixture)};
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
`;
  runEsm(script);
});
